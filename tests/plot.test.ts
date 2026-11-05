import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_VISIBLE_PLOT_SITES,
  key,
  nearestPlotTile,
  offset,
  orientVector,
  plotCoordinates,
  strategyBasis,
  toAxial,
  visiblePlotSites,
  type PlotBounds,
  type PlotLattice,
  type Tile,
} from "../src/domain";

function numerators(tile: Tile, lattice: PlotLattice) {
  const center = toAxial(lattice.anchor),
    point = toAxial(tile),
    [a, b] = lattice.basis;
  const q = point.q - center.q,
    r = point.r - center.r;
  return {
    i: q * b.r - r * b.q,
    j: a.q * r - a.r * q,
    d: a.q * b.r - a.r * b.q,
  };
}

function bruteNearest(query: Tile, lattice: PlotLattice): Tile | null {
  let best: Tile | null = null,
    bestCost = Infinity;
  const center = toAxial(lattice.anchor),
    [a, b] = lattice.basis;
  const determinant = a.q * b.r - a.r * b.q;
  for (let y = 0; y < 1000; y++)
    for (let x = 0; x < 1000; x++) {
      const q = x - (y - (y & 1)) / 2 - center.q,
        r = y - center.r;
      if (
        (q * b.r - r * b.q) % determinant !== 0 ||
        (a.q * r - a.r * q) % determinant !== 0
      )
        continue;
      const dx2 = 2 * (x - query.x) + (y & 1) - (query.y & 1),
        dy = y - query.y;
      const cost = dx2 * dx2 + 3 * dy * dy;
      if (cost < bestCost) {
        best = { x, y };
        bestCost = cost;
      }
    }
  return best;
}

function bruteVisible(lattice: PlotLattice, bounds: PlotBounds): Tile[] {
  const nodes: Tile[] = [];
  for (
    let y = Math.max(0, Math.ceil(bounds.minY));
    y <= Math.min(999, Math.floor(bounds.maxY));
    y++
  ) {
    for (
      let x = Math.max(0, Math.ceil(bounds.minX));
      x <= Math.min(999, Math.floor(bounds.maxX));
      x++
    ) {
      const n = numerators({ x, y }, lattice);
      if (n.i % n.d === 0 && n.j % n.d === 0) nodes.push({ x, y });
    }
  }
  return nodes;
}

test("supplied stagger plot coefficients remain exact through parity, six turns and mirroring", () => {
  for (const anchor of [
    { x: 500, y: 500 },
    { x: 500, y: 501 },
  ]) {
    for (const kind of ["mud-tight", "grass-wide"] as const) {
      for (let rotation = 0; rotation < 6; rotation++)
        for (const mirrored of [false, true]) {
          const lattice: PlotLattice = {
              anchor,
              basis: strategyBasis(kind, rotation, mirrored),
            },
            [a, b] = lattice.basis;
          for (let i = -3; i <= 3; i++)
            for (let j = -3; j <= 3; j++) {
              const tile = offset(anchor, {
                q: i * a.q + j * b.q,
                r: i * a.r + j * b.r,
              });
              assert.deepEqual(plotCoordinates(tile, lattice), {
                i,
                j,
                onPlot: true,
              });
            }
          assert.equal(
            plotCoordinates(offset(anchor, { q: 1, r: 0 }), lattice).onPlot,
            false,
          );
          const node = offset(anchor, { q: 2 * a.q - b.q, r: 2 * a.r - b.r });
          assert.deepEqual(nearestPlotTile(node, lattice), {
            tile: node,
            i: 2,
            j: -1,
          });
        }
    }
  }
});

test("nearest plot node agrees with independent exhaustive world search for skewed and transformed bases", () => {
  const skew: PlotLattice["basis"] = [
    { q: 100, r: 99 },
    { q: 99, r: 100 },
  ];
  const transformed: PlotLattice["basis"] = [
    orientVector(skew[0], 1, true),
    orientVector(skew[1], 1, true),
  ];
  const bases: PlotLattice["basis"][] = [
    strategyBasis("mud-tight"),
    strategyBasis("grass-wide"),
    skew,
    transformed,
    [
      { q: 100, r: 100 },
      { q: 99, r: 98 },
    ],
    [
      { q: 0, r: 7 },
      { q: 5, r: 0 },
    ],
  ];
  for (const basis of bases)
    for (const query of [
      { x: 501, y: 500 },
      { x: 0, y: 0 },
      { x: 999, y: 999 },
      { x: -20, y: 1050 },
    ]) {
      const lattice: PlotLattice = { anchor: { x: 500, y: 501 }, basis };
      const actual = nearestPlotTile(query, lattice);
      assert.deepEqual(actual?.tile ?? null, bruteNearest(query, lattice));
      if (actual)
        assert.deepEqual(plotCoordinates(actual.tile, lattice), {
          i: actual.i,
          j: actual.j,
          onPlot: true,
        });
    }
  const lattice: PlotLattice = { anchor: { x: 500, y: 500 }, basis: skew },
    query = { x: 501, y: 500 };
  const fractional = plotCoordinates(query, lattice),
    [a, b] = skew;
  const naive = offset(lattice.anchor, {
    q: Math.round(fractional.i) * a.q + Math.round(fractional.j) * b.q,
    r: Math.round(fractional.i) * a.r + Math.round(fractional.j) * b.r,
  });
  assert.notDeepEqual(nearestPlotTile(query, lattice)?.tile, naive);
  assert.deepEqual(nearestPlotTile(query, lattice)?.tile, { x: 500, y: 499 });
});

test("visible sites match brute-force clipped offset bounds and retain original basis coefficients", () => {
  for (const anchor of [
    { x: 500, y: 500 },
    { x: 500, y: 501 },
  ]) {
    for (const kind of ["mud-tight", "grass-wide"] as const)
      for (let rotation = 0; rotation < 6; rotation++)
        for (const mirrored of [false, true]) {
          const lattice: PlotLattice = {
            anchor,
            basis: strategyBasis(kind, rotation, mirrored),
          };
          const bounds = { minX: 475.2, maxX: 525.9, minY: 475.1, maxY: 525.8 };
          const result = visiblePlotSites(lattice, bounds, 5000);
          assert.equal(result.truncated, false);
          assert.deepEqual(
            result.sites.map((site) => site.tile),
            bruteVisible(lattice, bounds),
          );
          for (const site of result.sites) {
            const n = numerators(site.tile, lattice);
            assert.equal(site.i, n.i / n.d || 0);
            assert.equal(site.j, n.j / n.d || 0);
          }
        }
  }
});

test("dense skewed plots are hard-bounded even for huge zoom-out bounds and caller limits", () => {
  const lattice: PlotLattice = {
    anchor: { x: 500, y: 500 },
    basis: [
      { q: 100, r: 99 },
      { q: 99, r: 98 },
    ],
  };
  const world = { minX: -1e12, maxX: 1e12, minY: -1e12, maxY: 1e12 };
  const few = visiblePlotSites(lattice, world, 3);
  assert.deepEqual(
    few.sites.map((site) => key(site.tile)),
    ["0,0", "1,0", "2,0"],
  );
  assert.equal(few.truncated, true);
  assert.equal(visiblePlotSites(lattice, world).sites.length, 400);
  const capped = visiblePlotSites(lattice, world, 1_000_000_000);
  assert.equal(capped.sites.length, MAX_VISIBLE_PLOT_SITES);
  assert.equal(capped.truncated, true);
  assert.deepEqual(visiblePlotSites(lattice, world, 0), {
    sites: [],
    truncated: true,
  });
  const exact = visiblePlotSites(
    lattice,
    { minX: 0, maxX: 2, minY: 0, maxY: 0 },
    3,
  );
  assert.equal(exact.sites.length, 3);
  assert.equal(exact.truncated, false);
  assert.deepEqual(
    visiblePlotSites(lattice, { minX: 1000, maxX: 10000, minY: 0, maxY: 999 }),
    { sites: [], truncated: false },
  );
  assert.deepEqual(
    visiblePlotSites(lattice, { minX: 5, maxX: 2, minY: 0, maxY: 999 }),
    { sites: [], truncated: false },
  );
});

test("ties, empty world intersection, immutability and invalid definitions are deterministic", () => {
  const lattice: PlotLattice = {
    anchor: { x: 0, y: 0 },
    basis: [
      { q: 2, r: 0 },
      { q: 0, r: 2 },
    ],
  };
  Object.freeze(lattice.anchor);
  lattice.basis.forEach(Object.freeze);
  Object.freeze(lattice.basis);
  Object.freeze(lattice);
  assert.deepEqual(nearestPlotTile({ x: 1, y: 0 }, lattice), {
    tile: { x: 0, y: 0 },
    i: 0,
    j: 0,
  });
  assert.deepEqual(
    visiblePlotSites(lattice, {
      minX: -5.8,
      maxX: 6.7,
      minY: -1.3,
      maxY: 4.9,
    }).sites.map((site) => site.tile),
    bruteVisible(lattice, { minX: 0, maxX: 6, minY: 0, maxY: 4 }),
  );
  const empty: PlotLattice = {
    anchor: { x: 1000, y: 1000 },
    basis: [
      { q: 2000, r: 0 },
      { q: 0, r: 2000 },
    ],
  };
  assert.equal(nearestPlotTile({ x: 500, y: 500 }, empty), null);
  assert.deepEqual(
    visiblePlotSites(empty, { minX: 0, maxX: 999, minY: 0, maxY: 999 }),
    { sites: [], truncated: false },
  );
  const singular: PlotLattice = {
    anchor: { x: 0, y: 0 },
    basis: [
      { q: 1, r: 1 },
      { q: 2, r: 2 },
    ],
  };
  assert.throws(() => nearestPlotTile({ x: 0, y: 0 }, singular));
  assert.throws(() => plotCoordinates({ x: 0.5, y: 0 }, lattice));
  assert.throws(() =>
    visiblePlotSites(lattice, { minX: NaN, maxX: 1, minY: 0, maxY: 1 }),
  );
  assert.throws(() =>
    visiblePlotSites(lattice, { minX: 0, maxX: 1, minY: 0, maxY: 1 }, -1),
  );
});
