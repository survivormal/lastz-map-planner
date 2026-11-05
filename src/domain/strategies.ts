import { z } from "zod";
import {
  distance,
  footprint,
  footprintInBoundary,
  inWorld,
  offset,
  toAxial,
  worldToPixel,
  type Axial,
  type Tile,
} from "./geometry";
import { validatePlacement, type TerrainLookup } from "./placement";
import type { Placement, Spacing } from "./schema";
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
  let { q, r } = vector;
  for (let turn = 0; turn < ((rotation % 6) + 6) % 6; turn++)
    [q, r] = [-r, q + r];
  return { q, r };
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

function validateBoundary(boundary: readonly Tile[]): void {
  if (
    boundary.length < 3 ||
    boundary.length > 2000 ||
    boundary.some((tile) => !inWorld(tile))
  ) {
    throw new RangeError(
      "Choose a closed boundary with 3–2,000 valid world coordinates.",
    );
  }
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
}

/**
 * Bounded, deterministic lattice fill. This is a valid placement proposal, not a packing
 * optimum or a single-loss safety claim. Terrain and clearance are checked for every HQ.
 */
export function smartFillBoundary(options: SmartFillOptions): SmartFillResult {
  const strategy = StrategySchema.parse(options.strategy);
  if (!inWorld(options.anchor))
    throw new RangeError("The anchor must be a valid world coordinate.");
  validateBoundary(options.boundary);
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
    Math.max(100, Math.floor(400_000 / options.boundary.length)),
  );
  const maxPlacements = boundedInteger(
    options.maxPlacements ?? 1_000,
    "maxPlacements",
    5_000,
  );
  if (options.placements.length > 5000)
    throw new RangeError("A plan can contain at most 5,000 placements.");
  const capacity = Math.min(maxPlacements, 5000 - options.placements.length);
  const [a, b] = strategy.basis.map((vector) =>
    rotateStrategyVector(vector, strategy.rotation),
  );
  const determinant = a.q * b.r - a.r * b.q;
  const anchor = toAxial(options.anchor);
  const coefficients = options.boundary.map((tile) => {
    const p = toAxial(tile),
      q = p.q - anchor.q,
      r = p.r - anchor.r;
    return {
      i: (q * b.r - r * b.q) / determinant,
      j: (a.q * r - a.r * q) / determinant,
    };
  });
  const minI = Math.ceil(Math.min(...coefficients.map(({ i }) => i)) - 1e-9);
  const maxI = Math.floor(Math.max(...coefficients.map(({ i }) => i)) + 1e-9);
  const minJ = Math.ceil(Math.min(...coefficients.map(({ j }) => j)) - 1e-9);
  const maxJ = Math.floor(Math.max(...coefficients.map(({ j }) => j)) + 1e-9);
  const candidateCount =
    Math.max(0, maxI - minI + 1) * Math.max(0, maxJ - minJ + 1);
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
  // Traverse coefficient neighbors from the anchor (or the nearest bounded coefficient).
  // The work queue never exceeds four times the explicit candidate cap.
  const queue = [
    {
      i: Math.max(minI, Math.min(maxI, 0)),
      j: Math.max(minJ, Math.min(maxJ, 0)),
    },
  ];
  const visited = new Set<string>([`${queue[0].i},${queue[0].j}`]);
  const ids = new Set(options.placements.map(({ id }) => id));
  const allPlacements = [...options.placements];
  const makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
  for (
    let cursor = 0;
    cursor < queue.length &&
    result.considered < workLimit &&
    result.accepted < capacity;
    cursor++
  ) {
    const { i, j } = queue[cursor];
    for (const [di, dj] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const nextI = i + di,
        nextJ = j + dj,
        key = `${nextI},${nextJ}`;
      if (
        nextI < minI ||
        nextI > maxI ||
        nextJ < minJ ||
        nextJ > maxJ ||
        visited.has(key)
      )
        continue;
      visited.add(key);
      queue.push({ i: nextI, j: nextJ });
    }
    result.considered++;
    const center = offset(options.anchor, {
      q: i * a.q + j * b.q,
      r: i * a.r + j * b.r,
    });
    if (!inWorld(center) || !footprintInBoundary(center, options.boundary)) {
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
    const name = `${options.namePrefix?.trim() || strategy.name} ${String(result.accepted + 1).padStart(2, "0")}`;
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
