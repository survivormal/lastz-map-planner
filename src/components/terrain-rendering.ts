import {
  AXIAL_DIRECTIONS,
  WORLD_SIZE,
  hexVertices,
  inWorld,
  offset,
  type Pixel,
  type Tile,
} from "../domain/geometry";
import type { TerrainLookup } from "../domain/placement";
import type { Terrain } from "../domain/schema";

export type TerrainEdge = [Pixel, Pixel];
export type TerrainBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
export type TerrainEdges = {
  shore: TerrainEdge[];
  restricted: TerrainEdge[];
  unknown: TerrainEdge[];
  world: TerrainEdge[];
  visitedCells: number;
  truncated: boolean;
};

const DEFAULT_MAX_CELLS = 12_000;
const HARD_MAX_CELLS = 25_000;
const cellId = (tile: Tile) => tile.y * WORLD_SIZE + tile.x;
const comesBefore = (a: Tile, b: Tile) =>
  a.y < b.y || (a.y === b.y && a.x < b.x);

function clipTerrainBounds(bounds: TerrainBounds): TerrainBounds | null {
  if (!Object.values(bounds).every(Number.isFinite)) {
    throw new RangeError("Terrain bounds must be finite.");
  }
  const minX = Math.max(0, Math.ceil(bounds.minX));
  const maxX = Math.min(WORLD_SIZE - 1, Math.floor(bounds.maxX));
  const minY = Math.max(0, Math.ceil(bounds.minY));
  const maxY = Math.min(WORLD_SIZE - 1, Math.floor(bounds.maxY));
  return minX > maxX || minY > maxY ? null : { minX, maxX, minY, maxY };
}

function emptyTerrainEdges(): TerrainEdges {
  return {
    shore: [],
    restricted: [],
    unknown: [],
    world: [],
    visitedCells: 0,
    truncated: false,
  };
}

/**
 * Exact hex sides in the planner's world-pixel projection. Bounds select tile
 * centers, not pixels; neighboring terrain is read even outside those bounds.
 * The row-major work limit keeps zoomed-out views bounded. A truncated result
 * is a partial outline, so callers should use their overview rendering there.
 */
export function terrainEdges(
  bounds: TerrainBounds,
  terrainAt: TerrainLookup,
  options: { maxCells?: number } = {},
): TerrainEdges {
  const clipped = clipTerrainBounds(bounds);
  const requestedLimit = options.maxCells ?? DEFAULT_MAX_CELLS;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 0) {
    throw new RangeError("Terrain cell limit must be a nonnegative integer.");
  }
  const limit = Math.min(requestedLimit, HARD_MAX_CELLS);
  const result = emptyTerrainEdges();
  if (!clipped) return result;
  const { minX, maxX, minY, maxY } = clipped;
  result.truncated = (maxX - minX + 1) * (maxY - minY + 1) > limit;

  // Caches are local: overrides or a different terrain profile cannot leave
  // stale borders in a later call. Each in-world cell is queried at most once.
  const terrainCache = new Map<number, Terrain>();
  const vertexCache = new Map<number, Pixel[]>();
  const terrain = (tile: Tile): Terrain => {
    const id = cellId(tile);
    const cached = terrainCache.get(id);
    if (cached !== undefined) return cached;
    const value = terrainAt(tile);
    terrainCache.set(id, value);
    return value;
  };
  const edge = (tile: Tile, side: number): TerrainEdge => {
    const id = cellId(tile);
    let vertices = vertexCache.get(id);
    if (!vertices) {
      vertices = hexVertices(tile);
      vertexCache.set(id, vertices);
    }
    return [vertices[side], vertices[(side + 1) % 6]];
  };

  for (let y = minY; y <= maxY && result.visitedCells < limit; y++) {
    for (let x = minX; x <= maxX && result.visitedCells < limit; x++) {
      const tile = { x, y };
      const currentTerrain = terrain(tile);
      result.visitedCells++;
      for (let side = 0; side < 6; side++) {
        // hexVertices starts at north; direction zero points east.
        const neighbor = offset(tile, AXIAL_DIRECTIONS[(side + 5) % 6]);
        if (!inWorld(neighbor)) {
          result.world.push(edge(tile, side));
          continue;
        }
        const neighborBefore = comesBefore(neighbor, tile);
        if (
          neighborBefore &&
          neighbor.x >= minX &&
          neighbor.x <= maxX &&
          neighbor.y >= minY &&
          neighbor.y <= maxY
        ) {
          // An earlier cell in this row-major prefix already emitted this edge.
          continue;
        }
        const neighborTerrain = terrain(neighbor);
        if (neighborTerrain === currentTerrain) continue;
        const collection =
          currentTerrain === "restricted" || neighborTerrain === "restricted"
            ? result.restricted
            : currentTerrain === "unknown" || neighborTerrain === "unknown"
              ? result.unknown
              : result.shore;
        // Canonical owner/order gives identical floating-point vertices when
        // the same edge is requested from the opposite side of the viewport.
        collection.push(
          neighborBefore ? edge(neighbor, (side + 3) % 6) : edge(tile, side),
        );
      }
    }
  }
  return result;
}

/**
 * Complete outlines for a viewport, split into bounded row strips. World
 * clipping happens before iteration, so even oversized bounds visit at most
 * the world's one million cells. Adjacent strips both read their shared
 * border; canonical endpoints let us remove those duplicate edges exactly.
 */
export function viewportTerrainEdges(
  bounds: TerrainBounds,
  terrainAt: TerrainLookup,
): TerrainEdges {
  const clipped = clipTerrainBounds(bounds);
  if (!clipped) return emptyTerrainEdges();
  const { minX, maxX, minY, maxY } = clipped;
  const rowsPerStrip = Math.floor(HARD_MAX_CELLS / (maxX - minX + 1));
  if (maxY - minY + 1 <= rowsPerStrip) {
    return terrainEdges(clipped, terrainAt, { maxCells: HARD_MAX_CELLS });
  }

  const result = emptyTerrainEdges();
  const seen = new Set<string>();
  for (let y = minY; y <= maxY; y += rowsPerStrip) {
    const strip = terrainEdges(
      { minX, maxX, minY: y, maxY: Math.min(maxY, y + rowsPerStrip - 1) },
      terrainAt,
      { maxCells: HARD_MAX_CELLS },
    );
    result.visitedCells += strip.visitedCells;
    for (const kind of ["shore", "restricted", "unknown", "world"] as const) {
      for (const edge of strip[kind]) {
        const [a, b] = edge;
        const id = `${a.x},${a.y};${b.x},${b.y}`;
        if (seen.has(id)) continue;
        seen.add(id);
        result[kind].push(edge);
      }
    }
  }
  return result;
}
