import { distance, footprint, inWorld, key, type Tile } from "./geometry";
import type { AllianceAnchorKind, Placement, Spacing, Terrain } from "./schema";

export type TerrainLookup = (tile: Tile) => Terrain;
export type PlacementCandidate = Tile & {
  kind: Placement["kind"];
  id?: string;
};
export type PlacementOptions = {
  terrainAt: TerrainLookup;
  spacing?: Spacing;
  ignoreId?: string;
  /** Explicit planning sandbox; never treats unknown cells as verified terrain. */
  allowUnknown?: boolean;
  /** Optional verified alliance leader/rally coordinate for food/wood range checks. */
  allianceAnchor?: Tile;
  /** Active rally takes precedence in game; leader is the conservative default. */
  allianceAnchorKind?: AllianceAnchorKind;
};
export type PlacementValidation = {
  valid: boolean;
  issues: string[];
  tiles: Tile[];
  conflictingIds: string[];
  unknownTiles: Tile[];
};

export const SPACING_GAPS: Record<Spacing, number> = {
  tile: 0,
  tight: 1,
  loose: 2,
};
export const SPACING_PITCH: Record<Spacing, number> = {
  tile: 3,
  tight: 4,
  loose: 5,
};
export const ALLIANCE_BUILD_RANGE = 50;

/** Food/wood radius one is game-config verified; HQ follows the requested seven-tile model. */
export function placementFootprint(candidate: PlacementCandidate): Tile[] {
  return footprint(candidate, 1);
}

export function terrainWithOverrides(
  base: TerrainLookup,
  overrides: readonly (Tile & { terrain: Terrain })[],
): TerrainLookup {
  const cells = new Map(overrides.map((cell) => [key(cell), cell.terrain]));
  return (tile) => cells.get(key(tile)) ?? base(tile);
}

/** Check every occupied cell, including footprint edges and requested empty-tile clearance. */
export function validatePlacement(
  candidate: PlacementCandidate,
  placements: readonly Placement[],
  options: PlacementOptions,
): PlacementValidation {
  const issues: string[] = [],
    conflictingIds: string[] = [],
    unknownTiles: Tile[] = [];
  if (!Number.isInteger(candidate.x) || !Number.isInteger(candidate.y)) {
    return {
      valid: false,
      issues: ["Choose a whole hex tile."],
      tiles: [],
      conflictingIds,
      unknownTiles,
    };
  }
  const tiles = placementFootprint(candidate);
  if (tiles.some((tile) => !inWorld(tile)))
    issues.push("The full footprint must stay inside the world.");
  const restricted = tiles.filter(
    (tile) => inWorld(tile) && options.terrainAt(tile) === "restricted",
  );
  if (restricted.length)
    issues.push(
      `Footprint crosses ${restricted.length} restricted tile${restricted.length === 1 ? "" : "s"}.`,
    );
  if (
    candidate.kind !== "hq" &&
    tiles.some((tile) => inWorld(tile) && options.terrainAt(tile) === "mud")
  ) {
    issues.push("Alliance food and wood buildings cannot occupy mud tiles.");
  }
  const allianceAnchor = options.allianceAnchor;
  if (candidate.kind !== "hq" && allianceAnchor) {
    if (!inWorld(allianceAnchor)) {
      issues.push(
        "The alliance leader/rally marker must be a valid world coordinate.",
      );
    } else {
      const rally = options.allianceAnchorKind === "rally";
      const exclusionRadius = rally ? 0 : 1;
      if (tiles.some((tile) => distance(tile, allianceAnchor) <= exclusionRadius)) {
        issues.push(
          rally
            ? "Alliance food/wood must not cover the rally-marker tile."
            : "Alliance food/wood must clear the leader's seven-tile HQ footprint.",
        );
      }
      if (tiles.some((tile) => distance(tile, allianceAnchor) > ALLIANCE_BUILD_RANGE)) {
        issues.push(
          `Every alliance food/wood tile must be within ${ALLIANCE_BUILD_RANGE} hex steps of the leader/rally marker.`,
        );
      }
    }
  }
  unknownTiles.push(
    ...tiles.filter(
      (tile) => inWorld(tile) && options.terrainAt(tile) === "unknown",
    ),
  );
  if (unknownTiles.length && !options.allowUnknown)
    issues.push(
      "Terrain is unverified here. Enable the planning sandbox to place provisionally.",
    );

  const gap = SPACING_GAPS[options.spacing ?? "tile"];
  for (const existing of placements) {
    if (existing.id === options.ignoreId) continue;
    // Equal radius-one hex disks cannot overlap or violate clearance beyond this distance.
    if (distance(candidate, existing) > 2 + gap) continue;
    const existingTiles = placementFootprint(existing);
    const minTileDistance = Math.min(
      ...tiles.flatMap((a) => existingTiles.map((b) => distance(a, b))),
    );
    if (minTileDistance <= gap) {
      conflictingIds.push(existing.id);
      issues.push(
        minTileDistance === 0
          ? `Overlaps ${existing.name}.`
          : `Needs ${gap} empty tile${gap === 1 ? "" : "s"} before ${existing.name}.`,
      );
    }
  }
  return {
    valid: issues.length === 0,
    issues,
    tiles,
    conflictingIds,
    unknownTiles,
  };
}

/** The game requires an HQ relocation footprint to clear its previous footprint entirely. */
export function validateMove(
  from: Placement,
  to: Tile,
  placements: readonly Placement[],
  options: PlacementOptions,
): PlacementValidation {
  const result = validatePlacement({ ...from, ...to }, placements, {
    ...options,
    ignoreId: from.id,
  });
  if (from.x === to.x && from.y === to.y) return result;
  if (from.kind === "hq") {
    const before = new Set(placementFootprint(from).map(key));
    if (result.tiles.some((tile) => before.has(key(tile)))) {
      result.issues.push(
        "An HQ move must clear its previous seven-tile footprint.",
      );
      result.valid = false;
    }
  }
  return result;
}

export type ReplacementAnalysis = {
  risk: "two-fit" | "one-fit" | "none";
  newlyEnabled: Tile[];
  existingOpen: Tile[];
  witnessPair?: [Tile, Tile];
  unknownTiles: Tile[];
  scope: string;
};

/**
 * One-loss local analysis: any newly legal radius-one HQ must have overlapped the removed HQ,
 * so its center is within distance two. Enemies need only avoid overlap, not friendly spacing.
 */
export function analyzeReplacement(
  target: Placement,
  placements: readonly Placement[],
  options: Pick<PlacementOptions, "terrainAt" | "allowUnknown">,
): ReplacementAnalysis {
  const newlyEnabled: Tile[] = [],
    existingOpen: Tile[] = [];
  const unknown = new Map<string, Tile>();
  const candidates = footprint(target, 2);
  // Also inventory already-open centers in the immediate surrounding ring. These are separate
  // from openings caused by losing this base and do not inflate the one-loss result.
  const surrounding = footprint(target, 4).filter(
    (tile) => distance(tile, target) > 2,
  );
  const occupancy = placements.some((placement) => placement.id === target.id)
    ? placements
    : [...placements, target];
  for (const center of [...candidates, ...surrounding]) {
    const candidate = { ...center, kind: "hq" as const };
    const after = validatePlacement(candidate, occupancy, {
      ...options,
      spacing: "tile",
      ignoreId: target.id,
    });
    after.unknownTiles.forEach((tile) => unknown.set(key(tile), tile));
    if (!after.valid) continue;
    const before = validatePlacement(candidate, occupancy, {
      ...options,
      spacing: "tile",
    });
    if (before.valid) existingOpen.push(center);
    else if (distance(center, target) <= 2) newlyEnabled.push(center);
  }
  let witnessPair: [Tile, Tile] | undefined;
  outer: for (let i = 0; i < newlyEnabled.length; i++) {
    for (let j = i + 1; j < newlyEnabled.length; j++) {
      if (distance(newlyEnabled[i], newlyEnabled[j]) >= 3) {
        witnessPair = [newlyEnabled[i], newlyEnabled[j]];
        break outer;
      }
    }
  }
  return {
    risk: witnessPair ? "two-fit" : newlyEnabled.length ? "one-fit" : "none",
    newlyEnabled,
    existingOpen,
    witnessPair,
    unknownTiles: [...unknown.values()],
    scope:
      "One removed HQ; every other shown building remains. Only newly opened seven-tile HQ footprints are compared. Existing openings within four tiles are listed separately. Terrain, unmodeled objects, multiple losses, and game teleport rules can change the outcome.",
  };
}
