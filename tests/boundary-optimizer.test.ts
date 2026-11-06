import assert from "node:assert/strict";
import test from "node:test";
import {
  optimizeBoundaryFill,
  type BoundaryOptimizationOptions,
} from "../src/domain/boundary-optimizer";
import { auditPlacementSafety } from "../src/domain/edge-safety";
import {
  footprint,
  footprintInBoundary,
  key,
  offset,
  type Tile,
} from "../src/domain/geometry";
import {
  smartFillBoundary,
  createStrategyRegistry,
} from "../src/domain/strategies";
import { validatePlacement } from "../src/domain/placement";
import type { Placement, Terrain } from "../src/domain/schema";
import { staticTerrainAt } from "../src/data/static-terrain";

const strategy = createStrategyRegistry().get("mud-tight")!;
const boundedMud = (tile: Tile): Terrain =>
  tile.x >= 488 && tile.x <= 512 && tile.y >= 488 && tile.y <= 512
    ? "mud"
    : "restricted";
const boundary = [
  { x: 485, y: 485 },
  { x: 515, y: 485 },
  { x: 515, y: 515 },
  { x: 485, y: 515 },
];
function options(
  patch: Partial<BoundaryOptimizationOptions> = {},
): BoundaryOptimizationOptions {
  return {
    boundary,
    anchor: { x: 500, y: 500 },
    strategy,
    placements: [],
    terrainAt: boundedMud,
    groupId: "mud",
    ...patch,
  };
}
function hq(tile: Tile, id: string): Placement {
  return {
    ...tile,
    id,
    kind: "hq",
    name: `Assigned ${id}`,
    groupId: "mud",
    showGraphic: true,
  };
}
function verifyLegal(
  result: ReturnType<typeof optimizeBoundaryFill>,
  opts: BoundaryOptimizationOptions,
) {
  assert.ok(result.scopedIds.length >= result.seedCount);
  const original = new Map(opts.placements.map((p) => [p.id, p]));
  for (const p of result.placements) {
    assert.ok(
      validatePlacement(p, result.placements, {
        terrainAt: opts.terrainAt,
        ignoreId: p.id,
      }).valid,
      `Invalid ${p.id}`,
    );
    if (!original.has(p.id) || result.movedIds.includes(p.id))
      assert.ok(footprintInBoundary(p, opts.boundary));
    const previous = original.get(p.id);
    if (previous)
      for (const field of ["name", "groupId", "kind", "showGraphic"] as const)
        assert.equal(p[field], previous[field]);
  }
  for (const old of opts.placements)
    assert.equal(result.placements.filter((p) => p.id === old.id).length, 1);
  const baseline = auditPlacementSafety(opts.placements, {
    terrainAt: opts.terrainAt,
  });
  const final = auditPlacementSafety(result.placements, {
    terrainAt: opts.terrainAt,
  });
  for (const old of baseline.entries)
    if (
      old.confidence === "known" &&
      !old.placementIssues.length &&
      old.analysis.risk !== "two-fit"
    )
      assert.notEqual(
        final.entries.find((e) => e.placementId === old.placementId)!.analysis
          .risk,
        "two-fit",
      );
  assert.equal(final.summary.invalidCount, 0);
  assert.deepEqual(result.audit, final);
}

test("coordinated packing closes both losses and open centers against actual restricted terrain", () => {
  const opts = options();
  const result = optimizeBoundaryFill(opts);
  assert.deepEqual(result.before, {
    twoFit: 22,
    openCenters: 17,
    uncertain: 0,
    invalid: 0,
  });
  assert.equal(result.seedCount, 40);
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.after, {
    twoFit: 0,
    openCenters: 0,
    uncertain: 0,
    invalid: 0,
  });
  assert.ok(result.scopedIds.length >= 70);
  assert.equal(result.openCenterSamples.length, 0);
  verifyLegal(result, opts);
});

test("repacking preserves every assigned player and fixed blocker and detaches only moved cluster members", () => {
  const old = smartFillBoundary(options()).placements.map((p, i) => ({
    ...p,
    name: `Player ${i}`,
    groupId: i % 2 ? "squad-a" : "squad-b",
    clusterId: "original-cluster",
    showGraphic: i % 3 === 0,
  }));
  const blocker = { ...hq({ x: 700, y: 700 }, "wood"), kind: "wood" as const };
  const terrainAt = (tile: Tile): Terrain =>
    footprint(blocker).some((cell) => key(cell) === key(tile))
      ? "grass"
      : boundedMud(tile);
  const opts = options({ placements: [...old, blocker], terrainAt });
  const snapshot = structuredClone(opts.placements);
  const result = optimizeBoundaryFill(opts);
  assert.equal(result.status, "resolved");
  assert.ok(result.movedIds.length > 1);
  assert.ok(result.addedIds.length > 0);
  assert.deepEqual(
    result.placements.find((p) => p.id === blocker.id),
    blocker,
  );
  for (const p of result.placements.filter((p) =>
    old.some((o) => o.id === p.id),
  ))
    assert.equal(
      p.clusterId,
      result.movedIds.includes(p.id) ? undefined : "original-cluster",
    );
  assert.deepEqual(opts.placements, snapshot);
  verifyLegal(result, opts);
  assert.deepEqual(optimizeBoundaryFill(opts), result);
});

test("S1 mud shoreline repair may straddle grass while retaining mud contact and reports deep grass gaps", () => {
  const opts = options({
    boundary: [
      { x: 460, y: 490 },
      { x: 480, y: 490 },
      { x: 480, y: 512 },
      { x: 460, y: 512 },
    ],
    anchor: { x: 468, y: 502 },
    terrainAt: staticTerrainAt,
  });
  const result = optimizeBoundaryFill(opts);
  assert.equal(result.status, "improved");
  assert.ok(result.after.twoFit < result.before.twoFit);
  assert.ok(result.after.openCenters < result.before.openCenters);
  assert.ok(result.after.openCenters > 0);
  assert.match(result.reason, /terrain outside the chosen strategy/);
  assert.ok(
    result.placements.some(
      (p) =>
        footprint(p).some((t) => staticTerrainAt(t) === "grass") &&
        footprint(p).some((t) => staticTerrainAt(t) === "mud"),
    ),
  );
  assert.ok(
    result.placements.every((p) =>
      footprint(p).some((t) => staticTerrainAt(t) === "mud"),
    ),
  );
  verifyLegal(result, opts);
});

test("S1 restricted-core optimizer improves losses and closes open centers without deleting any seed HQ", () => {
  const opts = options({
    boundary: [
      { x: 474, y: 490 },
      { x: 490, y: 490 },
      { x: 490, y: 512 },
      { x: 474, y: 512 },
    ],
    anchor: { x: 480, y: 500 },
    terrainAt: staticTerrainAt,
  });
  const result = optimizeBoundaryFill(opts);
  assert.ok(result.after.twoFit < result.before.twoFit);
  assert.equal(result.after.openCenters, 0);
  assert.ok(result.scopedIds.length >= result.seedCount);
  verifyLegal(result, opts);
});

test("originally protected outside HQs remain fixed and protected while inside neighbors are rearranged", () => {
  const center = { x: 100, y: 100 };
  const vectors = [
    { q: 0, r: 0 },
    { q: 3, r: 1 },
    { q: -1, r: 4 },
    { q: -4, r: 3 },
    { q: -3, r: -1 },
    { q: 1, r: -4 },
    { q: 4, r: -3 },
  ];
  const placements = vectors.map((vector, i) =>
    hq(offset(center, vector), `old${i}`),
  );
  const opts = options({
    placements,
    terrainAt: () => "mud",
    anchor: { x: 100, y: 95 },
    boundary: [
      { x: 90, y: 90 },
      { x: 110, y: 90 },
      { x: 110, y: 99 },
      { x: 90, y: 99 },
    ],
  });
  const before = auditPlacementSafety(placements, {
    terrainAt: opts.terrainAt,
  });
  assert.equal(before.entries[0].analysis.risk, "one-fit");
  const result = optimizeBoundaryFill(opts);
  assert.deepEqual(
    result.placements.find((p) => p.id === "old0"),
    placements[0],
  );
  verifyLegal(result, opts);
});

test("invalid movable HQ overlap can be repaired but invalid fixed buildings block trustworthy packing", () => {
  const opts = options({
    placements: [hq({ x: 500, y: 500 }, "one"), hq({ x: 500, y: 500 }, "two")],
  });
  const result = optimizeBoundaryFill(opts);
  assert.ok(result.before.invalid >= 2);
  assert.equal(result.after.invalid, 0);
  assert.ok(result.status === "resolved" || result.status === "improved");
  verifyLegal(result, opts);
  const invalid = optimizeBoundaryFill(
    options({
      placements: [{ ...hq({ x: 500, y: 500 }, "bad-food"), kind: "food" }],
    }),
  );
  assert.equal(invalid.status, "blocked");
  assert.match(invalid.reason, /fixed outside HQ or food\/wood blocker/);
  assert.ok(invalid.after.invalid > 0);
});

test("unknown terrain or unknown enemy-placement halo never produces a resolved packing, even in sandbox", () => {
  const allUnknown = optimizeBoundaryFill(
    options({ terrainAt: () => "unknown", allowUnknown: true }),
  );
  assert.equal(allUnknown.status, "blocked");
  assert.ok(allUnknown.after.uncertain > 0);
  assert.equal(allUnknown.addedIds.length, 0);
  const cells = new Set(footprint({ x: 500, y: 500 }, 3).map(key));
  const halo = optimizeBoundaryFill(
    options({
      boundary: [
        { x: 498, y: 498 },
        { x: 502, y: 498 },
        { x: 502, y: 502 },
        { x: 498, y: 502 },
      ],
      terrainAt: (tile) => (cells.has(key(tile)) ? "mud" : "unknown"),
    }),
  );
  assert.equal(halo.status, "blocked");
  assert.ok(halo.after.uncertain > 0);
});

test("limits stay explicit, never create a false zero, and leave original assignments intact", () => {
  const unchanged = optimizeBoundaryFill(options({ maxEvaluations: 0 }));
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.evaluated, 0);
  assert.equal(unchanged.truncated, true);
  assert.deepEqual(unchanged.before, unchanged.after);
  const limit = optimizeBoundaryFill(
    options({ maxEvaluations: 1, maxPasses: 1 }),
  );
  assert.ok(limit.evaluated <= 1);
  assert.ok(limit.passes <= 1);
  const cells = new Set(footprint({ x: 500, y: 500 }).map(key));
  const clipped = optimizeBoundaryFill(
    options({
      maxCandidates: 1,
      terrainAt: (tile) => (cells.has(key(tile)) ? "mud" : "restricted"),
    }),
  );
  assert.equal(clipped.truncated, true);
  assert.notEqual(clipped.status, "resolved");
  assert.ok(clipped.scopedIds.length >= clipped.seedCount);
  const noCapacity = optimizeBoundaryFill(options({ maxPlacements: 0 }));
  assert.equal(noCapacity.status, "blocked");
  assert.equal(noCapacity.addedIds.length, 0);
  for (const patch of [
    { maxCandidates: NaN },
    { maxEvaluations: -1 },
    { maxPasses: Infinity },
    { maxPlacements: -1 },
  ])
    assert.throws(() => optimizeBoundaryFill(options(patch)));
});

test("a capped wide-area packing cannot hide loss warnings by creating a larger open region", () => {
  const result = optimizeBoundaryFill(
    options({
      boundary: [
        { x: 450, y: 450 },
        { x: 550, y: 450 },
        { x: 550, y: 550 },
        { x: 450, y: 550 },
      ],
      terrainAt: () => "mud",
      maxCandidates: 20_000,
      maxPlacements: 100,
      maxEvaluations: 800,
    }),
  );
  assert.ok(result.after.twoFit <= result.before.twoFit);
  assert.ok(result.after.openCenters <= result.before.openCenters);
  assert.ok(result.scopedIds.length >= result.seedCount);
  assert.equal(result.truncated, true);
  assert.notEqual(result.status, "resolved");
});
