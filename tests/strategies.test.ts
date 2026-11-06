import assert from "node:assert/strict";
import test from "node:test";
import {
  distance,
  footprint,
  footprintInBoundary,
  inWorld,
  key,
  normalizeBoundaryPoints,
  offset,
  tileInBoundary,
  toAxial,
  type Tile,
} from "../src/domain/geometry";
import { createPlan, PlanSchema, type Placement } from "../src/domain/schema";
import {
  BUILTIN_STRATEGIES,
  boundaryFillAnchor,
  createStrategyRegistry,
  parseStrategyConfig,
  regularStrategy,
  serializeStrategyConfig,
  smartFillBoundary,
  StrategySchema,
  validatedClosedBoundary,
  type SmartFillOptions,
  type Strategy,
} from "../src/domain/strategies";
import { nearestPlotSites } from "../src/domain/plot";
import { orientVector } from "../src/domain/orientation";
import { parsePlan } from "../src/domain/persistence";

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

for (const [label, points] of [
  ["repeated closing vertex", [...boundary, boundary[0]]],
  [
    "consecutive duplicate vertex",
    [boundary[0], boundary[1], boundary[1], boundary[2], boundary[3]],
  ],
] as const) {
  test(`legacy boundary with ${label} fills identically to the canonical polygon`, () => {
    const expected = smartFillBoundary(options());
    const actual = smartFillBoundary(options({ boundary: points }));
    assert.deepEqual(actual, expected);
    assert.deepEqual(boundaryFillAnchor(points), boundaryFillAnchor(boundary));
  });
}

test("boundary cleanup removes only zero-length edges and preserves open line closures", () => {
  const [a, b, c, d] = boundary;
  const clicked = [a, a, b, b, c, d, a, a].map((point) =>
    Object.freeze({ ...point }),
  );
  const snapshot = structuredClone(clicked);
  const normalized = normalizeBoundaryPoints(Object.freeze(clicked));
  assert.deepEqual(normalized, boundary);
  assert.deepEqual(normalizeBoundaryPoints(clicked, false), [...boundary, a]);
  assert.deepEqual(normalizeBoundaryPoints([]), []);
  assert.deepEqual(normalizeBoundaryPoints([a, a]), [a]);
  const internalRepeat = [a, b, a, c, d, a];
  assert.deepEqual(normalizeBoundaryPoints(internalRepeat), [a, b, a, c, d]);
  normalized[0].x++;
  assert.deepEqual(clicked, snapshot);
});

test("saved legacy boundaries load and fill without rewriting the stored polygon", () => {
  const saved = createPlan();
  const points = [...boundary.flatMap((point) => [point, point]), boundary[0]];
  saved.boundaries.push({
    id: "legacy-wedge",
    name: "Legacy wedge",
    points,
    closed: true,
  });
  const loaded = parsePlan(JSON.stringify(saved));
  assert.ok(loaded.ok);
  if (!loaded.ok) return;
  const stored = loaded.value.boundaries[0].points;
  assert.deepEqual(stored, points);
  assert.deepEqual(
    smartFillBoundary(options({ boundary: stored })),
    smartFillBoundary(options()),
  );
  assert.deepEqual(stored, points);
});

test("normalized legacy concave boundaries preserve anchors, terrain, spacing and full fill results", () => {
  const canonical = [
    { x: 486, y: 486 },
    { x: 514, y: 486 },
    { x: 514, y: 496 },
    { x: 496, y: 496 },
    { x: 496, y: 514 },
    { x: 486, y: 514 },
  ];
  const legacy = [
    ...canonical.flatMap((point) => [point, point]),
    canonical[0],
    canonical[0],
  ];
  const snapshot = structuredClone(legacy);
  const expectedAnchor = boundaryFillAnchor(canonical);
  assert.deepEqual(boundaryFillAnchor(legacy), expectedAnchor);
  assert.deepEqual(validatedClosedBoundary(legacy), canonical);
  for (const definition of BUILTIN_STRATEGIES)
    for (const mirrored of [false, true]) {
      const strategy = { ...definition, rotation: 2 };
      const fillOptions = {
        strategy,
        mirrored,
        terrainAt: definition.terrain === "mud" ? mud : grass,
      };
      const expected = smartFillBoundary(
        options({ ...fillOptions, boundary: canonical }),
      );
      const actual = smartFillBoundary(
        options({ ...fillOptions, boundary: legacy }),
      );
      assert.ok(actual.accepted > 0);
      assert.deepEqual(actual, expected);
      assert.ok(
        actual.placements.every((tile) => footprintInBoundary(tile, canonical)),
      );
      for (let i = 0; i < actual.placements.length; i++)
        for (let j = 0; j < i; j++)
          assert.ok(
            distance(actual.placements[i], actual.placements[j]) >=
              3 + strategy.minGap,
          );
    }
  assert.deepEqual(legacy, snapshot);
});

test("legacy cleanup retains raw coordinate and count limits and rejects real degeneracy or self-touch", () => {
  const [a, b, c, d] = boundary;
  const atLimit = [...boundary, ...Array.from({ length: 1996 }, () => d)];
  assert.equal(atLimit.length, 2000);
  assert.deepEqual(
    smartFillBoundary(options({ boundary: atLimit })),
    smartFillBoundary(options()),
  );
  assert.deepEqual(boundaryFillAnchor(atLimit), boundaryFillAnchor(boundary));
  const invalidCases = [
    [...atLimit, d],
    [a, a, a, a],
    [a, b, b, a],
    [a, b, a, c, d, a],
    [a, c, b, d, a],
    [a, b, c, a, d, { x: 480, y: 500 }, a],
    [...boundary, { x: -1, y: 500 }, { x: -1, y: 500 }, a],
    [...boundary, { x: Number.NaN, y: 500 }, a],
    [...boundary, { x: 500.5, y: 500 }, a],
  ];
  for (const points of invalidCases) {
    assert.throws(() => validatedClosedBoundary(points));
    assert.throws(() => boundaryFillAnchor(points));
    assert.throws(() => smartFillBoundary(options({ boundary: points })));
  }
});

test("boundary anchors stay inside concave and world-edge polygons without assuming usable terrain", () => {
  const concave = [
    { x: 486, y: 486 },
    { x: 514, y: 486 },
    { x: 514, y: 490 },
    { x: 490, y: 490 },
    { x: 490, y: 510 },
    { x: 514, y: 510 },
    { x: 514, y: 514 },
    { x: 486, y: 514 },
  ];
  for (const polygon of [
    boundary,
    concave,
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 0, y: 7 },
    ],
  ]) {
    const actual = boundaryFillAnchor(polygon);
    assert.ok(inWorld(actual));
    assert.ok(tileInBoundary(actual, polygon));
    assert.deepEqual(actual, boundaryFillAnchor([...polygon].reverse()));
  }
  assert.deepEqual(boundaryFillAnchor(boundary), anchor);
  assert.throws(() => boundaryFillAnchor([]));
  assert.throws(() => boundaryFillAnchor([anchor, anchor, anchor]));
});

test("bounded nearest lattice enumeration matches an independent world-tile oracle for skew, rotation and mirror", () => {
  const bounds = { minX: 490, maxX: 510, minY: 491, maxY: 511 },
    target = { x: 501, y: 500 };
  for (const raw of [
    [
      { q: 100, r: 99 },
      { q: 99, r: 98 },
    ],
    [
      { q: 100, r: 98 },
      { q: 99, r: 97 },
    ],
    custom.basis,
  ]) {
    for (let turns = 0; turns < 6; turns++)
      for (const mirrored of [false, true]) {
        const a = orientVector(raw[0], turns, mirrored),
          b = orientVector(raw[1], turns, mirrored);
        const lattice = { anchor, basis: [a, b] as [typeof a, typeof b] };
        const origin = toAxial(anchor),
          determinant = a.q * b.r - a.r * b.q;
        const expected: Tile[] = [];
        for (let y = bounds.minY; y <= bounds.maxY; y++)
          for (let x = bounds.minX; x <= bounds.maxX; x++) {
            const tile = { x, y },
              p = toAxial(tile),
              q = p.q - origin.q,
              r = p.r - origin.r;
            if (
              (q * b.r - r * b.q) % determinant === 0 &&
              (a.q * r - a.r * q) % determinant === 0
            )
              expected.push(tile);
          }
        const cost = (tile: Tile) => {
          const dx2 = 2 * (tile.x - target.x) + (tile.y & 1) - (target.y & 1),
            dy = tile.y - target.y;
          return dx2 * dx2 + 3 * dy * dy;
        };
        expected.sort((a, b) => cost(a) - cost(b) || a.y - b.y || a.x - b.x);
        const actual = nearestPlotSites(lattice, bounds, target, 31);
        assert.deepEqual(
          actual.sites.map(({ tile }) => tile),
          expected.slice(0, 31),
        );
        assert.equal(actual.candidateCount, expected.length);
        assert.equal(actual.truncated, expected.length > 31);
      }
  }
});

test("remote plot origins fill near the boundary and keep deterministic preview ordering under caps", () => {
  const remote = options({ anchor: { x: 0, y: 0 }, maxCandidates: 5 });
  const first = smartFillBoundary(remote);
  assert.equal(first.accepted, 5);
  assert.equal(first.considered, 5);
  assert.equal(first.truncated, true);
  assert.ok(
    first.placements.every((tile) => footprintInBoundary(tile, boundary)),
  );
  const equivalentPhase = smartFillBoundary(
    options({ anchor: { x: 4, y: 0 }, maxCandidates: 5 }),
  );
  assert.deepEqual(
    first.placements.map(key),
    equivalentPhase.placements.map(key),
  );
  assert.ok(first.placements.every((tile) => distance(tile, anchor) <= 8));
});

test("highly skewed fill inspects real nearby world sites instead of an enormous coefficient box", () => {
  const skewed = {
    ...custom,
    basis: [
      { q: 100, r: 99 },
      { q: 99, r: 98 },
    ] as Strategy["basis"],
    minGap: 0,
    rotation: 0,
  };
  const result = smartFillBoundary(
    options({ strategy: skewed, maxCandidates: 40 }),
  );
  assert.equal(result.considered, 40);
  assert.ok(result.accepted >= 4);
  assert.ok(result.candidateCount < 1000);
  for (let i = 0; i < result.placements.length; i++) {
    assert.ok(footprintInBoundary(result.placements[i], boundary));
    for (let j = 0; j < i; j++)
      assert.ok(distance(result.placements[i], result.placements[j]) >= 3);
  }
});

test("repeated fills assign unique position names in the chosen group and preserve existing records", () => {
  const existing = [
    { ...hq({ x: 700, y: 700 }, "old-1"), groupId: "grass", name: "Grass 01" },
    { ...hq({ x: 710, y: 700 }, "old-3"), groupId: "grass", name: "Grass 03" },
    { ...hq({ x: 720, y: 700 }, "other-2"), groupId: "mud", name: "Grass 02" },
  ];
  const snapshot = structuredClone(existing);
  const result = smartFillBoundary(
    options({ placements: existing, namePrefix: "Grass", maxPlacements: 3 }),
  );
  assert.deepEqual(
    result.placements.map(({ name }) => name),
    ["Grass 02", "Grass 04", "Grass 05"],
  );
  assert.deepEqual(existing, snapshot);
  let id = 0;
  const next = smartFillBoundary(
    options({
      placements: [...existing, ...result.placements],
      namePrefix: "Grass",
      maxPlacements: 2,
      makeId: () => `next-${++id}`,
    }),
  );
  assert.deepEqual(
    next.placements.map(({ name }) => name),
    ["Grass 06", "Grass 07"],
  );
  assert.ok(
    next.placements.every((p) =>
      result.placements.every((other) => distance(p, other) >= 4),
    ),
  );
});
