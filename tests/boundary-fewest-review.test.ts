import assert from "node:assert/strict";
import test from "node:test";
import { optimizeBoundaryFill } from "../src/domain/boundary-optimizer";
import { createStrategyRegistry } from "../src/domain/strategies";
import { createPlan, type Placement } from "../src/domain/schema";
import { terrainLookup } from "../src/data/terrain";
import type { Tile } from "../src/domain/geometry";
import type { TerrainLookup } from "../src/domain/placement";

const strategy = createStrategyRegistry().get("mud-tight")!;
const key = ({ x, y }: Tile) => `${x},${y}`;

// Deliberately independent of production distance, footprint and safety-index helpers.
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
const occupied = (tile: Tile) => new Set(cells(tile).map(key));
const overlaps = (a: Set<string>, b: Set<string>) =>
  [...a].some((tile) => b.has(tile));

function pocket(width: number, height: number) {
  const terrainAt: TerrainLookup = (tile) =>
    tile.x >= 500 &&
    tile.x < 500 + width &&
    tile.y >= 500 &&
    tile.y < 500 + height
      ? "mud"
      : "restricted";
  const boundary = [
    { x: 498, y: 498 },
    { x: 501 + width, y: 498 },
    { x: 501 + width, y: 501 + height },
    { x: 498, y: 501 + height },
  ];
  const sites: Tile[] = [];
  for (let y = 500; y < 500 + height; y++)
    for (let x = 500; x < 500 + width; x++) {
      const tile = { x, y };
      if (cells(tile).every((cell) => terrainAt(cell) === "mud"))
        sites.push(tile);
    }
  return { terrainAt, boundary, sites };
}

function certified(sites: readonly Tile[], selected: readonly Tile[]): boolean {
  const friendly = selected.map(occupied),
    enemies = sites.map(occupied);
  for (let i = 0; i < friendly.length; i++)
    for (let j = 0; j < i; j++)
      if (overlaps(friendly[i], friendly[j])) return false;
  if (enemies.some((enemy) => !friendly.some((hq) => overlaps(enemy, hq))))
    return false;
  for (let removed = 0; removed < friendly.length; removed++) {
    const newlyOpened = enemies.filter(
      (enemy) =>
        overlaps(enemy, friendly[removed]) &&
        friendly.every(
          (hq, index) => index === removed || !overlaps(enemy, hq),
        ),
    );
    for (let i = 0; i < newlyOpened.length; i++)
      for (let j = i + 1; j < newlyOpened.length; j++)
        if (!overlaps(newlyOpened[i], newlyOpened[j])) return false;
  }
  return true;
}

/** Exhaustive independent proof for these tiny pockets, not an assertion of the
 * production heuristic's global optimality on arbitrary boundaries. */
function trueMinimum(sites: readonly Tile[]): number {
  const feet = sites.map(occupied);
  for (let count = 0; count <= sites.length; count++) {
    let found = false;
    function visit(chosen: number[], start: number) {
      if (found) return;
      if (chosen.length === count) {
        found = certified(
          sites,
          chosen.map((index) => sites[index]),
        );
        return;
      }
      for (let index = start; index < sites.length; index++)
        if (chosen.every((prior) => !overlaps(feet[index], feet[prior])))
          visit([...chosen, index], index + 1);
    }
    visit([], 0);
    if (found) return count;
  }
  throw new Error("No feasible packing in the exhaustive pocket search.");
}

function assignment(tile: Tile, id: string): Placement {
  return {
    ...tile,
    id,
    name: `Assigned ${id}`,
    groupId: "mud",
    kind: "hq",
    showGraphic: true,
  };
}

for (const [width, height, expectedMinimum] of [
  [9, 4, 2],
  [6, 6, 3],
  [7, 8, 4],
]) {
  test(`fewest mode matches an exhaustive ${width}×${height} pocket optimum with zero openings after every loss`, () => {
    const fixture = pocket(width, height);
    const minimum = trueMinimum(fixture.sites);
    assert.equal(minimum, expectedMinimum);
    const result = optimizeBoundaryFill({
      ...fixture,
      anchor: { x: 502, y: 502 },
      strategy,
      groupId: "mud",
      placements: [],
      objective: "fewest",
    });
    assert.equal(result.objective, "fewest");
    assert.equal(result.status, "resolved");
    assert.equal(result.coverageComplete, true);
    assert.equal(result.placements.length, minimum);
    assert.ok(certified(fixture.sites, result.placements));
    assert.equal(result.after.twoFit, 0);
    assert.equal(result.after.openCenters, 0);
    assert.deepEqual(result.removedIds, []);
  });
}

test("fewest preserves named HQs by default and removes only authorized inside assignments", () => {
  const fixture = pocket(9, 4);
  const existing = [
    assignment({ x: 503, y: 501 }, "A"),
    assignment({ x: 501, y: 502 }, "B"),
    assignment({ x: 506, y: 502 }, "C"),
  ];
  const snapshot = structuredClone(existing);
  assert.ok(certified(fixture.sites, existing));
  const options = {
    ...fixture,
    anchor: { x: 502, y: 502 },
    strategy,
    groupId: "mud",
    placements: existing,
    objective: "fewest" as const,
  };
  const kept = optimizeBoundaryFill(options);
  assert.equal(kept.status, "resolved");
  assert.equal(kept.placements.length, 3);
  assert.deepEqual(kept.removedIds, []);
  for (const original of existing)
    assert.ok(kept.placements.some((p) => p.id === original.id));
  const reduced = optimizeBoundaryFill({ ...options, preserveExisting: false });
  assert.equal(reduced.status, "resolved");
  assert.equal(reduced.placements.length, trueMinimum(fixture.sites));
  assert.equal(reduced.removedIds.length, 1);
  assert.ok(certified(fixture.sites, reduced.placements));
  for (const original of existing) {
    const retained = reduced.placements.find((p) => p.id === original.id);
    if (!retained) {
      assert.ok(reduced.removedIds.includes(original.id));
      continue;
    }
    assert.equal(retained.name, original.name);
    assert.equal(retained.groupId, original.groupId);
    assert.equal(retained.kind, original.kind);
    assert.equal(retained.showGraphic, original.showGraphic);
  }
  assert.deepEqual(existing, snapshot);
});

test("fewest cannot remove outside S1 guards or a blocker even when inside removals are allowed", () => {
  const boundary = [
    { x: 502, y: 475 },
    { x: 501, y: 477 },
    { x: 499, y: 477 },
    { x: 498, y: 475 },
    { x: 499, y: 473 },
    { x: 501, y: 473 },
  ];
  const fixed = [
    { x: 503, y: 476 },
    { x: 501, y: 478 },
    { x: 498, y: 477 },
    { x: 498, y: 474 },
    { x: 500, y: 472 },
    { x: 502, y: 473 },
  ].map((tile, index) => assignment(tile, `guard-${index}`));
  fixed.push({ ...assignment({ x: 450, y: 450 }, "blocker"), kind: "food" });
  const result = optimizeBoundaryFill({
    boundary,
    anchor: { x: 500, y: 475 },
    strategy,
    groupId: "mud",
    terrainAt: terrainLookup(createPlan()).rules,
    placements: fixed,
    objective: "fewest",
    preserveExisting: false,
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.scopedIds.length, 1);
  assert.equal(result.after.twoFit, 0);
  assert.equal(result.after.openCenters, 0);
  assert.equal(result.outsideTwoFitBefore, 6);
  assert.equal(result.outsideTwoFitAfter, 6);
  assert.deepEqual(result.removedIds, []);
  for (const original of fixed)
    assert.deepEqual(
      result.placements.find((p) => p.id === original.id),
      original,
    );
});

test("fewest never certifies unknown terrain or a partial coverage scan", () => {
  const fixture = pocket(9, 4);
  const options = {
    ...fixture,
    anchor: { x: 502, y: 502 },
    strategy,
    groupId: "mud",
    placements: [],
    objective: "fewest" as const,
  };
  const unknown = optimizeBoundaryFill({
    ...options,
    terrainAt: () => "unknown",
    allowUnknown: true,
  });
  assert.notEqual(unknown.status, "resolved");
  assert.equal(unknown.placements.length, 0);
  const capped = optimizeBoundaryFill({ ...options, maxCandidates: 5 });
  assert.notEqual(capped.status, "resolved");
  assert.equal(capped.coverageComplete, false);
  assert.equal(capped.truncated, true);
});

test("fewest accepts zero inside HQs when an unchanged outside HQ already covers the area", () => {
  const boundary = [
    { x: 502, y: 475 },
    { x: 501, y: 477 },
    { x: 499, y: 477 },
    { x: 498, y: 475 },
    { x: 499, y: 473 },
    { x: 501, y: 473 },
  ];
  const guard = assignment({ x: 502, y: 475 }, "outside-guard");
  const result = optimizeBoundaryFill({
    boundary,
    anchor: { x: 500, y: 475 },
    strategy,
    groupId: "mud",
    terrainAt: terrainLookup(createPlan()).rules,
    placements: [guard],
    objective: "fewest",
    preserveExisting: false,
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.coverageComplete, true);
  assert.equal(result.scopedIds.length, 0);
  assert.equal(result.after.twoFit, 0);
  assert.equal(result.after.openCenters, 0);
  assert.deepEqual(result.placements, [guard]);
  assert.deepEqual(result.addedIds, []);
  assert.deepEqual(result.removedIds, []);
  assert.deepEqual(result.movedIds, []);
});

test("a small drawn boundary cannot hide two enemy replacement footprints outside its line", () => {
  const boundary = [
    { x: 502, y: 475 },
    { x: 501, y: 477 },
    { x: 499, y: 477 },
    { x: 498, y: 475 },
    { x: 499, y: 473 },
    { x: 501, y: 473 },
  ];
  const center = { x: 500, y: 475 };
  const enemyA = occupied({ x: 498, y: 475 });
  const enemyB = occupied({ x: 502, y: 475 });
  assert.ok(overlaps(enemyA, occupied(center)));
  assert.ok(overlaps(enemyB, occupied(center)));
  assert.equal(overlaps(enemyA, enemyB), false);
  const result = optimizeBoundaryFill({
    boundary,
    anchor: center,
    strategy,
    groupId: "mud",
    terrainAt: () => "mud",
    placements: [],
    objective: "fewest",
  });
  assert.equal(result.coverageComplete, true);
  assert.equal(result.status, "blocked");
  assert.ok(result.after.twoFit > 0);
});
