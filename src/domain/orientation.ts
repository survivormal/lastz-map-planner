import type { Axial } from "./geometry";

/** Exact hex-grid isometry: reflect across the local horizontal axis, then rotate clockwise. */
export function orientVector(
  vector: Axial,
  rotation = 0,
  mirrored = false,
): Axial {
  if (!Number.isInteger(rotation))
    throw new RangeError("Rotation must be a whole number of 60-degree turns.");
  let { q, r } = vector;
  if (mirrored) [q, r] = [q + r, -r];
  const turns = ((rotation % 6) + 6) % 6;
  for (let turn = 0; turn < turns; turn++) [q, r] = [-r, q + r];
  return { q: q || 0, r: r || 0 };
}
