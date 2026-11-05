import { key, type Tile, type Plan, type Terrain } from "../domain";
import {
  staticTerrainAt,
  staticTerrainVerified,
  terrainConfidence,
} from "./static-terrain";

export const PALACE: Tile = { x: 500, y: 500 };
export { terrainConfidence };

/** User-confirmed S1 follows the client's standard S0 asset mapping. This is a
 * static planning baseline; current occupancy/events and server overrides are
 * not live observations. Unsupported profiles keep unmapped tiles unknown. */
export function terrainLookup(plan: Plan) {
  const overrides = new Map(
    plan.terrainOverrides.map((t) => [key(t), t.terrain]),
  );
  const base = (tile: Tile): Terrain =>
    plan.settings.terrainProfile === "s1-standard"
      ? staticTerrainAt(tile)
      : "unknown";
  return {
    display: (tile: Tile): Terrain => overrides.get(key(tile)) ?? base(tile),
    verified: (tile: Tile): boolean =>
      overrides.has(key(tile))
        ? overrides.get(key(tile)) !== "unknown"
        : plan.settings.terrainProfile === "s1-standard" &&
          staticTerrainVerified(tile),
    rules: (tile: Tile): Terrain => overrides.get(key(tile)) ?? base(tile),
  };
}
