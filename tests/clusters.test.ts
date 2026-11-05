import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanSchema,
  StrategySchema,
  createPlan,
  distance,
  footprint,
  generateFormation,
  inWorld,
  key,
  neighbors,
  offset,
  orientVector,
  smartFillBoundary,
  toAxial,
  transformCluster,
  type ClusterTransformResult,
  type Plan,
  type Tile,
} from "../src/domain";

const mud = () => "mud" as const;
const grass = () => "grass" as const;
const anchor = { x: 500, y: 500 };

function samplePlan(origin = anchor, rotation = 0, mirrored = false): Plan {
  const plan = createPlan();
  plan.clusters.push({
    id: "cluster",
    name: "Named daisy",
    kind: "daisy",
    anchor: origin,
    rotation,
    mirrored,
    minGap: 1,
    terrain: "mud",
  });
  plan.placements = generateFormation("daisy", origin, "tight", {
    strategy: "mud-tight",
    rotation,
    mirrored,
  }).map((tile, index) => ({
    ...tile,
    id: `member-${index}`,
    kind: "hq",
    name: `Player ${index}`,
    groupId: "mud",
    showGraphic: index === 2,
    clusterId: "cluster",
  }));
  return plan;
}

function applied(plan: Plan, result: ClusterTransformResult): Plan {
  assert.equal(result.valid, true, result.issues.join(" "));
  if (!result.valid) throw new Error("Expected valid transform.");
  return PlanSchema.parse({
    ...plan,
    placements: result.placements,
    clusters: plan.clusters.map((cluster) =>
      cluster.id === result.cluster.id ? result.cluster : cluster,
    ),
  });
}

function oneMemberPlan(): Plan {
  const plan = samplePlan();
  plan.placements = plan.placements.filter(
    (placement) => placement.id === "member-1",
  );
  return plan;
}

test("orientation is a hex-grid isometry with six-turn closure and mirror involution", () => {
  assert.deepEqual(orientVector({ q: 3, r: 1 }, 1), { q: -1, r: 4 });
  assert.deepEqual(orientVector({ q: 3, r: 1 }, 0, true), { q: 4, r: -1 });
  for (let q = -4; q <= 4; q++)
    for (let r = -4; r <= 4; r++) {
      const vector = { q, r };
      assert.deepEqual(orientVector(vector, 6), vector);
      assert.deepEqual(
        orientVector(orientVector(vector, 0, true), 0, true),
        vector,
      );
      for (let rotation = 0; rotation < 6; rotation++)
        for (const mirrored of [false, true]) {
          const oriented = orientVector(vector, rotation, mirrored);
          assert.equal(
            distance(anchor, offset(anchor, oriented)),
            distance(anchor, offset(anchor, vector)),
          );
        }
    }
  assert.throws(() => orientVector({ q: 1, r: 0 }, 0.5));
});

test("all preset previews apply the same mirror-then-rotation to ordered members", () => {
  for (const origin of [anchor, { x: 500, y: 501 }]) {
    for (const kind of ["daisy", "grass", "mud"] as const)
      for (const strategy of ["regular", "mud-tight", "grass-wide"] as const) {
        const baseline = generateFormation(kind, origin, "tight", { strategy });
        const originAxial = toAxial(origin);
        for (let rotation = 0; rotation < 6; rotation++)
          for (const mirrored of [false, true]) {
            const oriented = generateFormation(kind, origin, "tight", {
              strategy,
              rotation,
              mirrored,
            });
            const expected = baseline.map((tile) => {
              const a = toAxial(tile);
              return offset(
                origin,
                orientVector(
                  { q: a.q - originAxial.q, r: a.r - originAxial.r },
                  rotation,
                  mirrored,
                ),
              );
            });
            assert.deepEqual(oriented, expected);
            for (let i = 0; i < baseline.length; i++)
              for (let j = i + 1; j < baseline.length; j++)
                assert.equal(
                  distance(oriented[i], oriented[j]),
                  distance(baseline[i], baseline[j]),
                );
          }
      }
  }
});

test("existing cluster rotations preserve assignments and perform one simultaneous edit", () => {
  for (const origin of [anchor, { x: 500, y: 501 }]) {
    const original = samplePlan(origin),
      serialized = JSON.stringify(original);
    let plan = original;
    for (let turn = 0; turn < 6; turn++)
      plan = applied(
        plan,
        transformCluster(plan, "cluster", { turns: 1 }, mud),
      );
    assert.deepEqual(plan, original);
    assert.equal(JSON.stringify(original), serialized);
    const once = transformCluster(original, "cluster", { turns: 1 }, mud);
    assert.equal(once.valid, true);
    // A sixfold-symmetric Daisy changes named positions while its occupied set stays the same.
    assert.deepEqual(
      once.placements.map(key).sort(),
      original.placements.map(key).sort(),
    );
    assert.notDeepEqual(once.placements[1], original.placements[1]);
    assert.equal(once.placements[1].name, original.placements[1].name);
    assert.equal(once.placements[2].showGraphic, true);
    assert.deepEqual(
      once.placements.map((p) => [p.id, p.name, p.groupId, p.showGraphic]),
      original.placements.map((p) => [p.id, p.name, p.groupId, p.showGraphic]),
    );
  }
});

test("local mirror is reversible at every orientation and combined reset restores the canonical layout", () => {
  for (let rotation = 0; rotation < 6; rotation++)
    for (const mirrored of [false, true]) {
      const original = samplePlan(anchor, rotation, mirrored);
      const flipped = applied(
        original,
        transformCluster(original, "cluster", { flip: true }, mud),
      );
      assert.equal(flipped.clusters[0].rotation, rotation);
      assert.equal(flipped.clusters[0].mirrored, !mirrored);
      assert.notDeepEqual(
        flipped.placements.map(key).sort(),
        original.placements.map(key).sort(),
      );
      const restored = applied(
        flipped,
        transformCluster(flipped, "cluster", { flip: true }, mud),
      );
      assert.deepEqual(restored, original);
      const reset = applied(
        original,
        transformCluster(
          original,
          "cluster",
          { turns: -rotation, flip: mirrored },
          mud,
        ),
      );
      const canonical = samplePlan();
      assert.deepEqual(reset.placements, canonical.placements);
      assert.deepEqual(reset.clusters, canonical.clusters);
    }
});

test("external collision and stored clearance failures leave the complete plan untouched", () => {
  const destination = offset(anchor, { q: -1, r: 4 });
  for (const [gap, outside] of [
    [1, destination],
    [1, offset(destination, { q: 0, r: 3 })],
    [3, offset(destination, { q: 0, r: 5 })],
  ] as const) {
    const plan = oneMemberPlan();
    plan.clusters[0].minGap = gap;
    plan.placements.push({
      ...outside,
      id: "external",
      kind: "hq",
      name: "Outside base",
      groupId: "grass",
      showGraphic: false,
    });
    const serialized = JSON.stringify(plan),
      result = transformCluster(plan, "cluster", { turns: 1 }, mud);
    assert.equal(result.valid, false);
    assert.strictEqual(result.placements, plan.placements);
    assert.strictEqual(result.cluster, plan.clusters[0]);
    assert.ok(result.issues.some((issue) => issue.includes("Outside base")));
    assert.equal(JSON.stringify(plan), serialized);
  }
});

test("transforms check every footprint cell, terrain rules, unknowns and world edges", () => {
  const plan = oneMemberPlan(),
    destination = offset(anchor, { q: -1, r: 4 });
  const restrictedEdge = key(neighbors(destination)[0]);
  assert.equal(
    transformCluster(plan, "cluster", { turns: 1 }, (tile) =>
      key(tile) === restrictedEdge ? "restricted" : "mud",
    ).valid,
    false,
  );
  assert.equal(
    transformCluster(plan, "cluster", { turns: 1 }, grass).valid,
    false,
  );
  assert.equal(
    transformCluster(plan, "cluster", { turns: 1 }, () => "unknown").valid,
    false,
  );
  const provisional = {
    ...plan,
    settings: { ...plan.settings, allowUnknown: true },
  };
  assert.equal(
    transformCluster(provisional, "cluster", { turns: 1 }, () => "unknown")
      .valid,
    true,
  );
  assert.equal(
    transformCluster(provisional, "cluster", { turns: 1 }, () => "restricted")
      .valid,
    false,
  );
  const edgePlan = oneMemberPlan();
  edgePlan.clusters[0].anchor = { x: 1, y: 1 };
  edgePlan.placements[0] = {
    ...edgePlan.placements[0],
    ...offset(edgePlan.clusters[0].anchor, { q: 3, r: 0 }),
  };
  assert.equal(
    transformCluster(edgePlan, "cluster", { turns: 3 }, mud).valid,
    false,
  );
  assert.equal(
    transformCluster(edgePlan, "cluster", { turns: 3 }, (tile) => {
      assert.ok(inWorld(tile));
      return "mud";
    }).valid,
    false,
  );
});

test("partial deletion and empty clusters retain a fixed metadata anchor without recreating members", () => {
  const plan = samplePlan();
  plan.placements = plan.placements.filter(
    (placement) => placement.id !== "member-0" && placement.id !== "member-2",
  );
  const result = transformCluster(plan, "cluster", { turns: 1 }, mud);
  assert.equal(result.valid, true);
  assert.equal(result.placements.length, 5);
  assert.deepEqual(result.cluster?.anchor, anchor);
  assert.deepEqual(
    result.placements.map((p) => p.id),
    plan.placements.map((p) => p.id),
  );
  const empty = { ...plan, placements: [] };
  assert.equal(PlanSchema.safeParse(empty).success, true);
  const rotatedEmpty = transformCluster(empty, "cluster", { turns: 1 }, mud);
  assert.equal(rotatedEmpty.valid, true);
  assert.equal(rotatedEmpty.placements.length, 0);
  assert.deepEqual(rotatedEmpty.cluster?.anchor, anchor);
});

test("cluster schema defaults remain backward compatible and reject dangling references", () => {
  const plan = createPlan();
  const { clusters: _clusters, ...legacy } = plan;
  const { mirrored: _mirrored, ...oldSettings } = plan.settings;
  const parsed = PlanSchema.parse({ ...legacy, settings: oldSettings });
  assert.deepEqual(parsed.clusters, []);
  assert.equal(parsed.settings.mirrored, false);
  const assigned = samplePlan();
  assert.equal(PlanSchema.safeParse(assigned).success, true);
  assert.equal(
    PlanSchema.safeParse({ ...assigned, clusters: [] }).success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({
      ...assigned,
      clusters: [...assigned.clusters, ...assigned.clusters],
    }).success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({
      ...assigned,
      clusters: [{ ...assigned.clusters[0], anchor: { x: 1000, y: 500 } }],
    }).success,
    false,
  );
  assert.equal(
    transformCluster(assigned, "missing", { turns: 1 }, mud).valid,
    false,
  );
  assert.equal(
    transformCluster(assigned, "cluster", { turns: 0.5 }, mud).valid,
    false,
  );
  assert.equal(
    transformCluster(assigned, "cluster", { turns: Number.NaN }, mud).valid,
    false,
  );
});

test("large valid custom basis survives rotation and mirrored fill without revalidating transformed components", () => {
  const definition = StrategySchema.parse({
    schemaVersion: 1,
    id: "large-basis",
    name: "Large basis",
    description: "Regression for transformed component 120.",
    basis: [
      { q: 80, r: 40 },
      { q: -40, r: 80 },
    ],
    minGap: 0,
    terrain: "any",
    rotation: 1,
  });
  assert.deepEqual(orientVector(definition.basis[0], 1), { q: -40, r: 120 });
  const boundary = [
    { x: 200, y: 200 },
    { x: 800, y: 200 },
    { x: 800, y: 800 },
    { x: 200, y: 800 },
  ];
  for (let userRotation = 0; userRotation < 6; userRotation++)
    for (const mirrored of [false, true]) {
      const rotation =
        (userRotation + (mirrored ? -1 : 1) * definition.rotation + 6) % 6;
      let nextId = 0;
      const fill = smartFillBoundary({
        anchor,
        boundary,
        strategy: { ...definition, rotation },
        mirrored,
        placements: [],
        terrainAt: grass,
        groupId: "grass",
        maxCandidates: 2000,
        maxPlacements: 1000,
        makeId: () => `large-${nextId++}`,
      });
      const expectedVector = orientVector(
        orientVector(definition.basis[0], definition.rotation),
        userRotation,
        mirrored,
      );
      const expected = offset(anchor, expectedVector);
      assert.ok(
        fill.placements.some((placement) => key(placement) === key(expected)),
        `${userRotation}, mirror ${mirrored}`,
      );
      assert.equal(fill.truncated, false);
    }
});
