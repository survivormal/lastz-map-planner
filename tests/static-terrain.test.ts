import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { offset, footprint } from "../src/domain/geometry";
import blocks from "../src/data/static-blocks-s0.json";
import {
  isStaticBlocked,
  staticTerrainAt,
  staticTerrainAvailable,
  staticTerrainVerified,
  terrainConfidence,
} from "../src/data/static-terrain";

test("derived RLE reconstructs the native LSB-first, one-based bitset exactly", () => {
  const bytes = new Uint8Array(125_000);
  let previousEnd = 0,
    count = 0;
  for (const [start, length] of blocks.runs) {
    assert.ok(start > previousEnd && length > 0 && start + length <= 1_000_000);
    for (let id = start; id < start + length; id++)
      bytes[id >> 3] |= 1 << (id & 7);
    previousEnd = start + length - 1;
    count += length;
  }
  assert.equal(count, 43_279);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    blocks.sourceAssetSha256,
  );
  assert.equal(bytes[0], 4);
  assert.equal(isStaticBlocked({ x: 0, y: 0 }), false);
  assert.equal(isStaticBlocked({ x: 1, y: 0 }), true);
  assert.equal(isStaticBlocked({ x: 2, y: 0 }), false);
  assert.equal(isStaticBlocked({ x: 999, y: 999 }), false);
});

test("cached config boundaries classify the capital and the mud shore exactly", () => {
  const capital = { x: 500, y: 500 };
  assert.ok(
    footprint(capital, 17).every(
      (tile) => staticTerrainAt(tile) === "restricted",
    ),
  );
  for (const radius of [18, 35, 36]) {
    const tile = offset(capital, { q: 0, r: radius });
    assert.equal(isStaticBlocked(tile), false);
    assert.equal(staticTerrainAt(tile), radius <= 35 ? "mud" : "grass");
  }
  // The east turret's own exclusion extends beyond the capital's ring.
  assert.equal(staticTerrainAt({ x: 518, y: 500 }), "restricted");
});

test("city exclusions include every radius-three cell and stop at the next ring", () => {
  const city = { x: 48, y: 48 };
  assert.ok(
    footprint(city, 3).every((tile) => staticTerrainAt(tile) === "restricted"),
  );
  assert.equal(staticTerrainAt(offset(city, { q: 4, r: 0 })), "grass");
});

test("user-confirmed S1 selects the standard baseline without certifying live legality", () => {
  assert.equal(staticTerrainAvailable, true);
  assert.equal(staticTerrainVerified({ x: 700, y: 700 }), true);
  assert.equal(terrainConfidence.liveLegalityVerified, false);
  assert.equal(terrainConfidence.serverApplicability, "user-confirmed-s1-standard-mapping");
  assert.equal(terrainConfidence.userConfirmedDisplaySeason, 1);
  assert.equal(terrainConfidence.worldSeasonSelector, 0);
  assert.equal(terrainConfidence.runtimeWorldSeasonOverrideVerified, false);
  for (const tile of [
    { x: -1, y: 0 },
    { x: 1000, y: 0 },
    { x: 0, y: 1000 },
    { x: 1.5, y: 0 },
  ]) {
    assert.equal(staticTerrainAt(tile), "unknown");
    assert.equal(staticTerrainVerified(tile), false);
  }
  assert.equal(staticTerrainAt({ x: 500, y: 520 }, "season-2"), "unknown");
  assert.equal(staticTerrainVerified({ x: 500, y: 520 }, "season-2"), false);
});
