import { key, type Tile, type Plan, type Terrain } from "../domain";
import { staticTerrainAt, terrainConfidence } from "./static-terrain";

export const PALACE: Tile = { x: 500, y: 500 };
export { terrainConfidence };

/** Cached S0 facts are exact for that installed asset, but its applicability to
 * the active server season has not been established. Keep that distinction at
 * the placement boundary instead of silently blessing the visual layer. */
export function terrainLookup(plan: Plan) {
  const overrides = new Map(
    plan.terrainOverrides.map((t) => [key(t), t.terrain]),
  );
  return {
    display: (tile: Tile): Terrain =>
      overrides.get(key(tile)) ?? staticTerrainAt(tile),
    verified: (tile: Tile): boolean =>
      overrides.has(key(tile)) && overrides.get(key(tile)) !== "unknown",
    rules: (tile: Tile): Terrain =>
      overrides.get(key(tile)) ??
      (plan.settings.allowUnknown ? staticTerrainAt(tile) : "unknown"),
  };
}
