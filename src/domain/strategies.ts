import { z } from "zod";
import {
  distance,
  footprint,
  footprintInBoundary,
  inWorld,
  normalizeBoundaryPoints,
  pixelToWorld,
  pointInPolygon,
  worldToPixel,
  type Axial,
  type Tile,
} from "./geometry";
import { validatePlacement, type TerrainLookup } from "./placement";
import type { Placement, Spacing } from "./schema";
import { orientVector } from "./orientation";
import { nearestPlotSites } from "./plot";
import {
  CustomStrategySchema,
  StrategySchema,
  STRATEGY_BASIS,
  type Strategy,
} from "./strategy-schema";
export {
  BUILTIN_STRATEGY_IDS,
  CustomStrategySchema,
  StrategySchema,
  STRATEGY_BASIS,
  type Strategy,
} from "./strategy-schema";

export function regularStrategy(spacing: Spacing): Strategy {
  const gap = { tile: 0, tight: 1, loose: 2 }[spacing];
  const pitch = 3 + gap;
  return {
    schemaVersion: 1,
    id: `regular-${spacing}`,
    name: { tile: "By tile", tight: "Tight grid", loose: "Loose grid" }[
      spacing
    ],
    description: `${gap} empty tile${gap === 1 ? "" : "s"} between seven-tile footprints on a regular lattice.`,
    basis: [
      { q: pitch, r: 0 },
      { q: 0, r: pitch },
    ],
    minGap: gap,
    terrain: "any",
    rotation: 0,
    provenance: "User-defined spacing rule.",
  };
}

export const BUILTIN_STRATEGIES: readonly Strategy[] = [
  regularStrategy("tile"),
  regularStrategy("tight"),
  regularStrategy("loose"),
  {
    schemaVersion: 1,
    id: "mud-tight",
    name: "Mud tight stagger",
    description:
      "A 13-cell lattice with one empty tile of clearance. Single-loss protection depends on complete neighboring occupancy; analyze the actual plan after filling.",
    basis: [
      { ...STRATEGY_BASIS["mud-tight"][0] },
      { ...STRATEGY_BASIS["mud-tight"][1] },
    ],
    minGap: 1,
    terrain: "mud",
    rotation: 0,
    provenance:
      "Seven-tile footprint geometry; verified periodic interior only. Wedge edges require separate analysis.",
    source: "docs/map-evidence.md",
  },
  {
    schemaVersion: 1,
    id: "grass-wide",
    name: "Grass wide stagger",
    description:
      "A 19-cell lattice with two empty tiles of clearance, restricted to wholly grass footprints.",
    basis: [
      { ...STRATEGY_BASIS["grass-wide"][0] },
      { ...STRATEGY_BASIS["grass-wide"][1] },
    ],
    minGap: 2,
    terrain: "grass",
    rotation: 0,
    provenance:
      "Seven-tile footprint geometry; no single-loss protection guarantee.",
  },
].map((strategy) => StrategySchema.parse(strategy));

export const StrategyConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    strategies: z.array(CustomStrategySchema).max(100),
  })
  .strict()
  .superRefine(({ strategies }, ctx) => {
    const seen = new Set<string>();
    strategies.forEach((strategy, index) => {
      if (seen.has(strategy.id))
        ctx.addIssue({
          code: "custom",
          message: "Strategy IDs must be unique.",
          path: ["strategies", index, "id"],
        });
      seen.add(strategy.id);
    });
  });

export function parseStrategyConfig(text: string): Strategy[] {
  if (new TextEncoder().encode(text).byteLength > 256_000)
    throw new RangeError("Strategy configuration exceeds 256 KB.");
  const config = StrategyConfigSchema.parse(JSON.parse(text));
  // Built-in IDs are reserved, so a downloaded config cannot silently replace their meaning.
  createStrategyRegistry(config.strategies);
  return config.strategies;
}

export function serializeStrategyConfig(
  strategies: readonly Strategy[],
): string {
  const config = StrategyConfigSchema.parse({ schemaVersion: 1, strategies });
  createStrategyRegistry(config.strategies);
  return JSON.stringify(config, null, 2);
}

export function createStrategyRegistry(custom: readonly Strategy[] = []) {
  const parsed = StrategyConfigSchema.parse({
    schemaVersion: 1,
    strategies: custom,
  }).strategies;
  const strategies = [
    ...BUILTIN_STRATEGIES.map((strategy) => StrategySchema.parse(strategy)),
    ...parsed,
  ];
  const byId = new Map<string, Strategy>();
  for (const strategy of strategies) {
    if (byId.has(strategy.id))
      throw new Error(
        `Strategy ID “${strategy.id}” is reserved or duplicated.`,
      );
    byId.set(strategy.id, strategy);
  }
  return {
    strategies: strategies as readonly Strategy[],
    get: (id: string) => byId.get(id),
  };
}

export function rotateStrategyVector(vector: Axial, rotation: number): Axial {
  return orientVector(vector, rotation);
}

export type SmartFillOptions = {
  anchor: Tile;
  /** Closed polygon vertices in world coordinates. Every footprint must fit fully inside. */
  boundary: readonly Tile[];
  strategy: Strategy;
  placements: readonly Placement[];
  terrainAt: TerrainLookup;
  groupId: string;
  namePrefix?: string;
  kind?: Placement["kind"];
  allowUnknown?: boolean;
  mirrored?: boolean;
  maxCandidates?: number;
  maxPlacements?: number;
  makeId?: () => string;
};
export type SmartFillResult = {
  placements: Placement[];
  accepted: number;
  rejected: {
    boundary: number;
    terrain: number;
    collision: number;
    spacing: number;
  };
  considered: number;
  candidateCount: number;
  truncated: boolean;
  provisional: number;
};

function boundedInteger(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}.`);
  return value;
}

/** Normalize harmless repeated clicks, then validate the complete closed polygon. */
export function validatedClosedBoundary(points: readonly Tile[]): Tile[] {
  if (
    points.length < 3 ||
    points.length > 2000 ||
    points.some((tile) => !inWorld(tile))
  ) {
    throw new RangeError(
      "Choose a closed boundary with 3–2,000 valid world coordinates.",
    );
  }
  const boundary = normalizeBoundaryPoints(points);
  if (boundary.length < 3)
    throw new RangeError(
      "Choose a closed boundary with at least three distinct vertices.",
    );
  const polygon = boundary.map((point) => worldToPixel(point));
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (a.x === b.x && a.y === b.y)
      throw new RangeError("Boundary vertices must be distinct.");
    area += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area) < 1e-7)
    throw new RangeError("The boundary must enclose an area.");
  const orient = (a: Tile, b: Tile, c: Tile) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const between = (a: Tile, b: Tile, c: Tile) =>
    Math.abs(orient(a, b, c)) < 1e-7 &&
    c.x >= Math.min(a.x, b.x) - 1e-7 &&
    c.x <= Math.max(a.x, b.x) + 1e-7 &&
    c.y >= Math.min(a.y, b.y) - 1e-7 &&
    c.y <= Math.max(a.y, b.y) + 1e-7;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      const c = polygon[j],
        d = polygon[(j + 1) % polygon.length];
      if (
        (orient(a, b, c) * orient(a, b, d) < 0 &&
          orient(c, d, a) * orient(c, d, b) < 0) ||
        between(a, b, c) ||
        between(a, b, d) ||
        between(c, d, a) ||
        between(c, d, b)
      ) {
        throw new RangeError("The boundary must not cross or touch itself.");
      }
    }
  }
  return boundary;
}

/** A phase origin near the polygon's center; terrain and footprint legality are checked by fill. */
export function boundaryFillAnchor(boundary: readonly Tile[]): Tile {
  boundary = validatedClosedBoundary(boundary);
  const polygon = boundary.map((tile) => worldToPixel(tile));
  let area = 0,
    sumX = 0,
    sumY = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    sumX += (a.x + b.x) * cross;
    sumY += (a.y + b.y) * cross;
  }
  const center = { x: sumX / (3 * area), y: sumY / (3 * area) };
  const rounded = pixelToWorld(center);
  if (inWorld(rounded) && pointInPolygon(worldToPixel(rounded), polygon))
    return rounded;
  // A concave polygon's centroid may fall outside it. Scan at most 1,000 world rows
  // and select the nearest tile in an interior interval instead of guessing a vertex.
  let best = { ...boundary[0] },
    bestCost = Infinity;
  const consider = (tile: Tile) => {
    const p = worldToPixel(tile),
      cost = (p.x - center.x) ** 2 + (p.y - center.y) ** 2;
    if (
      cost < bestCost - 1e-7 ||
      (Math.abs(cost - bestCost) <= 1e-7 &&
        (tile.y < best.y || (tile.y === best.y && tile.x < best.x)))
    ) {
      best = tile;
      bestCost = cost;
    }
  };
  boundary.forEach(consider);
  const width = worldToPixel({ x: 1, y: 0 }).x - worldToPixel({ x: 0, y: 0 }).x;
  const minY = Math.min(...boundary.map((tile) => tile.y)),
    maxY = Math.max(...boundary.map((tile) => tile.y));
  for (let y = minY; y <= maxY; y++) {
    const origin = worldToPixel({ x: 0, y });
    const intersections: number[] = [],
      intervals: [number, number][] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      if (a.y === origin.y && b.y === origin.y)
        intervals.push([Math.min(a.x, b.x), Math.max(a.x, b.x)]);
      else if (a.y > origin.y !== b.y > origin.y)
        intersections.push(
          a.x + ((origin.y - a.y) * (b.x - a.x)) / (b.y - a.y),
        );
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2)
      intervals.push([intersections[i], intersections[i + 1]]);
    for (const [left, right] of intervals) {
      const first = Math.max(0, Math.ceil((left - origin.x) / width - 1e-9)),
        last = Math.min(999, Math.floor((right - origin.x) / width + 1e-9));
      if (first > last) continue;
      consider({
        x: Math.max(
          first,
          Math.min(last, Math.round((center.x - origin.x) / width)),
        ),
        y,
      });
    }
  }
  return best;
}

/**
 * Bounded, deterministic lattice fill. This is a valid placement proposal, not a packing
 * optimum or a single-loss safety claim. Terrain and clearance are checked for every HQ.
 */
export function smartFillBoundary(options: SmartFillOptions): SmartFillResult {
  const strategy = StrategySchema.parse(options.strategy);
  if (!inWorld(options.anchor))
    throw new RangeError("The anchor must be a valid world coordinate.");
  const boundary = validatedClosedBoundary(options.boundary);
  if (!options.groupId.trim()) throw new RangeError("A group is required.");
  const maxCandidates = boundedInteger(
    options.maxCandidates ?? 10_000,
    "maxCandidates",
    50_000,
  );
  // Footprint containment scales with polygon complexity. Keep a large imported boundary
  // from turning a bounded candidate count into an unbounded browser pause.
  const workLimit = Math.min(
    maxCandidates,
    Math.max(100, Math.floor(400_000 / boundary.length)),
  );
  const maxPlacements = boundedInteger(
    options.maxPlacements ?? 1_000,
    "maxPlacements",
    5_000,
  );
  if (options.placements.length > 5000)
    throw new RangeError("A plan can contain at most 5,000 placements.");
  const capacity = Math.min(maxPlacements, 5000 - options.placements.length);
  const lattice = {
    anchor: options.anchor,
    basis: strategy.basis.map((vector) =>
      orientVector(vector, strategy.rotation, options.mirrored),
    ) as [Axial, Axial],
  };
  const polygon = boundary.map((tile) => worldToPixel(tile));
  const origin = pointInPolygon(worldToPixel(options.anchor), polygon)
    ? options.anchor
    : boundaryFillAnchor(boundary);
  const candidates = nearestPlotSites(
    lattice,
    {
      // An odd-row vertex can extend half a tile beyond an even-row vertex's offset X.
      minX: Math.min(...boundary.map((tile) => tile.x)) - 1,
      maxX: Math.max(...boundary.map((tile) => tile.x)) + 1,
      minY: Math.min(...boundary.map((tile) => tile.y)),
      maxY: Math.max(...boundary.map((tile) => tile.y)),
    },
    origin,
    workLimit,
  );
  const candidateCount = candidates.candidateCount;
  const result: SmartFillResult = {
    placements: [],
    accepted: 0,
    considered: 0,
    candidateCount,
    rejected: { boundary: 0, terrain: 0, collision: 0, spacing: 0 },
    truncated: false,
    provisional: 0,
  };
  if (candidateCount === 0) return result;
  if (capacity === 0) return { ...result, truncated: true };
  const ids = new Set(options.placements.map(({ id }) => id));
  const names = new Set(
    options.placements
      .filter((placement) => placement.groupId === options.groupId)
      .map((placement) => placement.name),
  );
  const prefix = options.namePrefix?.trim() || strategy.name;
  let nextNumber = 1;
  const allPlacements = [...options.placements];
  const makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
  for (
    let cursor = 0;
    cursor < candidates.sites.length && result.accepted < capacity;
    cursor++
  ) {
    result.considered++;
    const center = candidates.sites[cursor].tile;
    if (!inWorld(center) || !footprintInBoundary(center, boundary)) {
      result.rejected.boundary++;
      continue;
    }
    const cells = footprint(center);
    const wrongTerrain = cells.some((tile) => {
      const terrain = options.terrainAt(tile);
      return (
        terrain === "restricted" ||
        (terrain === "unknown"
          ? !options.allowUnknown
          : strategy.terrain !== "any" && terrain !== strategy.terrain)
      );
    });
    if (wrongTerrain) {
      result.rejected.terrain++;
      continue;
    }
    const candidate = { ...center, kind: options.kind ?? "hq" };
    const validation = validatePlacement(candidate, allPlacements, {
      terrainAt: options.terrainAt,
      spacing: "tile",
      allowUnknown: options.allowUnknown,
    });
    if (!validation.valid) {
      if (validation.conflictingIds.length) result.rejected.collision++;
      else result.rejected.terrain++;
      continue;
    }
    if (
      allPlacements.some(
        (existing) => distance(center, existing) < 3 + strategy.minGap,
      )
    ) {
      result.rejected.spacing++;
      continue;
    }
    const id = makeId();
    if (!id || id.length > 120 || ids.has(id))
      throw new Error(
        "Placement ID generator returned an invalid or duplicate ID.",
      );
    ids.add(id);
    let name: string;
    do {
      name = `${prefix} ${String(nextNumber++).padStart(2, "0")}`;
    } while (names.has(name));
    names.add(name);
    if (name.length > 160 || options.groupId.length > 120)
      throw new RangeError("Placement name or group ID is too long.");
    const placement: Placement = {
      ...candidate,
      id,
      name,
      groupId: options.groupId,
      showGraphic: false,
    };
    result.placements.push(placement);
    allPlacements.push(placement);
    result.accepted++;
    if (validation.unknownTiles.length) result.provisional++;
  }
  result.truncated = result.considered < candidateCount;
  return result;
}
