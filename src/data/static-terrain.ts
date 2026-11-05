import {
  distance,
  footprint,
  inWorld,
  pointId,
  type Tile,
} from "../domain/geometry";
import type { Terrain } from "../domain/schema";
import profile from "./world-profile.json";
import blocks from "./static-blocks-s0.json";

/** Standard displayed S1 uses the S0 asset; this is a dated static baseline. */
export const STATIC_TERRAIN_SCENARIO = "normal-s0";
export const staticTerrainAvailable = true;
export const terrainConfidence = Object.freeze({
  scope: "cached-normal-world-static",
  scenario: STATIC_TERRAIN_SCENARIO,
  configSnapshotUTC: "2026-11-04T15:43:01Z",
  checkedAt: "2026-11-05",
  staticAssetMatchedInstalledApk: true,
  staticBlockedTiles: blocks.blockedTileCount,
  userConfirmedDisplaySeason: 1,
  serverApplicability: "user-confirmed-s1-standard-mapping",
  worldSeasonSelector: 0,
  runtimeWorldSeasonOverrideVerified: false,
  liveLegalityVerified: false,
  seasonRule:
    "User-confirmed display S1 maps to raw season 0. Standard world-season fallback selects 0 and WorldBlockIndex_S0. A separate runtime world_season override can change this. Positive world-season N selects S(N+1).",
  limitations: [
    "Server 802 display S1 is user-confirmed; a separate runtime world_season override and current events were not captured.",
    "Dynamic buildings, troops, resources, event restrictions and alliance marker requirements are not included.",
    "Static obstacles are classified as restricted; the source bitset does not distinguish water, rocks or decoration.",
  ],
} as const);

// The native client reads an LSB-first bit at pointId itself, without subtracting
// one. RLE records those exact IDs. Client code bypasses the final ID (1,000,000).
const staticBlocked = new Uint8Array(1_000_001);
for (const [start, length] of blocks.runs)
  staticBlocked.fill(1, start, start + length);

const cityRestricted = new Uint8Array(1_000_001);
for (const city of profile.cities) {
  const radius = city.id === profile.capital.id ? 17 : 3;
  for (const tile of footprint(city, radius)) {
    if (inWorld(tile)) cityRestricted[pointId(tile)] = 1;
  }
}

/** Exact S0 obstacle bit, distinct from city exclusion and mud rules. */
export function isStaticBlocked(tile: Tile): boolean {
  return inWorld(tile) && staticBlocked[pointId(tile)] === 1;
}

/** Whether this cached scenario has a decoded classification for the cell. */
export function staticTerrainVerified(
  tile: Tile,
  scenario: string = STATIC_TERRAIN_SCENARIO,
): boolean {
  return (
    staticTerrainAvailable &&
    scenario === STATIC_TERRAIN_SCENARIO &&
    inWorld(tile)
  );
}

export function staticTerrainAt(
  tile: Tile,
  scenario: string = STATIC_TERRAIN_SCENARIO,
): Terrain {
  if (!staticTerrainVerified(tile, scenario)) return "unknown";
  const id = pointId(tile);
  if (staticBlocked[id] || cityRestricted[id]) return "restricted";
  const d = distance(tile, profile.capital);
  return d > 17 && d <= 35 ? "mud" : "grass";
}
