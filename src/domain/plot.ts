import { WORLD_SIZE, type Axial, type Tile } from "./geometry";

export type PlotLattice = { anchor: Tile; basis: [Axial, Axial] };
export type PlotSite = { tile: Tile; i: number; j: number };
export type PlotBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
export const MAX_VISIBLE_PLOT_SITES = 5000;

type ExactAxial = { q: bigint; r: bigint };
type PreparedLattice = {
  anchor: ExactAxial;
  a: ExactAxial;
  b: ExactAxial;
  determinant: bigint;
  rowGcd: bigint;
  rowI: bigint;
  rowJ: bigint;
  stride: bigint;
};

function integer(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${label} must be a safe integer.`);
  return BigInt(value);
}

function axial(tile: Tile): ExactAxial {
  const x = integer(tile.x, "X coordinate"),
    y = integer(tile.y, "Y coordinate");
  return { q: x - (y - (y & 1n)) / 2n, r: y };
}

/** Return g,u,v such that a*u+b*v=g>=0. */
function bezout(a: bigint, b: bigint): [bigint, bigint, bigint] {
  let r = a < 0n ? -a : a,
    nextR = b < 0n ? -b : b;
  let u = 1n,
    nextU = 0n,
    v = 0n,
    nextV = 1n;
  while (nextR !== 0n) {
    const quotient = r / nextR;
    [r, nextR] = [nextR, r - quotient * nextR];
    [u, nextU] = [nextU, u - quotient * nextU];
    [v, nextV] = [nextV, v - quotient * nextV];
  }
  return [r, a < 0n ? -u : u, b < 0n ? -v : v];
}

function prepare(lattice: PlotLattice): PreparedLattice {
  const a = {
    q: integer(lattice.basis[0].q, "Basis Q"),
    r: integer(lattice.basis[0].r, "Basis R"),
  };
  const b = {
    q: integer(lattice.basis[1].q, "Basis Q"),
    r: integer(lattice.basis[1].r, "Basis R"),
  };
  const determinant = a.q * b.r - a.r * b.q;
  if (determinant === 0n)
    throw new RangeError("Plot basis vectors must be linearly independent.");
  const [rowGcd, rowI, rowJ] = bezout(a.r, b.r);
  const signedStride = determinant / rowGcd;
  return {
    anchor: axial(lattice.anchor),
    a,
    b,
    determinant,
    rowGcd,
    rowI,
    rowJ,
    stride: signedStride < 0n ? -signedStride : signedStride,
  };
}

function numerators(tile: Tile, lattice: PreparedLattice): [bigint, bigint] {
  const point = axial(tile),
    q = point.q - lattice.anchor.q,
    r = point.r - lattice.anchor.r;
  return [q * lattice.b.r - r * lattice.b.q, lattice.a.q * r - lattice.a.r * q];
}

/** Membership uses exact integer determinant numerators; nonmember coefficients are fractional. */
export function plotCoordinates(
  tile: Tile,
  lattice: PlotLattice,
): { i: number; j: number; onPlot: boolean } {
  const prepared = prepare(lattice),
    [i, j] = numerators(tile, prepared),
    d = prepared.determinant;
  return {
    i: Number(i) / Number(d) || 0,
    j: Number(j) / Number(d) || 0,
    onPlot: i % d === 0n && j % d === 0n,
  };
}

function exactSite(tile: Tile, lattice: PreparedLattice): PlotSite {
  const [ni, nj] = numerators(tile, lattice);
  const i = Number(ni / lattice.determinant),
    j = Number(nj / lattice.determinant);
  if (!Number.isSafeInteger(i) || !Number.isSafeInteger(j))
    throw new RangeError("Plot coefficients exceed the safe integer range.");
  return { tile, i: i || 0, j: j || 0 };
}

/** All plot nodes in a world row form one exact arithmetic progression of offset X values. */
function rowProgression(
  y: number,
  minX: number,
  maxX: number,
  lattice: PreparedLattice,
): { first: bigint; count: bigint } | null {
  const row = BigInt(y),
    delta = row - lattice.anchor.r;
  if (delta % lattice.rowGcd !== 0n) return null;
  const multiplier = delta / lattice.rowGcd;
  const i = lattice.rowI * multiplier,
    j = lattice.rowJ * multiplier;
  const rawX =
    lattice.anchor.q +
    lattice.a.q * i +
    lattice.b.q * j +
    (row - (row & 1n)) / 2n;
  const stride = lattice.stride;
  let first = ((rawX % stride) + stride) % stride;
  const lower = BigInt(minX),
    upper = BigInt(maxX);
  if (first < lower) first += ((lower - first + stride - 1n) / stride) * stride;
  if (first > upper) return null;
  return { first, count: (upper - first) / stride + 1n };
}

function floorDivide(value: bigint, positiveDivisor: bigint): bigint {
  const quotient = value / positiveDivisor;
  return value < 0n && value % positiveDivisor !== 0n
    ? quotient - 1n
    : quotient;
}

/**
 * Exact nearest world node by squared orthographic pixel distance. At most 1,000 row
 * equations and two nearest-X candidates per row, including arbitrarily skewed bases.
 * Ties choose lowest world Y, then lowest X. Neither the lattice nor the query is mutated.
 */
export function nearestPlotTile(
  tile: Tile,
  lattice: PlotLattice,
): PlotSite | null {
  const prepared = prepare(lattice),
    targetX = integer(tile.x, "X coordinate"),
    targetY = integer(tile.y, "Y coordinate");
  let best: Tile | null = null,
    bestCost: bigint | null = null;
  for (let y = 0; y < WORLD_SIZE; y++) {
    const row = rowProgression(y, 0, WORLD_SIZE - 1, prepared);
    if (!row) continue;
    const exactY = BigInt(y);
    const idealNumerator =
      2n * targetX + (targetY & 1n) - (exactY & 1n) - 2n * row.first;
    const left = floorDivide(idealNumerator, 2n * prepared.stride);
    const clamp = (index: bigint) =>
      index < 0n ? 0n : index >= row.count ? row.count - 1n : index;
    const first = clamp(left),
      second = clamp(left + 1n);
    for (const index of first === second ? [first] : [first, second]) {
      const exactX = row.first + index * prepared.stride;
      // Four times squared pixel distance / tileWidth²; entirely integral, including parity.
      const dx2 = 2n * (exactX - targetX) + (exactY & 1n) - (targetY & 1n),
        dy = exactY - targetY;
      const cost = dx2 * dx2 + 3n * dy * dy;
      const x = Number(exactX);
      if (
        bestCost === null ||
        cost < bestCost ||
        (cost === bestCost && (y < best!.y || (y === best!.y && x < best!.x)))
      ) {
        best = { x, y };
        bestCost = cost;
      }
    }
  }
  return best ? exactSite(best, prepared) : null;
}

/**
 * Enumerate row-major plot nodes in clipped offset-coordinate bounds. Work is bounded by
 * 1,000 row equations plus min(limit,5,000)+1 emitted candidates, independent of zoom/skew.
 */
export function visiblePlotSites(
  lattice: PlotLattice,
  bounds: PlotBounds,
  limit = 400,
): { sites: PlotSite[]; truncated: boolean } {
  if (!Object.values(bounds).every(Number.isFinite))
    throw new RangeError("Plot bounds must be finite.");
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new RangeError("Plot site limit must be a nonnegative safe integer.");
  const cap = Math.min(limit, MAX_VISIBLE_PLOT_SITES),
    prepared = prepare(lattice);
  const minX = Math.max(0, Math.ceil(bounds.minX)),
    maxX = Math.min(WORLD_SIZE - 1, Math.floor(bounds.maxX));
  const minY = Math.max(0, Math.ceil(bounds.minY)),
    maxY = Math.min(WORLD_SIZE - 1, Math.floor(bounds.maxY));
  const sites: PlotSite[] = [];
  if (minX > maxX || minY > maxY) return { sites, truncated: false };
  for (let y = minY; y <= maxY; y++) {
    const row = rowProgression(y, minX, maxX, prepared);
    if (!row) continue;
    for (let index = 0n; index < row.count; index++) {
      if (sites.length === cap) return { sites, truncated: true };
      sites.push(
        exactSite(
          { x: Number(row.first + index * prepared.stride), y },
          prepared,
        ),
      );
    }
  }
  return { sites, truncated: false };
}
