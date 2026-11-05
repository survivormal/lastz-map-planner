import assert from "node:assert/strict";
import test from "node:test";
import {
  distance,
  footprint,
  footprintInBoundary,
  key,
  offset,
  type Tile,
} from "../src/domain/geometry";
import { createPlan, PlanSchema, type Placement } from "../src/domain/schema";
import {
  BUILTIN_STRATEGIES,
  createStrategyRegistry,
  parseStrategyConfig,
  regularStrategy,
  serializeStrategyConfig,
  smartFillBoundary,
  StrategySchema,
  type SmartFillOptions,
  type Strategy,
} from "../src/domain/strategies";

const anchor = { x: 500, y: 500 };
const boundary = [
  { x: 486, y: 486 },
  { x: 514, y: 486 },
  { x: 514, y: 514 },
  { x: 486, y: 514 },
];
const grass = () => "grass" as const;
const mud = () => "mud" as const;
const hq = (tile: Tile, id: string): Placement => ({
  ...tile,
  id,
  kind: "hq",
  name: id,
  groupId: "mud",
  showGraphic: false,
});
function options(patch: Partial<SmartFillOptions> = {}): SmartFillOptions {
  let id = 0;
  return {
    anchor,
    boundary,
    strategy: regularStrategy("tight"),
    placements: [],
    terrainAt: grass,
    groupId: "grass",
    makeId: () => `new-${++id}`,
    ...patch,
  };
}
const custom: Strategy = {
  schemaVersion: 1,
  id: "wide-custom",
  name: "Wide custom",
  description: "Three empty tiles for a custom defensive layout.",
  basis: [
    { q: 6, r: 0 },
    { q: 0, r: 6 },
  ],
  minGap: 3,
  terrain: "grass",
  rotation: 2,
  source: "https://example.com/strategy",
  provenance: "User-supplied configuration.",
};

test("strategy schema rejects singular, unsupported, unsafe, and misspelled configurations", () => {
  assert.ok(StrategySchema.safeParse(custom).success);
  for (const patch of [
    { schemaVersion: 2 },
    { minGap: -1 },
    { minGap: 11 },
    { rotation: 6 },
    { rotation: 0.5 },
    {
      basis: [
        { q: 1, r: 2 },
        { q: 2, r: 4 },
      ],
    },
    {
      basis: [
        { q: 0, r: 0 },
        { q: 1, r: 1 },
      ],
    },
    {
      basis: [
        { q: 1.5, r: 2 },
        { q: 0, r: 4 },
      ],
    },
    { terrain: "water" },
    { id: "bad id" },
    { minGapp: 1 },
  ])
    assert.equal(
      StrategySchema.safeParse({ ...custom, ...patch }).success,
      false,
    );
});

test("custom registry import/export preserves definitions and rejects collisions", () => {
  const text = serializeStrategyConfig([custom]);
  assert.deepEqual(parseStrategyConfig(text), [custom]);
  assert.equal(createStrategyRegistry([custom]).get(custom.id)?.minGap, 3);
  assert.equal(createStrategyRegistry().strategies.length, 5);
  assert.throws(() => createStrategyRegistry([custom, custom]));
  assert.throws(() => createStrategyRegistry([{ ...custom, id: "mud-tight" }]));
  assert.throws(() =>
    parseStrategyConfig(JSON.stringify({ schemaVersion: 2, strategies: [] })),
  );
  assert.throws(() => parseStrategyConfig("x".repeat(256001)));
  assert.throws(() => parseStrategyConfig("not json"));
});

test("plan persistence validates versioned strategies and unique IDs", () => {
  const plan = createPlan();
  assert.deepEqual(
    PlanSchema.parse({ ...plan, strategies: [custom] }).strategies,
    [custom],
  );
  assert.equal(
    PlanSchema.safeParse({ ...plan, strategies: [custom, custom] }).success,
    false,
  );
});

test("smart fill produces only full legal footprints with requested clearance at every rotation", () => {
  for (const strategy of BUILTIN_STRATEGIES)
    for (let rotation = 0; rotation < 6; rotation++) {
      const result = smartFillBoundary(
        options({
          strategy: { ...strategy, rotation },
          terrainAt: strategy.terrain === "mud" ? mud : grass,
        }),
      );
      assert.ok(result.accepted > 0);
      assert.equal(result.truncated, false);
      assert.equal(
        result.considered,
        result.accepted +
          Object.values(result.rejected).reduce((a, b) => a + b, 0),
      );
      assert.ok(
        result.placements.every((placement) =>
          footprintInBoundary(placement, boundary),
        ),
      );
      for (let i = 0; i < result.placements.length; i++)
        for (let j = i + 1; j < result.placements.length; j++) {
          assert.ok(
            distance(result.placements[i], result.placements[j]) >=
              3 + strategy.minGap,
          );
        }
    }
});

test("smart fill enforces custom gaps above preset spacing and lattice anchoring", () => {
  const result = smartFillBoundary(options({ strategy: custom }));
  assert.ok(result.accepted > 1);
  assert.ok(
    result.placements.some((placement) => key(placement) === key(anchor)),
  );
  for (const first of result.placements)
    for (const second of result.placements) {
      if (first.id !== second.id) assert.ok(distance(first, second) >= 6);
    }
  const dense = smartFillBoundary(
    options({
      strategy: {
        ...custom,
        basis: [
          { q: 1, r: 0 },
          { q: 0, r: 1 },
        ],
        rotation: 0,
      },
    }),
  );
  assert.ok(dense.rejected.spacing > 0);
  for (const first of dense.placements)
    for (const second of dense.placements) {
      if (first.id !== second.id) assert.ok(distance(first, second) >= 6);
    }
});

test("smart fill respects occupied cells, footprint-edge terrain and terrain-specific strategies", () => {
  const occupied = hq(anchor, "existing");
  const blocked = key(offset(anchor, { q: 5, r: 0 }));
  const result = smartFillBoundary(
    options({
      placements: [occupied],
      terrainAt: (tile) => (key(tile) === blocked ? "restricted" : "grass"),
    }),
  );
  assert.ok(result.rejected.collision > 0);
  assert.ok(result.rejected.terrain > 0);
  assert.ok(
    result.placements.every(
      (tile) =>
        distance(tile, occupied) >= 4 &&
        footprint(tile).every((cell) => key(cell) !== blocked),
    ),
  );
  const mudStrategy = createStrategyRegistry().get("mud-tight")!;
  assert.equal(
    smartFillBoundary(options({ strategy: mudStrategy, terrainAt: grass }))
      .accepted,
    0,
  );
  assert.equal(
    smartFillBoundary(
      options({ strategy: mudStrategy, terrainAt: mud, kind: "food" }),
    ).accepted,
    0,
  );
  assert.equal(
    smartFillBoundary(
      options({ strategy: mudStrategy, terrainAt: mud, kind: "wood" }),
    ).accepted,
    0,
  );
});

test("unknown terrain fails closed and explicit sandbox fills remain marked provisional", () => {
  const blocked = smartFillBoundary(options({ terrainAt: () => "unknown" }));
  assert.equal(blocked.accepted, 0);
  const sandbox = smartFillBoundary(
    options({ terrainAt: () => "unknown", allowUnknown: true }),
  );
  assert.ok(sandbox.accepted > 0);
  assert.equal(sandbox.provisional, sandbox.accepted);
  assert.equal(
    smartFillBoundary(
      options({ terrainAt: () => "restricted", allowUnknown: true }),
    ).accepted,
    0,
  );
});

test("candidate and placement bounds stop work explicitly without losing count consistency", () => {
  const limited = smartFillBoundary(options({ maxCandidates: 5 }));
  assert.equal(limited.considered, 5);
  assert.equal(limited.truncated, true);
  assert.equal(
    limited.considered,
    limited.accepted +
      Object.values(limited.rejected).reduce((a, b) => a + b, 0),
  );
  const small = smartFillBoundary(options({ maxPlacements: 3 }));
  assert.equal(small.accepted, 3);
  assert.equal(small.truncated, true);
  assert.throws(() => smartFillBoundary(options({ maxCandidates: Infinity })));
  assert.throws(() => smartFillBoundary(options({ maxPlacements: -1 })));
});

test("uncapped lattice traversal covers exactly the independently enumerated legal sites", () => {
  for (const origin of [anchor, { x: 500, y: 501 }]) {
    const strategy = regularStrategy("tight");
    const result = smartFillBoundary(options({ anchor: origin, strategy }));
    const expected: string[] = [];
    for (let i = -10; i <= 10; i++)
      for (let j = -10; j <= 10; j++) {
        const tile = offset(origin, { q: i * 4, r: j * 4 });
        if (footprintInBoundary(tile, boundary)) expected.push(key(tile));
      }
    assert.equal(result.truncated, false);
    assert.deepEqual(result.placements.map(key).sort(), expected.sort());
  }
});

test("boundary and ID validation reject corrupt proposals", () => {
  assert.throws(() => smartFillBoundary(options({ boundary: [] })));
  assert.throws(() =>
    smartFillBoundary(options({ boundary: [anchor, anchor, anchor] })),
  );
  assert.throws(() =>
    smartFillBoundary(
      options({
        boundary: [boundary[0], boundary[2], boundary[1], boundary[3]],
      }),
    ),
  );
  assert.throws(() => smartFillBoundary(options({ makeId: () => "same" })));
  assert.throws(() => smartFillBoundary(options({ anchor: { x: -1, y: 0 } })));
});
