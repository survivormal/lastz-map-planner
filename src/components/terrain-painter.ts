import {
  distance,
  footprint,
  hexVertices,
  key,
  worldToPixel,
  type Tile,
} from "../domain/geometry";
import type { Placement, Terrain } from "../domain/schema";
import { viewportTerrainEdges } from "./terrain-rendering";

export type TerrainAppearance = "game" | "tactical";
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
type Lookup = (tile: Tile) => Terrain;
export const TERRAIN_COLORS: Record<
  TerrainAppearance,
  Record<Terrain, string>
> = {
  game: {
    grass: "#938c59",
    mud: "#ac987b",
    restricted: "#897665",
    unknown: "#687777",
  },
  tactical: {
    grass: "#293e36",
    mud: "#4c4032",
    restricted: "#382e30",
    unknown: "#293334",
  },
};
const GROUND_RGB: Record<Terrain, [number, number, number]> = {
  grass: [147, 140, 89],
  mud: [172, 152, 123],
  restricted: [137, 118, 101],
  unknown: [104, 119, 119],
};

function hash(x: number, y: number, seed = 13): number {
  let n = Math.imul(x ^ seed, 374761393) ^ Math.imul(y + seed, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, step: number, seed: number): number {
  const count = 256 / step,
    ix = Math.floor(x / step),
    iy = Math.floor(y / step);
  const fx = x / step - ix,
    fy = y / step - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix % count, iy % count, seed),
    b = hash((ix + 1) % count, iy % count, seed);
  const c = hash(ix % count, (iy + 1) % count, seed),
    d = hash((ix + 1) % count, (iy + 1) % count, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function texture(
  ctx: CanvasRenderingContext2D,
  terrain: Terrain,
): CanvasPattern | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const surface = canvas.getContext("2d");
  if (!surface) return null;
  const image = surface.createImageData(256, 256),
    base = GROUND_RGB[terrain];
  const grass = terrain === "grass";
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const variation =
        (noise(x, y, 64, 21) - 0.5) * (grass ? 20 : 12) +
        (noise(x, y, 16, 73) - 0.5) * 12 +
        (noise(x, y, 4, 37) - 0.5) * (grass ? 14 : 6) +
        (hash(x, y, 91) - 0.5) * (grass ? 13 : 10);
      const index = (y * 256 + x) * 4;
      image.data[index] = base[0] + variation;
      image.data[index + 1] = base[1] + variation;
      image.data[index + 2] = base[2] + variation * 0.72;
      image.data[index + 3] = 255;
    }
  surface.putImageData(image, 0, 0);
  return ctx.createPattern(canvas, "repeat");
}
const HEX_OFFSETS = (() => {
  const origin = worldToPixel({ x: 0, y: 0 });
  return hexVertices({ x: 0, y: 0 }).map((vertex) => ({
    x: vertex.x - origin.x,
    y: vertex.y - origin.y,
  }));
})();
function appendHex(ctx: CanvasRenderingContext2D, tile: Tile) {
  const center = worldToPixel(tile);
  ctx.moveTo(center.x + HEX_OFFSETS[0].x, center.y + HEX_OFFSETS[0].y);
  for (let i = 1; i < HEX_OFFSETS.length; i++)
    ctx.lineTo(center.x + HEX_OFFSETS[i].x, center.y + HEX_OFFSETS[i].y);
  ctx.closePath();
}

/** Visual ground is separate from the terrain classification used by every placement rule. */
export function createTerrainPainter() {
  let patterns: Record<Terrain, CanvasPattern | null> | undefined;
  let edges:
    | {
        lookup: Lookup;
        bounds: string;
        result: ReturnType<typeof viewportTerrainEdges>;
      }
    | undefined;
  let occupied:
    { placements: readonly Placement[]; cells: Set<string> } | undefined;

  function pine(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
  ) {
    ctx.save();
    ctx.translate(x, y);
    // Trees are small decorative silhouettes, never terrain or collision data.
    ctx.fillStyle = "#30331d25";
    ctx.beginPath();
    ctx.moveTo(-2, 2);
    ctx.lineTo(size * 0.85, size * 0.36);
    ctx.lineTo(size * 0.48, -size * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#615337";
    ctx.fillRect(-0.8, -size * 0.2, 1.6, size * 0.23);
    ctx.fillStyle = "#3f512e";
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(-size * 0.19, -size * 0.12);
    ctx.lineTo(size * 0.22, -size * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#647344";
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(-size * 0.19, -size * 0.12);
    ctx.lineTo(0, -size * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function draw(
    ctx: CanvasRenderingContext2D,
    options: {
      bounds: Bounds;
      terrainAt: Lookup;
      appearance: TerrainAppearance;
      zoom: number;
      showGrid: boolean;
      placements: readonly Placement[];
    },
  ) {
    const { bounds, terrainAt, appearance, zoom, showGrid, placements } =
      options;
    const game = appearance === "game",
      cells: { tile: Tile; terrain: Terrain; ground: Terrain }[] = [];
    if (game && !patterns)
      patterns = {
        grass: texture(ctx, "grass"),
        mud: texture(ctx, "mud"),
        restricted: texture(ctx, "restricted"),
        unknown: texture(ctx, "unknown"),
      };
    for (let y = bounds.minY; y <= bounds.maxY; y++)
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const tile = { x, y },
          terrain = terrainAt(tile);
        // City exclusions and unplaceable mud still have natural ground underneath.
        const ground =
          game && terrain === "restricted"
            ? distance(tile, { x: 500, y: 500 }) <= 35
              ? "mud"
              : "grass"
            : terrain;
        cells.push({ tile, terrain, ground });
      }
    ctx.save();
    // Fill connected cells in one path per surface, avoiding hairline seams with the grid off.
    for (const terrain of ["grass", "mud", "restricted", "unknown"] as const) {
      ctx.beginPath();
      for (const cell of cells)
        if (cell.ground === terrain) appendHex(ctx, cell.tile);
      ctx.fillStyle = game
        ? (patterns?.[terrain] ?? TERRAIN_COLORS.game[terrain])
        : TERRAIN_COLORS.tactical[terrain];
      ctx.fill();
    }
    if (game) {
      ctx.beginPath();
      for (const cell of cells)
        if (cell.terrain === "restricted") appendHex(ctx, cell.tile);
      ctx.fillStyle = "#59474a24";
      ctx.fill();
    }
    if (game && zoom >= 0.65) {
      if (occupied?.placements !== placements)
        occupied = {
          placements,
          cells: new Set(
            placements.flatMap((placement) => footprint(placement, 2).map(key)),
          ),
        };
      for (const cell of cells) {
        if (cell.terrain !== "grass" && cell.terrain !== "mud") continue;
        const seed = hash(cell.tile.x, cell.tile.y, 241);
        if (
          seed > (cell.terrain === "grass" ? 0.012 : 0.005) ||
          occupied.cells.has(key(cell.tile))
        )
          continue;
        if (
          !footprint(cell.tile).every(
            (tile) => terrainAt(tile) === cell.terrain,
          )
        )
          continue;
        const p = worldToPixel(cell.tile),
          size = 15 + hash(cell.tile.x, cell.tile.y, 72) * 9;
        pine(ctx, p.x, p.y + 4, size);
        if (seed < 0.002) pine(ctx, p.x + 7, p.y + 1, size * 0.65);
      }
    }
    if (showGrid) {
      ctx.beginPath();
      for (const cell of cells) appendHex(ctx, cell.tile);
      ctx.strokeStyle = game
        ? zoom < 0.6
          ? "#333c2714"
          : "#333c272d"
        : "#52605755";
      ctx.lineWidth = (game ? 0.55 : 0.6) / zoom;
      ctx.stroke();
    }
    ctx.beginPath();
    for (const cell of cells)
      if (
        cell.terrain === "restricted" &&
        (cell.tile.x + cell.tile.y) % 3 === 0
      ) {
        const p = worldToPixel(cell.tile);
        ctx.moveTo(p.x - 5, p.y - 4);
        ctx.lineTo(p.x + 5, p.y + 4);
      }
    ctx.strokeStyle = game ? "#68445169" : "#b7776d55";
    ctx.lineWidth = 0.9 / zoom;
    ctx.stroke();
    if (game) {
      const boundsKey = `${bounds.minX}:${bounds.maxX}:${bounds.minY}:${bounds.maxY}`;
      if (!edges || edges.lookup !== terrainAt || edges.bounds !== boundsKey)
        edges = {
          lookup: terrainAt,
          bounds: boundsKey,
          result: viewportTerrainEdges(bounds, terrainAt),
        };
      if (!edges.result.truncated) {
        for (const [kind, color] of [
          ["shore", "#8bc0b4"],
          ["restricted", "#865263"],
          ["unknown", "#cedbdc"],
        ] as const) {
          ctx.beginPath();
          for (const [a, b] of edges.result[kind]) {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = kind === "shore" ? "#244b4433" : "#fff6e62b";
          ctx.lineWidth = (kind === "shore" ? 6 : 4) / zoom;
          ctx.stroke();
          ctx.strokeStyle = color;
          ctx.lineWidth = (kind === "shore" ? 1.9 : 1.2) / zoom;
          if (kind !== "shore") ctx.setLineDash([3 / zoom, 3 / zoom]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    ctx.restore();
  }
  return { draw };
}
