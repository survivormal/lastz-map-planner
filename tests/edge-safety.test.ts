import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TIGHTENING_AUDITS,
  MAX_TIGHTENING_CANDIDATES,
  analyzeReplacement,
  auditPlacementSafety,
  distance,
  findTighteningSuggestions,
  footprint,
  key,
  offset,
  validatePlacement,
  type Placement,
  type Terrain,
  type TighteningSuggestion,
  type Tile,
} from "../src/domain";
import { staticTerrainAt } from "../src/data/static-terrain";

const grass = () => "grass" as const,
  mud = () => "mud" as const;
function hqs(points: readonly (readonly [number, number])[]): Placement[] {
  return points.map(([x, y], i) => ({
    x,
    y,
    id: `hq${i}`,
    kind: "hq",
    name: `Player ${i}`,
    groupId: "mud",
    showGraphic: i === 0,
  }));
}
const shoreline = () =>
  hqs([
    [468, 502],
    [471, 503],
    [469, 506],
    [467, 498],
    [470, 499],
  ]);
const coreEdge = () =>
  hqs([
    [481, 496],
    [478, 499],
    [476, 502],
    [479, 503],
    [483, 504],
    [477, 506],
    [480, 507],
  ]);
function apply(
  placements: Placement[],
  suggestion: TighteningSuggestion,
): Placement[] {
  if (suggestion.kind === "move")
    return placements.map((placement) =>
      placement.id === suggestion.placementId
        ? { ...placement, ...suggestion.to }
        : placement,
    );
  return [
    ...placements,
    {
      ...suggestion.to,
      id: "test-infill",
      kind: "hq",
      name: "Infill",
      groupId: "mud",
      showGraphic: false,
    },
  ];
}
function strictRisks(
  placements: Placement[],
  terrainAt: (tile: Tile) => Terrain,
) {
  return new Map(
    placements
      .filter((p) => p.kind === "hq")
      .map((p) => [p.id, analyzeReplacement(p, placements, { terrainAt })]),
  );
}
function verifySuggestions(
  placements: Placement[],
  suggestions: TighteningSuggestion[],
  terrainAt: (tile: Tile) => Terrain,
) {
  const before = strictRisks(placements, terrainAt);
  for (const suggestion of suggestions) {
    const next = apply(placements, suggestion),
      after = strictRisks(next, terrainAt);
    assert.equal(
      [...before.values()].filter((a) => a.risk === "two-fit").length,
      suggestion.beforeCount,
    );
    assert.equal(
      [...after.values()].filter((a) => a.risk === "two-fit").length,
      suggestion.afterCount,
    );
    assert.ok(suggestion.afterCount < suggestion.beforeCount);
    for (const [id, analysis] of after)
      if (before.get(id)?.risk !== "two-fit")
        assert.notEqual(analysis.risk, "two-fit", `New risk at ${id}`);
    const changed = next.find(
      (p) => p.id === (suggestion.placementId ?? "test-infill"),
    )!;
    assert.equal(
      validatePlacement(changed, next, { terrainAt, ignoreId: changed.id })
        .valid,
      true,
    );
    if (suggestion.from)
      assert.ok(
        distance(suggestion.from, suggestion.to) >= 1 &&
          distance(suggestion.from, suggestion.to) <= 2,
      );
  }
}

test("indexed audit matches the existing exact one-loss analyzer including blockers and unknown terrain", () => {
  const placements = hqs([
    [500, 500],
    [504, 500],
    [500, 504],
    [496, 504],
    [496, 500],
    [500, 496],
    [504, 496],
  ]);
  placements[2].kind = "wood";
  for (const allowUnknown of [false, true]) {
    const terrainAt = (tile: Tile): Terrain =>
      tile.x === 502 && tile.y === 499
        ? "unknown"
        : tile.x === 505 && tile.y === 503
          ? "restricted"
          : "grass";
    const audit = auditPlacementSafety(placements, { terrainAt, allowUnknown });
    assert.equal(audit.entries.length, 6);
    for (const entry of audit.entries) {
      const reference = analyzeReplacement(
        placements.find((p) => p.id === entry.placementId)!,
        placements,
        { terrainAt, allowUnknown },
      );
      assert.equal(entry.analysis.risk, reference.risk);
      for (const field of [
        "newlyEnabled",
        "existingOpen",
        "unknownTiles",
      ] as const)
        assert.deepEqual(
          entry.analysis[field].map(key).sort(),
          reference[field].map(key).sort(),
        );
      assert.deepEqual(entry.analysis.witnessPair, reference.witnessPair);
    }
  }
});

test("actual S1 mud shoreline warns automatically and keeps grass legal for replacement HQs", () => {
  const placements = shoreline(),
    before = JSON.stringify(placements);
  assert.ok(
    placements.every((p) =>
      footprint(p).every((tile) => staticTerrainAt(tile) === "mud"),
    ),
  );
  const audit = auditPlacementSafety(placements, {
    terrainAt: staticTerrainAt,
  });
  assert.equal(audit.summary.twoFitCount, 5);
  assert.equal(audit.summary.invalidCount, 0);
  const selected = audit.entries.find((entry) => entry.placementId === "hq0")!;
  assert.deepEqual(selected.analysis.witnessPair, [
    { x: 466, y: 502 },
    { x: 468, y: 503 },
  ]);
  assert.ok(
    selected.analysis.witnessPair!.some((center) =>
      footprint(center).some((tile) => staticTerrainAt(tile) === "grass"),
    ),
  );
  const result = findTighteningSuggestions("hq0", placements, {
    terrainAt: staticTerrainAt,
  });
  const move = result.suggestions.find(
    (s) => s.placementId === "hq0" && key(s.to) === "469,502",
  )!;
  assert.ok(move);
  assert.equal(move.beforeCount, 5);
  assert.equal(move.afterCount, 4);
  assert.equal(move.selectedAfter.risk, "one-fit");
  assert.ok(
    footprint(move.to).every((tile) => staticTerrainAt(tile) === "mud"),
  );
  verifySuggestions(placements, result.suggestions, staticTerrainAt);
  assert.equal(JSON.stringify(placements), before);
  assert.deepEqual(
    findTighteningSuggestions("hq0", placements, {
      terrainAt: staticTerrainAt,
    }),
    result,
  );
});

test("restricted-core support gaps can be tightened with an infill that is not itself two-fit", () => {
  const placements = coreEdge();
  const result = findTighteningSuggestions("hq3", placements, {
    terrainAt: staticTerrainAt,
  });
  assert.ok(result.suggestions.length <= 3);
  const infill = result.suggestions.find(
    (s) => s.kind === "infill" && key(s.to) === "481,500",
  )!;
  assert.ok(
    infill,
    "An equally effective infill should remain available beside moves.",
  );
  assert.equal(infill.beforeCount, 7);
  assert.equal(infill.afterCount, 6);
  assert.equal(infill.selectedAfter.risk, "one-fit");
  assert.equal(infill.addedAnalysis?.risk, "one-fit");
  assert.ok(
    footprint(infill.to).every((tile) => staticTerrainAt(tile) === "mud"),
  );
  verifySuggestions(placements, result.suggestions, staticTerrainAt);
});

test("a globally lower warning count cannot justify creating a new two-fit HQ", () => {
  const coordinates: Array<[string, number, number]> = [
    ["p0", 101, 100],
    ["p2", 99, 96],
    ["p16", 97, 98],
    ["p18", 96, 101],
    ["p23", 104, 97],
    ["p91", 101, 97],
    ["p107", 96, 104],
  ];
  const placements = hqs(coordinates.map(([, x, y]) => [x, y]));
  placements.forEach((p, i) => (p.id = coordinates[i][0]));
  const trap = placements.map((p) =>
    p.id === "p0" ? { ...p, x: 99, y: 100 } : p,
  );
  assert.equal(
    validatePlacement(trap[0], trap, { terrainAt: mud, ignoreId: "p0" }).valid,
    true,
  );
  const before = strictRisks(placements, mud),
    after = strictRisks(trap, mud);
  assert.equal(
    [...before.values()].filter((a) => a.risk === "two-fit").length,
    6,
  );
  assert.equal(
    [...after.values()].filter((a) => a.risk === "two-fit").length,
    5,
  );
  assert.equal(before.get("p91")!.risk, "one-fit");
  assert.equal(after.get("p91")!.risk, "two-fit");
  for (const selected of ["p16", "p18"]) {
    const result = findTighteningSuggestions(selected, placements, {
      terrainAt: mud,
    });
    assert.ok(
      !result.suggestions.some(
        (s) => s.placementId === "p0" && key(s.to) === "99,100",
      ),
    );
    verifySuggestions(placements, result.suggestions, mud);
  }
});

test("overlapping replacement candidates and pre-existing openings do not create false two-fit warnings", () => {
  const target = hqs([[500, 500]])[0],
    adjacent = offset(target, { q: 1, r: 0 }),
    oldHole = offset(target, { q: 4, r: 0 });
  const legal = new Set(
    [...footprint(target), ...footprint(adjacent), ...footprint(oldHole)].map(
      key,
    ),
  );
  const audit = auditPlacementSafety([target], {
    terrainAt: (tile) => (legal.has(key(tile)) ? "grass" : "restricted"),
  });
  const analysis = audit.entries[0].analysis;
  assert.equal(analysis.risk, "one-fit");
  assert.equal(analysis.witnessPair, undefined);
  assert.equal(analysis.newlyEnabled.length, 2);
  assert.ok(analysis.existingOpen.some((tile) => key(tile) === key(oldHole)));
});

test("unknown terrain remains explicit and cannot authorize a repair even in sandbox mode", () => {
  const placements = hqs([[500, 500]]);
  const strict = auditPlacementSafety(placements, {
    terrainAt: () => "unknown",
  });
  assert.equal(strict.entries[0].confidence, "incomplete");
  assert.equal(strict.summary.incompleteCount, 1);
  assert.ok(strict.entries[0].analysis.unknownTiles.length);
  const provisional = auditPlacementSafety(placements, {
    terrainAt: () => "unknown",
    allowUnknown: true,
  });
  assert.equal(provisional.entries[0].confidence, "provisional");
  assert.equal(provisional.entries[0].analysis.risk, "two-fit");
  const search = findTighteningSuggestions("hq0", placements, {
    terrainAt: () => "unknown",
    allowUnknown: true,
  });
  assert.equal(search.suggestions.length, 0);
  assert.match(search.reason!, /Terrain is incomplete/);
});

test("illegal retained blockers cannot be treated as reliable protection for a tightening suggestion", () => {
  const placements = shoreline();
  placements[1].kind = "food";
  const audit = auditPlacementSafety(placements, {
    terrainAt: staticTerrainAt,
  });
  assert.equal(audit.summary.invalidCount, 1);
  // This apparent repair relies on the impossible food building. Without it the target is unsafe.
  const moved = placements.map((p) =>
    p.id === "hq0" ? { ...p, x: 469, y: 502 } : p,
  );
  assert.equal(
    analyzeReplacement(moved[0], moved, { terrainAt: staticTerrainAt }).risk,
    "one-fit",
  );
  assert.equal(
    analyzeReplacement(
      moved[0],
      moved.filter((p) => p.id !== "hq1"),
      { terrainAt: staticTerrainAt },
    ).risk,
    "two-fit",
  );
  const search = findTighteningSuggestions("hq0", placements, {
    terrainAt: staticTerrainAt,
  });
  assert.equal(search.suggestions.length, 0);
  assert.match(search.reason!, /invalid existing footprints or blockers/);
  const overlap = hqs([
    [500, 500],
    [500, 500],
  ]);
  assert.equal(
    auditPlacementSafety(overlap, { terrainAt: grass }).summary.invalidCount,
    2,
  );
  assert.equal(
    findTighteningSuggestions("hq0", overlap, { terrainAt: grass }).suggestions
      .length,
    0,
  );
  assert.equal(
    auditPlacementSafety(hqs([[0, 0]]), { terrainAt: grass }).summary
      .invalidCount,
    1,
  );
});

test("search work caps are explicit and a full 5,000-HQ audit evaluates every HQ with cached terrain", () => {
  const placements: Placement[] = [];
  for (let j = 0; j < 50; j++)
    for (let i = 0; i < 100; i++)
      placements.push({
        ...offset({ x: 300, y: 100 }, { q: 3 * i - j, r: i + 4 * j }),
        id: `p${i}-${j}`,
        name: "HQ",
        kind: "hq",
        groupId: "mud",
        showGraphic: false,
      });
  let terrainReads = 0;
  const audit = auditPlacementSafety(placements, {
    terrainAt: () => {
      terrainReads++;
      return "mud";
    },
  });
  assert.equal(audit.summary.hqCount, 5000);
  assert.equal(audit.entries.length, 5000);
  assert.equal(audit.summary.twoFitCount, 296);
  assert.ok(terrainReads <= 5000 * 91);
  const limited = findTighteningSuggestions("hq0", shoreline(), {
    terrainAt: staticTerrainAt,
    maxCandidates: 1,
  });
  assert.equal(limited.evaluated, 1);
  assert.equal(limited.truncated, true);
  const noAudits = findTighteningSuggestions("hq0", shoreline(), {
    terrainAt: staticTerrainAt,
    maxAuditEvaluations: 0,
  });
  assert.equal(noAudits.analyzedHqs, 0);
  assert.equal(noAudits.truncated, true);
  const normal = findTighteningSuggestions("hq0", shoreline(), {
    terrainAt: staticTerrainAt,
    maxCandidates: 1_000_000,
    maxAuditEvaluations: 1_000_000,
  });
  assert.ok(normal.evaluated <= MAX_TIGHTENING_CANDIDATES);
  assert.ok(normal.analyzedHqs <= MAX_TIGHTENING_AUDITS);
  assert.throws(() =>
    auditPlacementSafety([...placements, { ...placements[0], id: "extra" }], {
      terrainAt: mud,
    }),
  );
});
