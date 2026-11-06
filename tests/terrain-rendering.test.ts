import assert from "node:assert/strict";
import test from "node:test";
import {
  terrainEdges,
  viewportTerrainEdges,
  type TerrainEdge,
} from "../src/components/terrain-rendering";
import {
  AXIAL_DIRECTIONS,
  hexVertices,
  inWorld,
  key,
  neighbors,
  offset,
  type Pixel,
  type Tile,
} from "../src/domain/geometry";
import type { Terrain } from "../src/domain/schema";

const pointKey = (point: Pixel) =>
  `${point.x.toFixed(7)},${point.y.toFixed(7)}`;
const edgeKey = (edge: TerrainEdge) => edge.map(pointKey).sort().join(";");
const singleCell = (tile: Tile) => ({
  minX: tile.x,
  maxX: tile.x,
  minY: tile.y,
  maxY: tile.y,
});

test("terrain sides match shared hex vertices for both row parities and clipped neighbors", () => {
  for (const y of [100, 101]) {
    const center = { x: 100, y };
    const lookup = (tile: Tile): Terrain =>
      key(tile) === key(center) ? "mud" : "grass";
    const allSides = terrainEdges(singleCell(center), lookup);
    assert.equal(allSides.shore.length, 6);
    for (const neighbor of neighbors(center)) {
      const centerVertices = new Set(hexVertices(center).map(pointKey));
      const sharedVertices = hexVertices(neighbor)
        .filter((point) => centerVertices.has(pointKey(point)))
        .map(pointKey)
        .sort();
      assert.equal(sharedVertices.length, 2);
      const clipped = terrainEdges(singleCell(neighbor), lookup);
      assert.equal(clipped.shore.length, 1);
      assert.equal(edgeKey(clipped.shore[0]), sharedVertices.join(";"));
      const originalEdge = allSides.shore.find(
        (edge) => edgeKey(edge) === edgeKey(clipped.shore[0]),
      );
      // Canonical coordinates/order are stable even without rounding.
      assert.deepEqual(clipped.shore[0], originalEdge);

      const both = terrainEdges(
        {
          minX: Math.min(center.x, neighbor.x),
          maxX: Math.max(center.x, neighbor.x),
          minY: Math.min(center.y, neighbor.y),
          maxY: Math.max(center.y, neighbor.y),
        },
        lookup,
      );
      assert.equal(both.shore.length, 6);
      assert.equal(new Set(both.shore.map(edgeKey)).size, 6);
    }
  }
});

test("shore, restricted, and unverified transitions remain distinct and use fresh cached terrain", () => {
  const center = { x: 200, y: 201 };
  const adjacent = neighbors(center);
  const terrainByTile = new Map<string, Terrain>([
    [key(adjacent[0]), "mud"],
    [key(adjacent[1]), "restricted"],
    [key(adjacent[2]), "unknown"],
  ]);
  const reads = new Map<string, number>();
  const lookup = (tile: Tile): Terrain => {
    reads.set(key(tile), (reads.get(key(tile)) ?? 0) + 1);
    return terrainByTile.get(key(tile)) ?? "grass";
  };
  const result = terrainEdges(singleCell(center), lookup);
  assert.equal(result.shore.length, 1);
  assert.equal(result.restricted.length, 1);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.world.length, 0);
  assert.equal(result.visitedCells, 1);
  assert.equal(result.truncated, false);

  reads.clear();
  terrainEdges({ minX: 198, maxX: 202, minY: 199, maxY: 203 }, lookup);
  assert.ok([...reads.values()].every((count) => count === 1));

  // The same callback identity may now reflect a changed user terrain override.
  terrainByTile.set(key(center), "restricted");
  const edited = terrainEdges(singleCell(center), lookup);
  assert.equal(edited.restricted.length, 5);
  assert.equal(edited.shore.length, 0);
  assert.equal(edited.unknown.length, 0);
});

test("world outline follows odd-row hex edges and never reads off-world terrain", () => {
  for (const center of [
    { x: 0, y: 0 },
    { x: 999, y: 0 },
    { x: 0, y: 999 },
    { x: 999, y: 999 },
  ]) {
    const result = terrainEdges(singleCell(center), (tile) => {
      assert.ok(inWorld(tile));
      return "grass";
    });
    assert.equal(
      result.world.length,
      neighbors(center).filter((tile) => !inWorld(tile)).length,
    );
    assert.equal(result.shore.length, 0);
    assert.equal(new Set(result.world.map(edgeKey)).size, result.world.length);
  }
  const corner = { x: 0, y: 0 };
  const vertices = hexVertices(corner);
  const expected = [0, 3, 4, 5]
    .map((side) => edgeKey([vertices[side], vertices[(side + 1) % 6]]))
    .sort();
  assert.deepEqual(
    terrainEdges(singleCell(corner), () => "grass")
      .world.map(edgeKey)
      .sort(),
    expected,
  );
});

test("terrain work is bounded, fractional bounds clip to centers, and invalid input is rejected", () => {
  let reads = 0;
  const lookup = (tile: Tile): Terrain => {
    assert.ok(inWorld(tile));
    reads++;
    return "grass";
  };
  const bounds = { minX: -100, maxX: 1100, minY: -100, maxY: 1100 };
  const limited = terrainEdges(bounds, lookup, { maxCells: 7 });
  assert.equal(limited.visitedCells, 7);
  assert.equal(limited.truncated, true);
  assert.ok(reads <= 7 * limited.visitedCells);
  reads = 0;
  const empty = terrainEdges(bounds, lookup, { maxCells: 0 });
  assert.equal(empty.visitedCells, 0);
  assert.equal(empty.truncated, true);
  assert.equal(reads, 0);

  const fractional = terrainEdges(
    { minX: 99.1, maxX: 100.9, minY: 99.1, maxY: 100.9 },
    lookup,
  );
  assert.equal(fractional.visitedCells, 1);
  assert.equal(fractional.truncated, false);
  assert.equal(
    terrainEdges({ minX: 1000, maxX: 1100, minY: 0, maxY: 10 }, lookup)
      .visitedCells,
    0,
  );
  assert.equal(
    terrainEdges(bounds, lookup, { maxCells: 1_000_000 }).visitedCells,
    25_000,
  );
  for (const maxCells of [-1, 1.5, Infinity, NaN]) {
    assert.throws(() => terrainEdges(bounds, lookup, { maxCells }), RangeError);
  }
  assert.throws(
    () => terrainEdges({ ...bounds, minX: NaN }, lookup),
    RangeError,
  );
});

test("wide viewport outlines remain complete and unique across row-strip junctions", () => {
  // 25,125 cells require two strips. Mud/grass meet exactly at their junction.
  const bounds = { minX: 400, maxX: 600, minY: 400, maxY: 524 };
  const lookup = ({ x, y }: Tile): Terrain => {
    if (x >= 550 && x <= 560) return "restricted";
    if (x >= 580) return "unknown";
    return y <= 523 ? "mud" : "grass";
  };
  const result = viewportTerrainEdges(bounds, lookup);
  assert.equal(result.visitedCells, 25_125);
  assert.equal(result.truncated, false);
  assert.equal(
    terrainEdges(bounds, lookup, { maxCells: 25_000 }).truncated,
    true,
  );

  // Independent exhaustive edge set: inspect every side from both cells, with
  // no strip ownership logic, then compare the geometric undirected segments.
  const expected = {
    shore: new Set<string>(),
    restricted: new Set<string>(),
    unknown: new Set<string>(),
    world: new Set<string>(),
  };
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const tile = { x, y },
        current = lookup(tile),
        vertices = hexVertices(tile);
      for (let side = 0; side < 6; side++) {
        const neighbor = offset(tile, AXIAL_DIRECTIONS[(side + 5) % 6]);
        const adjacent = lookup(neighbor);
        if (current === adjacent) continue;
        const kind =
          current === "restricted" || adjacent === "restricted"
            ? "restricted"
            : current === "unknown" || adjacent === "unknown"
              ? "unknown"
              : "shore";
        expected[kind].add(edgeKey([vertices[side], vertices[(side + 1) % 6]]));
      }
    }
  }
  for (const kind of ["shore", "restricted", "unknown", "world"] as const) {
    const actual = result[kind].map(edgeKey);
    assert.equal(
      new Set(actual).size,
      actual.length,
      `${kind} is deduplicated`,
    );
    assert.deepEqual(actual.sort(), [...expected[kind]].sort(), kind);
  }
  assert.ok(result.shore.length > 300, "the entire strip seam remains visible");
});

test("viewport edge strips normalize bounds before work and preserve the single-strip result", () => {
  let reads = 0;
  const lookup = (tile: Tile): Terrain => {
    assert.ok(inWorld(tile));
    reads++;
    return "grass";
  };
  const bounds = {
    minX: -Number.MAX_VALUE,
    maxX: Number.MAX_VALUE,
    minY: -Number.MAX_VALUE,
    maxY: 0.9,
  };
  const result = viewportTerrainEdges(bounds, lookup);
  assert.equal(result.visitedCells, 1000);
  assert.equal(result.truncated, false);
  assert.ok(reads <= 2000);
  assert.deepEqual(result, terrainEdges(bounds, lookup));
  reads = 0;
  const empty = viewportTerrainEdges(
    { minX: 1000, maxX: Number.MAX_VALUE, minY: 0, maxY: 999 },
    lookup,
  );
  assert.equal(empty.visitedCells, 0);
  assert.equal(empty.truncated, false);
  assert.equal(reads, 0);
  assert.throws(
    () => viewportTerrainEdges({ ...bounds, maxY: Infinity }, lookup),
    RangeError,
  );
});
