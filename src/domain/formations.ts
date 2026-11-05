import { AXIAL_DIRECTIONS, offset, type Axial, type Tile } from "./geometry";
import { SPACING_PITCH } from "./placement";
import type { Spacing } from "./schema";
import { STRATEGY_BASIS } from "./strategy-schema";
import { orientVector } from "./orientation";

export type FormationKind = "daisy" | "grass" | "mud";
export type StaggerKind = "grass-wide" | "mud-tight";
export type PlacementStrategy = "regular" | StaggerKind;
export type FormationOptions = {
  rows?: number;
  columns?: number;
  rotation?: number;
  mirrored?: boolean;
  strategy?: PlacementStrategy;
};

function dimension(value: number | undefined, fallback: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(20, Math.trunc(value!)))
    : fallback;
}

export function strategyBasis(
  kind: StaggerKind,
  rotation = 0,
  mirrored = false,
): [Axial, Axial] {
  const [a, b] = STRATEGY_BASIS[kind];
  return [
    orientVector(a, rotation, mirrored),
    orientVector(b, rotation, mirrored),
  ];
}

/** Exact integer lattices from the supplied GrassWideStagger / MudTightStagger references. */
export function generateStagger(
  kind: StaggerKind,
  origin: Tile,
  options: Omit<FormationOptions, "strategy"> = {},
): Tile[] {
  const [a, b] = strategyBasis(kind, options.rotation, options.mirrored);
  const rows = dimension(options.rows, 3),
    columns = dimension(options.columns, 4);
  const cells: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      cells.push(
        offset(origin, {
          q: column * a.q + row * b.q,
          r: column * a.r + row * b.r,
        }),
      );
    }
  }
  return cells;
}

/** Center plus the six nearest lattice neighbors, matching each reference's seven-base cluster. */
export function generateStaggerDaisy(
  kind: StaggerKind,
  origin: Tile,
  options: Pick<FormationOptions, "rotation" | "mirrored"> = {},
): Tile[] {
  const [a] = STRATEGY_BASIS[kind];
  return [
    origin,
    ...Array.from({ length: 6 }, (_, turn) =>
      offset(
        origin,
        orientVector(orientVector(a, turn), options.rotation, options.mirrored),
      ),
    ),
  ];
}

/** Geometry templates only. Actual deployment still requires per-footprint terrain/spacing checks. */
export function generateFormation(
  kind: FormationKind,
  origin: Tile,
  spacing: Spacing,
  options: FormationOptions = {},
): Tile[] {
  if (options.strategy && options.strategy !== "regular") {
    return kind === "daisy"
      ? generateStaggerDaisy(options.strategy, origin, options)
      : generateStagger(options.strategy, origin, options);
  }
  const pitch = SPACING_PITCH[spacing];
  const rotation = options.rotation ?? 0;
  if (kind === "daisy") {
    return [
      origin,
      ...AXIAL_DIRECTIONS.map(({ q, r }) =>
        offset(
          origin,
          orientVector(
            { q: q * pitch, r: r * pitch },
            rotation,
            options.mirrored,
          ),
        ),
      ),
    ];
  }
  const rows = dimension(options.rows, 3);
  const columns = dimension(options.columns, 4);
  const cells: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      // Offset each mud course, retaining the requested minimum center distance.
      const q = column * pitch - Math.floor(row / 2) * pitch;
      const r = row * pitch;
      const delta =
        kind === "mud" ? { q, r } : { q: column * pitch, r: row * pitch };
      cells.push(
        offset(origin, orientVector(delta, rotation, options.mirrored)),
      );
    }
  }
  return cells;
}
