export type Tile = { x: number; y: number };
export type Pixel = { x: number; y: number };
export type Axial = { q: number; r: number };

export const WORLD_SIZE = 1000;
export const TILE_RADIUS = 16;
const SQRT3 = Math.sqrt(3);

/** Last Z uses zero-based, odd-row offset coordinates. Y increases southward. */
export function toAxial(tile: Tile): Axial {
  return { q: tile.x - (tile.y - (tile.y & 1)) / 2, r: tile.y };
}

export function fromAxial(axial: Axial): Tile {
  return { x: axial.q + (axial.r - (axial.r & 1)) / 2, y: axial.r };
}

export function key(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

export function inWorld(tile: Tile): boolean {
  return (
    Number.isInteger(tile.x) &&
    Number.isInteger(tile.y) &&
    tile.x >= 0 &&
    tile.x < WORLD_SIZE &&
    tile.y >= 0 &&
    tile.y < WORLD_SIZE
  );
}

export function pointId(tile: Tile): number {
  if (!inWorld(tile))
    throw new RangeError("Coordinate must be an integer inside the world.");
  return 1 + tile.x + WORLD_SIZE * tile.y;
}

export function fromPointId(id: number): Tile {
  if (!Number.isInteger(id) || id < 1 || id > WORLD_SIZE * WORLD_SIZE) {
    throw new RangeError("Point id must be between 1 and 1,000,000.");
  }
  return { x: (id - 1) % WORLD_SIZE, y: Math.floor((id - 1) / WORLD_SIZE) };
}

export function distance(a: Tile, b: Tile): number {
  const aa = toAxial(a),
    bb = toAxial(b);
  return Math.max(
    Math.abs(aa.q - bb.q),
    Math.abs(aa.r - bb.r),
    Math.abs(aa.q + aa.r - bb.q - bb.r),
  );
}

export const AXIAL_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export function offset(tile: Tile, delta: Axial): Tile {
  const a = toAxial(tile);
  return fromAxial({ q: a.q + delta.q, r: a.r + delta.r });
}

export function neighbors(tile: Tile): Tile[] {
  return AXIAL_DIRECTIONS.map((delta) => offset(tile, delta));
}

/** Includes out-of-world cells so placement validation can reject partial footprints. */
export function footprint(center: Tile, radius = 1): Tile[] {
  if (!Number.isInteger(radius) || radius < 0 || radius > 1000) {
    throw new RangeError(
      "Footprint radius must be a nonnegative integer no greater than 1000.",
    );
  }
  const cells: Tile[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (
      let dr = Math.max(-radius, -dq - radius);
      dr <= Math.min(radius, -dq + radius);
      dr++
    ) {
      cells.push(offset(center, { q: dq, r: dr }));
    }
  }
  return cells;
}

/** Orthographic planner projection of the game's Hex.lua ground coordinates, with south down. */
export function worldToPixel(tile: Tile, radius = TILE_RADIUS): Pixel {
  return {
    x: radius * SQRT3 * (tile.x + 0.5 * (tile.y & 1) + 0.5),
    y: radius * (1.5 * tile.y + 1),
  };
}

function roundAxial(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q),
    rr = Math.round(r),
    rs = Math.round(s);
  const dq = Math.abs(rq - q),
    dr = Math.abs(rr - r),
    ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return { q: rq, r: rr };
}

/** Nearest hex center; intentionally not clamped to allow rejecting off-map pointer positions. */
export function pixelToWorld(pixel: Pixel, radius = TILE_RADIUS): Tile {
  const r = (pixel.y / radius - 1) / 1.5;
  const q = pixel.x / (radius * SQRT3) - 0.5 - r / 2;
  return fromAxial(roundAxial(q, r));
}

export function hexVertices(tile: Tile, radius = TILE_RADIUS): Pixel[] {
  const center = worldToPixel(tile, radius);
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 90);
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

/** Edge-inclusive polygon containment in pixel/Cartesian space. Convert offset tiles first. */
export function pointInPolygon(
  point: Pixel,
  polygon: readonly Pixel[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
    if (
      Math.abs(cross) < 1e-7 &&
      point.x >= Math.min(a.x, b.x) - 1e-7 &&
      point.x <= Math.max(a.x, b.x) + 1e-7 &&
      point.y >= Math.min(a.y, b.y) - 1e-7 &&
      point.y <= Math.max(a.y, b.y) + 1e-7
    )
      return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

export function tileInBoundary(tile: Tile, boundary: readonly Tile[]): boolean {
  return pointInPolygon(
    worldToPixel(tile),
    boundary.map((cell) => worldToPixel(cell)),
  );
}

/** Full polygon containment, including edges that pass through concave notches. */
export function polygonContainsPolygon(
  outer: readonly Pixel[],
  inner: readonly Pixel[],
): boolean {
  if (
    outer.length < 3 ||
    inner.length < 3 ||
    inner.some((point) => !pointInPolygon(point, outer))
  )
    return false;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i],
      b = inner[(i + 1) % inner.length];
    const rx = b.x - a.x,
      ry = b.y - a.y;
    const stops = [0, 1];
    for (let j = 0; j < outer.length; j++) {
      const c = outer[j],
        d = outer[(j + 1) % outer.length];
      const sx = d.x - c.x,
        sy = d.y - c.y;
      const denominator = rx * sy - ry * sx;
      if (Math.abs(denominator) < 1e-10) continue;
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
      const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) stops.push(t);
    }
    stops.sort((left, right) => left - right);
    for (let j = 1; j < stops.length; j++) {
      const t = (stops[j - 1] + stops[j]) / 2;
      if (!pointInPolygon({ x: a.x + t * rx, y: a.y + t * ry }, outer))
        return false;
    }
  }
  return true;
}

/** A center inside the wedge is insufficient: every tile polygon must be fully inside. */
export function footprintInBoundary(
  center: Tile,
  boundary: readonly Tile[],
  radius = 1,
): boolean {
  const polygon = boundary.map((tile) => worldToPixel(tile));
  return footprint(center, radius).every((tile) =>
    polygonContainsPolygon(polygon, hexVertices(tile)),
  );
}

/** Geometric distance only; does not infer marching speed, routes, or terrain movement costs. */
export function routeDistance(points: readonly Tile[]): number {
  return points
    .slice(1)
    .reduce((total, tile, i) => total + distance(points[i], tile), 0);
}
