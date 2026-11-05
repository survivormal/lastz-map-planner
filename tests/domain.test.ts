import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanSchema,
  analyzeReplacement,
  coordinateToken,
  createPlan,
  distance,
  footprint,
  footprintInBoundary,
  fromAxial,
  fromPointId,
  generateFormation,
  generateStagger,
  generateStaggerDaisy,
  hexVertices,
  inWorld,
  key,
  neighbors,
  offset,
  pixelToWorld,
  placementFootprint,
  pointId,
  pointInPolygon,
  polygonContainsPolygon,
  routeDistance,
  terrainWithOverrides,
  tileInBoundary,
  toAxial,
  strategyBasis,
  validateMove,
  validatePlacement,
  worldToPixel,
  type Placement,
  type Tile,
} from "../src/domain/index";

const grass = () => "grass" as const;
const hq = (center: Tile, id = "one"): Placement => ({
  ...center,
  id,
  kind: "hq",
  name: id,
  groupId: "mud",
  showGraphic: false,
});
const center = { x: 500, y: 500 };

test("offset hex parity, map IDs and all-world projection round trips", () => {
  for (const tile of [
    { x: 0, y: 0 },
    { x: 999, y: 999 },
    { x: 5, y: 8 },
    { x: 5, y: 9 },
    center,
  ]) {
    assert.deepEqual(fromAxial(toAxial(tile)), tile);
    assert.deepEqual(fromPointId(pointId(tile)), tile);
    assert.deepEqual(pixelToWorld(worldToPixel(tile)), tile);
    assert.equal(neighbors(tile).length, 6);
    assert.ok(neighbors(tile).every((other) => distance(tile, other) === 1));
    assert.ok(
      hexVertices(tile).every(
        (pixel) =>
          Math.abs(
            Math.hypot(
              pixel.x - worldToPixel(tile).x,
              pixel.y - worldToPixel(tile).y,
            ) - 16,
          ) < 1e-8,
      ),
    );
  }
  for (let y = 0; y < 1000; y++) {
    for (const x of [0, 1, 499, 998, 999])
      assert.deepEqual(pixelToWorld(worldToPixel({ x, y })), { x, y });
  }
  assert.equal(pointId({ x: 0, y: 0 }), 1);
  assert.equal(pointId({ x: 999, y: 999 }), 1_000_000);
  assert.deepEqual(neighbors({ x: 5, y: 9 }).map(key).sort(), [
    "4,9",
    "5,10",
    "5,8",
    "6,10",
    "6,8",
    "6,9",
  ]);
  assert.throws(() => pointId({ x: -1, y: 0 }));
  assert.throws(() => fromPointId(0));
  assert.equal(inWorld({ x: 1.5, y: 3 }), false);
});

test("a seven-cell HQ rejects out-of-world and restricted edge cells", () => {
  assert.equal(footprint(center).length, 7);
  assert.equal(footprint(center, 2).length, 19);
  assert.equal(
    validatePlacement(hq({ x: 0, y: 0 }), [], { terrainAt: grass }).valid,
    false,
  );
  const restricted = key(neighbors(center)[0]);
  assert.equal(
    validatePlacement(hq(center), [], {
      terrainAt: (tile) => (key(tile) === restricted ? "restricted" : "grass"),
    }).valid,
    false,
  );
  assert.equal(
    validatePlacement(hq(center), [], { terrainAt: () => "unknown" }).valid,
    false,
  );
  const sandbox = validatePlacement(hq(center), [], {
    terrainAt: () => "unknown",
    allowUnknown: true,
  });
  assert.equal(sandbox.valid, true);
  assert.equal(sandbox.unknownTiles.length, 7);
  assert.equal(
    validatePlacement(hq(center), [], {
      terrainAt: () => "restricted",
      allowUnknown: true,
    }).valid,
    false,
  );
});

test("tile, tight, and loose mean zero, one, and two empty tiles between full footprints", () => {
  const first = hq(center);
  for (const [spacing, required] of [
    ["tile", 3],
    ["tight", 4],
    ["loose", 5],
  ] as const) {
    for (const direction of neighbors(center)) {
      const a = toAxial(center),
        b = toAxial(direction);
      const legal = hq(
        offset(center, {
          q: (b.q - a.q) * required,
          r: (b.r - a.r) * required,
        }),
        "second",
      );
      const illegal = hq(
        offset(center, {
          q: (b.q - a.q) * (required - 1),
          r: (b.r - a.r) * (required - 1),
        }),
        "third",
      );
      assert.equal(
        validatePlacement(legal, [first], { terrainAt: grass, spacing }).valid,
        true,
      );
      assert.equal(
        validatePlacement(illegal, [first], { terrainAt: grass, spacing })
          .valid,
        false,
      );
    }
  }
  assert.equal(
    validatePlacement(first, [first], { terrainAt: grass, ignoreId: first.id })
      .valid,
    true,
  );
  assert.equal(
    validatePlacement({ ...first, kind: "food" }, [first], { terrainAt: grass })
      .valid,
    false,
  );
  assert.equal(placementFootprint({ ...first, kind: "wood" }).length, 7);
  assert.equal(
    validatePlacement({ ...first, kind: "food" }, [], {
      terrainAt: () => "mud",
    }).valid,
    false,
  );
  assert.equal(
    validatePlacement({ ...first, kind: "wood" }, [], {
      terrainAt: (tile) =>
        key(tile) === key(neighbors(center)[0]) ? "mud" : "grass",
    }).valid,
    false,
  );
  assert.equal(
    validatePlacement(first, [], { terrainAt: () => "mud" }).valid,
    true,
  );
});

test("alliance blockers check every footprint tile against the optional 50-step leader/rally range", () => {
  for (const anchor of [center, { x: 500, y: 501 }]) {
    for (const neighbor of neighbors(anchor)) {
      const a = toAxial(anchor),
        b = toAxial(neighbor);
      const at49 = offset(anchor, { q: (b.q - a.q) * 49, r: (b.r - a.r) * 49 });
      const at50 = offset(anchor, { q: (b.q - a.q) * 50, r: (b.r - a.r) * 50 });
      for (const kind of ["food", "wood"] as const) {
        assert.equal(
          validatePlacement({ ...hq(at49), kind }, [], {
            terrainAt: grass,
            allianceAnchor: anchor,
          }).valid,
          true,
        );
        const edge = validatePlacement({ ...hq(at50), kind }, [], {
          terrainAt: grass,
          allianceAnchor: anchor,
        });
        assert.equal(edge.valid, false);
        assert.ok(
          edge.issues.some((issue) => issue.includes("within 50 hex steps")),
        );
        assert.equal(
          validatePlacement({ ...hq(at50), kind }, [], { terrainAt: grass })
            .valid,
          true,
        );
      }
      assert.equal(
        validatePlacement(hq(at50), [], {
          terrainAt: grass,
          allianceAnchor: anchor,
        }).valid,
        true,
      );
    }
  }
  assert.equal(
    validatePlacement({ ...hq(center), kind: "food" }, [], {
      terrainAt: grass,
      allianceAnchor: { x: -1, y: 5 },
    }).valid,
    false,
  );
  const plan = createPlan();
  assert.equal(plan.allianceAnchor, null);
  const { allianceAnchor: _anchor, ...legacyPlan } = plan;
  assert.equal(PlanSchema.parse(legacyPlan).allianceAnchor, null);
  assert.deepEqual(
    PlanSchema.parse({ ...plan, allianceAnchor: center }).allianceAnchor,
    center,
  );
  assert.equal(
    PlanSchema.safeParse({ ...plan, allianceAnchor: { x: 1000, y: 0 } })
      .success,
    false,
  );
});

test("alliance blockers exclude the rally tile or the full leader footprint", () => {
  for (const anchor of [center, { x: 500, y: 501 }]) {
    for (const allianceAnchorKind of ["leader", "rally"] as const) {
      const options = { terrainAt: grass, allianceAnchor: anchor, allianceAnchorKind };
      const excluded = new Set(footprint(anchor, allianceAnchorKind === "leader" ? 1 : 0).map(key));
      for (const tile of footprint(anchor, 4)) {
        const expected = footprint(tile).every((cell) => !excluded.has(key(cell)));
        for (const kind of ["food", "wood"] as const) {
          const result = validatePlacement({ ...hq(tile), kind }, [], options);
          assert.equal(result.valid, expected, `${kind} ${allianceAnchorKind} ${key(tile)}`);
        }
      }
      assert.equal(validatePlacement(hq(anchor), [], options).valid, true);
      const fringe = offset(anchor, { q: 50, r: 0 });
      assert.equal(validatePlacement({ ...hq(fringe), kind: "food" }, [], options).valid, false);
    }
    const twoSteps = offset(anchor, { q: 2, r: 0 });
    assert.equal(validatePlacement({ ...hq(twoSteps), kind: "wood" }, [], { terrainAt: grass, allianceAnchor: anchor }).valid, false);
    assert.equal(validatePlacement({ ...hq(twoSteps), kind: "wood" }, [], { terrainAt: grass, allianceAnchor: anchor, allianceAnchorKind: "rally" }).valid, true);
    assert.equal(validatePlacement({ ...hq(anchor), kind: "wood" }, [], { terrainAt: grass, allianceAnchorKind: "leader" }).valid, true);
  }
  const plan = createPlan();
  assert.equal(plan.allianceAnchorKind, "leader");
  const { allianceAnchorKind: _kind, ...legacy } = plan;
  assert.equal(PlanSchema.parse(legacy).allianceAnchorKind, "leader");
  assert.equal(PlanSchema.parse({ ...plan, allianceAnchorKind: "rally" }).allianceAnchorKind, "rally");
  assert.equal(PlanSchema.safeParse({ ...plan, allianceAnchorKind: "unknown" }).success, false);
});

test("HQ moves reject overlap with the old footprint while allowing no-op and clear destinations", () => {
  const first = hq(center);
  assert.equal(
    validateMove(first, center, [first], { terrainAt: grass }).valid,
    true,
  );
  assert.equal(
    validateMove(first, offset(center, { q: 1, r: 0 }), [first], {
      terrainAt: grass,
    }).valid,
    false,
  );
  assert.equal(
    validateMove(first, offset(center, { q: 2, r: 0 }), [first], {
      terrainAt: grass,
    }).valid,
    false,
  );
  assert.equal(
    validateMove(first, offset(center, { q: 3, r: 0 }), [first], {
      terrainAt: grass,
    }).valid,
    true,
  );
  for (const origin of [center, { x: 500, y: 501 }]) {
    const base = hq(origin);
    const oldCells = new Set(footprint(origin).map(key));
    for (const destination of footprint(origin, 4)) {
      const overlap = footprint(destination).some((tile) =>
        oldCells.has(key(tile)),
      );
      const noOp = key(origin) === key(destination);
      assert.equal(
        validateMove(base, destination, [base], { terrainAt: grass }).valid,
        noOp || !overlap,
      );
    }
  }
  const neighboring = hq(offset(center, { q: 4, r: 0 }), "neighbor");
  assert.equal(
    validateMove(first, offset(center, { q: 3, r: 0 }), [first, neighboring], {
      terrainAt: grass,
    }).valid,
    false,
  );
});

test("single-loss analysis gives an explicit pair and separates existing openings", () => {
  const target = hq(center);
  const result = analyzeReplacement(target, [target], { terrainAt: grass });
  assert.equal(result.risk, "two-fit");
  assert.equal(result.newlyEnabled.length, 19);
  assert.ok(result.existingOpen.length > 0);
  assert.ok(result.witnessPair);
  assert.ok(distance(...result.witnessPair!) >= 3);
  assert.ok(
    result.witnessPair!.every((candidate) => distance(candidate, center) <= 2),
  );
});

test("known 13-cell lattice leaves only pairwise-overlapping replacement centers", () => {
  const target = hq(center);
  const offsets = [
    [-4, 3],
    [-3, -1],
    [-1, 4],
    [1, -4],
    [3, 1],
    [4, -3],
  ];
  const placements = [
    target,
    ...offsets.map(([q, r], index) =>
      hq(offset(center, { q, r }), `neighbor-${index}`),
    ),
  ];
  const result = analyzeReplacement(target, placements, { terrainAt: grass });
  assert.equal(result.risk, "one-fit");
  assert.equal(result.newlyEnabled.length, 7);
  assert.equal(result.witnessPair, undefined);
  assert.deepEqual(
    result.newlyEnabled.map(key).sort(),
    footprint(center).map(key).sort(),
  );
});

test("unknown terrain cannot produce a purportedly verified replacement result", () => {
  const target = hq(center);
  const result = analyzeReplacement(target, [target], {
    terrainAt: () => "unknown",
  });
  assert.equal(result.newlyEnabled.length, 0);
  assert.ok(result.unknownTiles.length > 0);
});

test("distance-two replacement enumeration equals an independent larger search on edges and blocked terrain", () => {
  let seed = 9341;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const origin of [
    center,
    { x: 500, y: 501 },
    { x: 1, y: 1 },
    { x: 998, y: 998 },
  ]) {
    for (let scenario = 0; scenario < 8; scenario++) {
      const target = hq(origin);
      const placements: Placement[] = [target];
      const cells = footprint(origin, 6);
      for (let i = 0; i < 12; i++) {
        const candidate = hq(
          cells[Math.floor(random() * cells.length)],
          `blocker-${i}`,
        );
        if (
          validatePlacement(candidate, placements, { terrainAt: grass }).valid
        )
          placements.push(candidate);
      }
      const blocked = new Set(
        cells
          .filter((tile) => distance(tile, origin) > 1 && random() < 0.12)
          .map(key),
      );
      const terrainAt = (tile: Tile) =>
        blocked.has(key(tile)) ? ("restricted" as const) : ("grass" as const);
      const occupiedBefore = new Set(
        placements.flatMap((placement) => footprint(placement).map(key)),
      );
      const occupiedAfter = new Set(
        placements
          .filter((placement) => placement.id !== target.id)
          .flatMap((placement) => footprint(placement).map(key)),
      );
      const directlyFits = (tile: Tile, occupied: Set<string>) =>
        footprint(tile).every(
          (cell) =>
            inWorld(cell) &&
            !blocked.has(key(cell)) &&
            !occupied.has(key(cell)),
        );
      const independentlyNew = cells.filter((tile) => {
        return (
          directlyFits(tile, occupiedAfter) &&
          !directlyFits(tile, occupiedBefore)
        );
      });
      const result = analyzeReplacement(target, placements, { terrainAt });
      assert.deepEqual(
        result.newlyEnabled.map(key).sort(),
        independentlyNew.map(key).sort(),
      );
      const brutePairs = independentlyNew.flatMap((a, i) =>
        independentlyNew
          .slice(i + 1)
          .filter((b) => {
            const cellsA = new Set(footprint(a).map(key));
            return footprint(b).every((tile) => !cellsA.has(key(tile)));
          })
          .map((b) => [a, b]),
      );
      assert.equal(result.risk === "two-fit", brutePairs.length > 0);
      if (result.witnessPair) {
        const [a, b] = result.witnessPair;
        assert.equal(
          validatePlacement(
            hq(a, "enemy-a"),
            placements.filter((p) => p.id !== target.id),
            { terrainAt },
          ).valid,
          true,
        );
        assert.equal(
          validatePlacement(
            hq(b, "enemy-b"),
            [...placements.filter((p) => p.id !== target.id), hq(a, "enemy-a")],
            { terrainAt },
          ).valid,
          true,
        );
      }
      assert.ok(
        result.existingOpen.every(
          (tile) =>
            validatePlacement(hq(tile), placements, { terrainAt }).valid,
        ),
      );
    }
  }
});

test("two legal replacement centers that overlap are never reported as a two-fit witness", () => {
  const target = hq(center);
  const adjacent = offset(center, { q: 1, r: 0 });
  const legalTerrain = new Set(
    [...footprint(center), ...footprint(adjacent)].map(key),
  );
  const result = analyzeReplacement(target, [target], {
    terrainAt: (tile) => (legalTerrain.has(key(tile)) ? "mud" : "restricted"),
  });
  assert.equal(result.newlyEnabled.length, 2);
  assert.equal(result.risk, "one-fit");
  assert.equal(result.witnessPair, undefined);
});

test("already-open neighbors do not turn a one-fit vacancy into a two-fit result", () => {
  const target = hq(center);
  const existingHole = offset(center, { q: 4, r: 0 });
  const legalTerrain = new Set(
    [...footprint(center), ...footprint(existingHole)].map(key),
  );
  const result = analyzeReplacement(target, [target], {
    terrainAt: (tile) => (legalTerrain.has(key(tile)) ? "grass" : "restricted"),
  });
  assert.deepEqual(result.newlyEnabled.map(key), [key(center)]);
  assert.ok(
    result.existingOpen.some((tile) => key(tile) === key(existingHole)),
  );
  assert.equal(result.risk, "one-fit");
});

test("formation templates honor requested spacing on both row parities and every rotation", () => {
  for (const kind of ["daisy", "grass", "mud"] as const) {
    for (const spacing of ["tile", "tight", "loose"] as const) {
      for (let rotation = 0; rotation < 6; rotation++) {
        for (const origin of [center, { x: 500, y: 501 }]) {
          const cells = generateFormation(kind, origin, spacing, { rotation });
          assert.equal(cells.length, kind === "daisy" ? 7 : 12);
          const placed: Placement[] = [];
          for (const [i, cell] of cells.entries()) {
            const next = hq(cell, String(i));
            assert.equal(
              validatePlacement(next, placed, { terrainAt: grass, spacing })
                .valid,
              true,
              `${kind} ${spacing} ${rotation}`,
            );
            placed.push(next);
          }
        }
      }
    }
  }
});

test("supplied stagger strategies retain their exact basis, determinant, and six neighbors", () => {
  for (const [strategy, expected, nearest, area, spacing] of [
    [
      "mud-tight",
      [
        { q: 3, r: 1 },
        { q: -1, r: 4 },
      ],
      4,
      13,
      "tight",
    ],
    [
      "grass-wide",
      [
        { q: 3, r: 2 },
        { q: -2, r: 5 },
      ],
      5,
      19,
      "loose",
    ],
  ] as const) {
    assert.deepEqual(strategyBasis(strategy), expected);
    for (let rotation = 0; rotation < 6; rotation++) {
      const [a, b] = strategyBasis(strategy, rotation);
      assert.equal(a.q * b.r - a.r * b.q, area);
      for (const origin of [center, { x: 500, y: 501 }]) {
        const daisy = generateStaggerDaisy(strategy, origin, { rotation });
        assert.equal(daisy.length, 7);
        assert.ok(
          daisy.slice(1).every((tile) => distance(origin, tile) === nearest),
        );
        const cells = generateStagger(strategy, origin, {
          rotation,
          rows: 5,
          columns: 5,
        });
        const placements: Placement[] = [];
        for (const [index, tile] of cells.entries()) {
          const placement = hq(tile, String(index));
          assert.equal(
            validatePlacement(placement, placements, {
              terrainAt: grass,
              spacing,
            }).valid,
            true,
          );
          placements.push(placement);
        }
        assert.deepEqual(
          generateFormation("daisy", origin, "tile", { strategy, rotation }),
          daisy,
        );
        assert.deepEqual(
          generateFormation("grass", origin, "tile", {
            strategy,
            rotation,
            rows: 5,
            columns: 5,
          }),
          cells,
        );
        if (strategy === "mud-tight") {
          const ring = daisy.map((tile, index) => hq(tile, String(index)));
          const loss = analyzeReplacement(ring[0], ring, { terrainAt: grass });
          assert.equal(loss.risk, "one-fit");
          assert.equal(loss.newlyEnabled.length, 7);
        }
      }
    }
  }
});

test("saved plans validate IDs, group references, coordinate bounds and unique overrides", () => {
  const plan = createPlan();
  assert.equal(PlanSchema.safeParse(plan).success, true);
  assert.equal(
    PlanSchema.safeParse({ ...plan, schemaVersion: 2 }).success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({ ...plan, placements: [hq({ x: 1000, y: 4 })] })
      .success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({
      ...plan,
      placements: [{ ...hq(center), groupId: "missing" }],
    }).success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({ ...plan, placements: [hq(center), hq(center)] })
      .success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({
      ...plan,
      terrainOverrides: [
        { ...center, terrain: "mud" },
        { ...center, terrain: "grass" },
      ],
    }).success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({
      ...plan,
      boundaries: [
        { id: "a", name: "A", points: [center, center], closed: true },
      ],
    }).success,
    false,
  );
  const strategy = {
    schemaVersion: 1,
    id: "custom-stagger",
    name: "Custom",
    description: "Custom lattice.",
    basis: [
      { q: 3, r: 1 },
      { q: -1, r: 4 },
    ],
    minGap: 1,
    terrain: "any",
    rotation: 0,
  };
  assert.equal(
    PlanSchema.safeParse({ ...plan, strategies: [strategy] }).success,
    true,
  );
  assert.equal(
    PlanSchema.safeParse({
      ...plan,
      strategies: [{ ...strategy, id: "mud-tight" }],
    }).success,
    false,
  );
  assert.equal(
    PlanSchema.safeParse({ ...plan, strategies: [strategy, strategy] }).success,
    false,
  );
  const { strategies: _strategies, ...legacyPlan } = plan;
  assert.deepEqual(PlanSchema.parse(legacyPlan).strategies, []);
  assert.equal(coordinateToken(center), "[#:802 X:500 Y:500]");
});

test("terrain overrides, boundary edge inclusion and route distance are deterministic", () => {
  const terrainAt = terrainWithOverrides(
    () => "unknown",
    [{ ...center, terrain: "mud" }],
  );
  assert.equal(terrainAt(center), "mud");
  assert.equal(terrainAt({ x: 20, y: 20 }), "unknown");
  const polygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(pointInPolygon({ x: 5, y: 5 }, polygon), true);
  assert.equal(pointInPolygon({ x: 10, y: 3 }, polygon), true);
  assert.equal(pointInPolygon({ x: 11, y: 3 }, polygon), false);
  assert.equal(
    routeDistance([
      center,
      offset(center, { q: 3, r: 0 }),
      offset(center, { q: 3, r: 4 }),
    ]),
    7,
  );
});

test("formation footprint fitting rejects edge crossings and concave polygon notches", () => {
  const square = [
    { x: 494, y: 494 },
    { x: 506, y: 494 },
    { x: 506, y: 506 },
    { x: 494, y: 506 },
  ];
  assert.equal(footprintInBoundary(center, square), true);
  const onEdge = { x: 494, y: 500 };
  assert.equal(tileInBoundary(onEdge, square), true);
  assert.equal(footprintInBoundary(onEdge, square), false);
  const daisy = generateFormation("daisy", center, "tight");
  assert.ok(daisy.every((tile) => footprintInBoundary(tile, square)));
  const extended = generateFormation("grass", center, "tight", {
    rows: 4,
    columns: 4,
  });
  assert.ok(extended.some((tile) => !footprintInBoundary(tile, square)));

  // Every vertex of the inner rectangle is inside, but its top edge crosses a narrow notch.
  const concave = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 6 },
    { x: 6, y: 6 },
    { x: 6, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const crossing = [
    { x: 2, y: 4 },
    { x: 8, y: 4 },
    { x: 8, y: 8 },
    { x: 2, y: 8 },
  ];
  assert.ok(crossing.every((point) => pointInPolygon(point, concave)));
  assert.equal(polygonContainsPolygon(concave, crossing), false);
  assert.equal(
    polygonContainsPolygon(concave, [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 8 },
      { x: 1, y: 8 },
    ]),
    true,
  );
});
