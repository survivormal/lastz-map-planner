import assert from "node:assert/strict";
import test from "node:test";
import {
  optimizeBoundaryFill,
  type BoundaryOptimizationOptions,
} from "../src/domain/boundary-optimizer";
import { auditPlacementSafety } from "../src/domain/edge-safety";
import {
  createStrategyRegistry,
  smartFillBoundary,
} from "../src/domain/strategies";
import {
  footprint,
  footprintInBoundary,
  key,
  type Tile,
} from "../src/domain/geometry";
import type { Terrain } from "../src/domain/schema";

const strategy = createStrategyRegistry().get("mud-tight")!;
function pocket(
  patch: Partial<BoundaryOptimizationOptions> = {},
): BoundaryOptimizationOptions {
  return {
    objective: "fewest",
    boundary: [
      { x: 485, y: 485 },
      { x: 515, y: 485 },
      { x: 515, y: 515 },
      { x: 485, y: 515 },
    ],
    anchor: { x: 500, y: 500 },
    strategy,
    terrainAt: (t): Terrain =>
      t.x >= 488 && t.x <= 512 && t.y >= 488 && t.y <= 512
        ? "mud"
        : "restricted",
    placements: [],
    groupId: "mud",
    maxCandidates: 20_000,
    ...patch,
  };
}
function small(
  patch: Partial<BoundaryOptimizationOptions> = {},
): BoundaryOptimizationOptions {
  return pocket({
    boundary: [
      { x: 498, y: 498 },
      { x: 510, y: 498 },
      { x: 510, y: 505 },
      { x: 498, y: 505 },
    ],
    anchor: { x: 502, y: 502 },
    terrainAt: (t): Terrain =>
      t.x >= 500 && t.x <= 508 && t.y >= 500 && t.y <= 503
        ? "mud"
        : "restricted",
    ...patch,
  });
}
function certify(
  options: BoundaryOptimizationOptions,
  result: ReturnType<typeof optimizeBoundaryFill>,
) {
  assert.equal(result.status, "resolved");
  assert.equal(result.coverageComplete, true);
  assert.deepEqual(result.after, {
    twoFit: 0,
    openCenters: 0,
    uncertain: 0,
    invalid: 0,
  });
  assert.deepEqual(
    result.audit,
    auditPlacementSafety(result.placements, { terrainAt: options.terrainAt }),
  );
  for (const p of result.placements.filter((p) =>
    result.scopedIds.includes(p.id),
  ))
    assert.ok(footprintInBoundary(p, options.boundary));
  const all = new Set(result.placements.flatMap((p) => footprint(p).map(key)));
  const minX = Math.min(...options.boundary.map((t) => t.x)),
    maxX = Math.max(...options.boundary.map((t) => t.x)),
    minY = Math.min(...options.boundary.map((t) => t.y)),
    maxY = Math.max(...options.boundary.map((t) => t.y));
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const center = { x, y },
        cells = footprint(center);
      if (
        footprintInBoundary(center, options.boundary) &&
        cells.every((t) => ["mud", "grass"].includes(options.terrainAt(t)))
      )
        assert.ok(
          cells.some((t) => all.has(key(t))),
          `Uncovered ${key(center)}`,
        );
    }
}

test("fewest uses coordinated repacking below the chosen dense strategy seed count", () => {
  const opts = pocket({
    strategy: {
      ...strategy,
      basis: [
        { q: 2, r: 1 },
        { q: -1, r: 3 },
      ],
      minGap: 0,
    },
    maxMinimizationNodes: 3000,
  });
  const result = optimizeBoundaryFill(opts);
  certify(opts, result);
  assert.ok(result.scopedIds.length < result.seedCount);
  assert.match(result.reason, /Fewest found/);
  assert.match(result.reason, /does not prove a global minimum/);
});

test("fewest preserves every original player by default while minimizing only added HQs", () => {
  const originals = smartFillBoundary(pocket()).placements.map((p, i) => ({
    ...p,
    name: `Player ${i}`,
    groupId: i % 2 ? "alpha" : "beta",
    showGraphic: i % 3 === 0,
  }));
  const opts = pocket({ placements: originals, maxMinimizationNodes: 3000 });
  const before = structuredClone(originals),
    result = optimizeBoundaryFill(opts);
  certify(opts, result);
  assert.ok(result.scopedIds.length < 76);
  assert.ok(result.scopedIds.length >= originals.length);
  assert.deepEqual(result.removedIds, []);
  for (const old of originals) {
    const next = result.placements.find((p) => p.id === old.id)!;
    assert.ok(next);
    for (const field of ["name", "groupId", "showGraphic", "kind"] as const)
      assert.equal(next[field], old[field]);
  }
  assert.deepEqual(originals, before);
});

test("permission to remove assigned inside HQs affects only fewest mode", () => {
  const starter = optimizeBoundaryFill(
    small({ objective: "repair" }),
  ).placements.map((p, i) => ({
    ...p,
    id: `assigned-${i}`,
    name: `Member ${i}`,
    groupId: "team",
    showGraphic: true,
    clusterId: "cluster",
  }));
  const keep = optimizeBoundaryFill(small({ placements: starter }));
  assert.equal(keep.scopedIds.length, 3);
  assert.deepEqual(keep.removedIds, []);
  assert.doesNotMatch(keep.reason, /Reduced from/);
  const opts = small({ placements: starter, preserveExisting: false });
  const fewer = optimizeBoundaryFill(opts);
  certify(opts, fewer);
  assert.equal(fewer.scopedIds.length, 2);
  assert.equal(fewer.removedIds.length, 1);
  assert.ok(starter.some((p) => p.id === fewer.removedIds[0]));
  for (const p of fewer.placements) {
    const old = starter.find((o) => o.id === p.id)!;
    assert.equal(p.name, old.name);
    assert.equal(p.groupId, old.groupId);
    assert.equal(p.showGraphic, true);
    assert.equal(
      p.clusterId,
      fewer.movedIds.includes(p.id) ? undefined : old.clusterId,
    );
  }
  assert.deepEqual(
    optimizeBoundaryFill(
      small({
        objective: "repair",
        placements: starter,
        preserveExisting: false,
      }),
    ),
    optimizeBoundaryFill(
      small({
        objective: "repair",
        placements: starter,
        preserveExisting: true,
      }),
    ),
  );
});

test("fewest can return a safe bounded best-found result without claiming a finished minimum search", () => {
  const opts = small({ maxMinimizationNodes: 0 }),
    result = optimizeBoundaryFill(opts);
  certify(opts, result);
  assert.equal(result.scopedIds.length, 3);
  assert.equal(result.truncated, true);
  assert.match(result.reason, /work limit/);
  for (const maxMinimizationNodes of [-1, Infinity, 100001, 1.5])
    assert.throws(() => optimizeBoundaryFill(small({ maxMinimizationNodes })));
});

test("fewest fails closed when repair cannot establish zero risk and complete coverage", () => {
  const opts = small({ terrainAt: () => "mud" });
  const repair = optimizeBoundaryFill({ ...opts, objective: "repair" });
  assert.ok(repair.after.twoFit > 0 || repair.after.openCenters > 0);
  const fewest = optimizeBoundaryFill(opts);
  assert.equal(fewest.status, "blocked");
  assert.match(fewest.reason, /No qualifying layout/);
  assert.deepEqual(fewest.placements, repair.placements);
  const unknown = optimizeBoundaryFill(
    small({ terrainAt: () => "unknown", allowUnknown: true }),
  );
  assert.equal(unknown.status, "blocked");
  assert.ok(unknown.after.uncertain > 0);
});
