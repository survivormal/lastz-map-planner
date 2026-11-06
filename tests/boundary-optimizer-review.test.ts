import assert from "node:assert/strict";
import test from "node:test";
import { optimizeBoundaryFill } from "../src/domain/boundary-optimizer";
import { createPlan, type Placement } from "../src/domain/schema";
import { terrainLookup } from "../src/data/terrain";
import { footprintInBoundary, type Tile } from "../src/domain/geometry";
import {
  createStrategyRegistry,
  smartFillBoundary,
} from "../src/domain/strategies";
import type { TerrainLookup } from "../src/domain/placement";

const mudStrategy = createStrategyRegistry().get("mud-tight")!;
const tileKey = ({ x, y }: Tile) => `${x},${y}`;

// Independent odd-r cell construction and set intersections: no radius-two center
// shortcut or production loss analyzer is used to verify the optimizer's claims.
function cells({ x, y }: Tile): Tile[] {
  return [
    { x, y },
    { x: x - 1, y },
    { x: x + 1, y },
    { x: x + (y & 1) - 1, y: y - 1 },
    { x: x + (y & 1), y: y - 1 },
    { x: x + (y & 1) - 1, y: y + 1 },
    { x: x + (y & 1), y: y + 1 },
  ];
}
const occupied = (tile: Tile) => new Set(cells(tile).map(tileKey));
const intersects = (a: Set<string>, b: Set<string>) =>
  [...a].some((key) => b.has(key));
function legal(tile: Tile, terrainAt: TerrainLookup): boolean {
  return cells(tile).every(
    (cell) =>
      cell.x >= 0 &&
      cell.x <= 999 &&
      cell.y >= 0 &&
      cell.y <= 999 &&
      ["grass", "mud"].includes(terrainAt(cell)),
  );
}
function lossOracle(
  placements: readonly Placement[],
  target: Placement,
  terrainAt: TerrainLookup,
) {
  const retained = new Set(
    placements
      .filter((p) => p.id !== target.id)
      .flatMap((p) => [...occupied(p)]),
  );
  const removed = occupied(target);
  const newlyEnabled: Tile[] = [];
  for (let y = target.y - 3; y <= target.y + 3; y++)
    for (let x = target.x - 3; x <= target.x + 3; x++) {
      const tile = { x, y },
        footprint = occupied(tile);
      if (
        legal(tile, terrainAt) &&
        intersects(footprint, removed) &&
        !intersects(footprint, retained)
      )
        newlyEnabled.push(tile);
    }
  let twoFit = false;
  for (let i = 0; i < newlyEnabled.length; i++)
    for (let j = i + 1; j < newlyEnabled.length; j++)
      if (!intersects(occupied(newlyEnabled[i]), occupied(newlyEnabled[j])))
        twoFit = true;
  return { twoFit, newlyEnabled };
}
function openOracle(
  placements: readonly Placement[],
  boundary: readonly Tile[],
  terrainAt: TerrainLookup,
): Tile[] {
  const taken = new Set(placements.flatMap((p) => [...occupied(p)]));
  const open: Tile[] = [];
  for (
    let y = Math.max(0, Math.min(...boundary.map((p) => p.y)) - 1);
    y <= Math.min(999, Math.max(...boundary.map((p) => p.y)) + 1);
    y++
  )
    for (
      let x = Math.max(0, Math.min(...boundary.map((p) => p.x)) - 1);
      x <= Math.min(999, Math.max(...boundary.map((p) => p.x)) + 1);
      x++
    ) {
      const tile = { x, y };
      if (
        legal(tile, terrainAt) &&
        footprintInBoundary(tile, boundary) &&
        !intersects(occupied(tile), taken)
      )
        open.push(tile);
    }
  return open;
}
function verifyResult(
  result: ReturnType<typeof optimizeBoundaryFill>,
  boundary: readonly Tile[],
  terrainAt: TerrainLookup,
) {
  const scoped = new Set(result.scopedIds);
  let risks = 0;
  for (const placement of result.placements.filter((p) => p.kind === "hq")) {
    const oracle = lossOracle(result.placements, placement, terrainAt);
    const report = result.audit.entries.find(
      (entry) => entry.placementId === placement.id,
    )!;
    assert.equal(report.analysis.risk === "two-fit", oracle.twoFit);
    assert.deepEqual(
      report.analysis.newlyEnabled.map(tileKey).sort(),
      oracle.newlyEnabled.map(tileKey).sort(),
    );
    if (scoped.has(placement.id) && oracle.twoFit) risks++;
  }
  assert.equal(result.after.twoFit, risks);
  assert.equal(
    result.after.openCenters,
    openOracle(result.placements, boundary, terrainAt).length,
  );
  for (let i = 0; i < result.placements.length; i++) {
    assert.ok(legal(result.placements[i], terrainAt));
    for (let j = 0; j < i; j++)
      assert.ok(
        !intersects(
          occupied(result.placements[i]),
          occupied(result.placements[j]),
        ),
      );
  }
}
function hq(tile: Tile, id: string): Placement {
  return {
    ...tile,
    id,
    name: `Player ${id}`,
    groupId: "mud",
    kind: "hq",
    showGraphic: true,
  };
}

test("optimizer reaches a closed terrain pocket and independent cell intersections verify every loss", () => {
  const boundary = [
    { x: 485, y: 485 },
    { x: 515, y: 485 },
    { x: 515, y: 515 },
    { x: 485, y: 515 },
  ];
  const terrainAt: TerrainLookup = (tile) =>
    tile.x >= 488 && tile.x <= 512 && tile.y >= 488 && tile.y <= 512
      ? "mud"
      : "restricted";
  const options = {
    boundary,
    anchor: { x: 500, y: 500 },
    strategy: mudStrategy,
    terrainAt,
    groupId: "mud",
  };
  const existing = smartFillBoundary({
    ...options,
    placements: [],
  }).placements.map((p, i) => ({
    ...p,
    id: `assigned-${i}`,
    name: `Assigned player ${i}`,
    showGraphic: i % 2 === 0,
    clusterId: "original-cluster",
  }));
  const snapshot = structuredClone(existing);
  const result = optimizeBoundaryFill({
    ...options,
    placements: existing,
    maxEvaluations: 1000,
    maxPasses: 3,
  });
  assert.equal(result.status, "resolved");
  assert.ok(result.before.twoFit >= 20);
  assert.equal(result.after.twoFit, 0);
  assert.equal(result.after.openCenters, 0);
  assert.ok(result.addedIds.length > 0);
  for (const original of existing) {
    const retained = result.placements.find((p) => p.id === original.id)!;
    assert.ok(retained);
    assert.deepEqual(
      {
        name: retained.name,
        groupId: retained.groupId,
        kind: retained.kind,
        showGraphic: retained.showGraphic,
      },
      {
        name: original.name,
        groupId: original.groupId,
        kind: original.kind,
        showGraphic: original.showGraphic,
      },
    );
    assert.equal(
      retained.clusterId,
      result.movedIds.includes(original.id) ? undefined : original.clusterId,
    );
  }
  assert.deepEqual(existing, snapshot);
  verifyResult(result, boundary, terrainAt);
});

test("real S1 shore optimization retains assignments and never exposes a previously protected HQ", () => {
  const boundary = [
    { x: 466, y: 495 },
    { x: 480, y: 495 },
    { x: 480, y: 510 },
    { x: 470, y: 510 },
  ];
  const terrainAt = terrainLookup(createPlan()).rules;
  const options = {
    boundary,
    anchor: { x: 470, y: 502 },
    strategy: mudStrategy,
    terrainAt,
    groupId: "mud",
  };
  const existing = smartFillBoundary({ ...options, placements: [] }).placements;
  const protectedIds = existing
    .filter((p) => !lossOracle(existing, p, terrainAt).twoFit)
    .map((p) => p.id);
  const result = optimizeBoundaryFill({ ...options, placements: existing });
  assert.ok(result.after.twoFit <= result.before.twoFit - 2);
  assert.equal(result.after.openCenters, 0);
  for (const original of existing) {
    const retained = result.placements.find((p) => p.id === original.id)!;
    assert.ok(retained);
    assert.equal(retained.name, original.name);
    assert.equal(retained.groupId, original.groupId);
    assert.ok(footprintInBoundary(retained, boundary));
    assert.ok(cells(retained).some((tile) => terrainAt(tile) === "mud"));
  }
  for (const id of protectedIds)
    assert.equal(
      lossOracle(
        result.placements,
        result.placements.find((p) => p.id === id)!,
        terrainAt,
      ).twoFit,
      false,
    );
  verifyResult(result, boundary, terrainAt);
});

test("outside HQs and a food blocker remain fixed while the guarded S1 fill reaches zero within its boundary", () => {
  const boundary = [
    { x: 502, y: 475 },
    { x: 501, y: 477 },
    { x: 499, y: 477 },
    { x: 498, y: 475 },
    { x: 499, y: 473 },
    { x: 501, y: 473 },
  ];
  const existing = [
    { x: 503, y: 476 },
    { x: 501, y: 478 },
    { x: 498, y: 477 },
    { x: 498, y: 474 },
    { x: 500, y: 472 },
    { x: 502, y: 473 },
  ].map((tile, i) => hq(tile, `guard-${i}`));
  existing.push({ ...hq({ x: 450, y: 450 }, "fixed-food"), kind: "food" });
  const terrainAt = terrainLookup(createPlan()).rules;
  const result = optimizeBoundaryFill({
    boundary,
    anchor: { x: 500, y: 475 },
    strategy: mudStrategy,
    terrainAt,
    groupId: "mud",
    placements: existing,
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.after.twoFit, 0);
  assert.equal(result.after.openCenters, 0);
  assert.equal(result.outsideTwoFitBefore, 6);
  assert.equal(result.outsideTwoFitAfter, 6);
  assert.deepEqual(result.movedIds, []);
  for (const original of existing)
    assert.deepEqual(
      result.placements.find((p) => p.id === original.id),
      original,
    );
  verifyResult(result, boundary, terrainAt);
});

test("unknown terrain and capped area scans cannot report a resolved boundary", () => {
  const boundary = [
    { x: 480, y: 480 },
    { x: 520, y: 480 },
    { x: 520, y: 520 },
    { x: 480, y: 520 },
  ];
  const base = {
    boundary,
    anchor: { x: 500, y: 500 },
    strategy: mudStrategy,
    groupId: "mud",
    placements: [],
  };
  const unknown = optimizeBoundaryFill({
    ...base,
    terrainAt: () => "unknown",
    allowUnknown: true,
  });
  assert.equal(unknown.status, "blocked");
  assert.ok(unknown.after.uncertain > 0);
  assert.equal(unknown.placements.length, 0);
  const capped = optimizeBoundaryFill({
    ...base,
    terrainAt: () => "mud",
    maxCandidates: 5,
    maxEvaluations: 0,
  });
  assert.notEqual(capped.status, "resolved");
  assert.equal(capped.truncated, true);
});

test("S1 mud-edge rearrangement retains a grass assignment and permits new HQs that straddle the edge", () => {
  const boundary = [
    { x: 460, y: 490 },
    { x: 480, y: 490 },
    { x: 480, y: 512 },
    { x: 460, y: 512 },
  ];
  const terrainAt = terrainLookup(createPlan()).rules;
  const grassPlayer = {
    ...hq({ x: 462, y: 500 }, "grass-player"),
    groupId: "grass",
  };
  const mudPlayer = hq({ x: 466, y: 502 }, "mixed-mud-player");
  const existing = [grassPlayer, mudPlayer];
  const snapshot = structuredClone(existing);
  assert.ok(cells(grassPlayer).every((tile) => terrainAt(tile) === "grass"));
  assert.ok(cells(mudPlayer).some((tile) => terrainAt(tile) === "grass"));
  assert.ok(cells(mudPlayer).some((tile) => terrainAt(tile) === "mud"));
  const result = optimizeBoundaryFill({
    boundary,
    anchor: { x: 468, y: 502 },
    strategy: mudStrategy,
    terrainAt,
    groupId: "mud",
    placements: existing,
  });
  const retainedGrass = result.placements.find((p) => p.id === grassPlayer.id)!;
  const retainedMud = result.placements.find((p) => p.id === mudPlayer.id)!;
  assert.ok(cells(retainedGrass).every((tile) => terrainAt(tile) === "grass"));
  assert.ok(cells(retainedMud).some((tile) => terrainAt(tile) === "mud"));
  for (const original of existing) {
    const retained = result.placements.find((p) => p.id === original.id)!;
    assert.equal(retained.name, original.name);
    assert.equal(retained.groupId, original.groupId);
    assert.ok(footprintInBoundary(retained, boundary));
  }
  const added = result.placements.filter((p) => result.addedIds.includes(p.id));
  assert.ok(added.length > 0);
  assert.ok(
    added.every((p) => cells(p).some((tile) => terrainAt(tile) === "mud")),
  );
  assert.ok(
    added.some((p) => cells(p).some((tile) => terrainAt(tile) === "grass")),
  );
  assert.ok(result.after.twoFit < result.before.twoFit);
  assert.deepEqual(existing, snapshot);
  verifyResult(result, boundary, terrainAt);
});
