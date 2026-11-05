import { createMemo, createUniqueId, For, Show } from "solid-js";
import { FlipVertical2, RotateCcw, RotateCw } from "lucide-solid";
import {
  footprint,
  hexVertices,
  worldToPixel,
  type Tile,
} from "../domain/geometry";
import "./formation-orientation.css";

export type FormationOrientationProps = {
  /** Absolute HQ centers, with the current orientation already applied. */
  tiles: Tile[];
  /** The fixed rotation anchor, in absolute world coordinates. */
  anchor: Tile;
  /** Clockwise sixty-degree steps (0–5), not degrees. */
  rotation: number;
  mirrored: boolean;
  /** Request one sixty-degree step: −1 counterclockwise, +1 clockwise. */
  onRotate: (delta: number) => void;
  onFlip: () => void;
  onReset: () => void;
  scope: "preset" | "cluster";
  symmetric?: boolean;
};

const RADIUS = 10;
const GRID_WIDTH = Math.sqrt(3) * RADIUS;

/** A controlled preview: placement changes and validation belong to the caller. */
export default function FormationOrientation(props: FormationOrientationProps) {
  const id = createUniqueId();
  const degrees = () => (((props.rotation % 6) + 6) % 6) * 60;
  const subject = () =>
    props.scope === "cluster" ? "placed cluster" : "preset";
  const preview = createMemo(() => {
    const origin = worldToPixel(props.anchor, RADIUS);
    const buildings = props.tiles.map((center) => ({
      anchored: center.x === props.anchor.x && center.y === props.anchor.y,
      cells: footprint(center).map((tile) =>
        hexVertices(tile, RADIUS).map((point) => ({
          x: point.x - origin.x,
          y: point.y - origin.y,
        })),
      ),
    }));
    // Including the anchor keeps the pivot visible for offset or edited clusters.
    let left = -RADIUS * 3;
    let right = RADIUS * 3;
    let top = -RADIUS * 3;
    let bottom = RADIUS * 3;
    for (const building of buildings) {
      for (const cell of building.cells) {
        for (const point of cell) {
          left = Math.min(left, point.x - RADIUS);
          right = Math.max(right, point.x + RADIUS);
          top = Math.min(top, point.y - RADIUS);
          bottom = Math.max(bottom, point.y + RADIUS);
        }
      }
    }
    return {
      buildings,
      origin,
      left,
      top,
      width: right - left,
      height: bottom - top,
      viewBox: `${left} ${top} ${right - left} ${bottom - top}`,
    };
  });

  return (
    <fieldset class="formation-orientation" aria-describedby={`${id}-help`}>
      <legend>
        {props.scope === "cluster"
          ? "Cluster orientation"
          : "Preset orientation"}
      </legend>
      <div class="formation-orientation-heading">
        <span>Illustrative grid preview</span>
        <output
          class="formation-orientation-badge"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>{degrees()}°</span>
          <Show when={props.mirrored}>
            <span> · Flipped</span>
          </Show>
        </output>
      </div>
      <div class="formation-orientation-preview">
        <svg
          viewBox={preview().viewBox}
          role="img"
          aria-labelledby={`${id}-title ${id}-description`}
          preserveAspectRatio="xMidYMid meet"
        >
          <title id={`${id}-title`}>
            {props.scope === "cluster" ? "Placed cluster" : "Preset"} footprint
            preview
          </title>
          <desc id={`${id}-description`}>
            {props.tiles.length} HQs with seven hexagonal tiles each.
            Orientation {degrees()} degrees{props.mirrored ? ", flipped" : ""}.
            The bright dot marks the fixed anchor at X {props.anchor.x}, Y{" "}
            {props.anchor.y}. Terrain is not shown.
          </desc>
          <defs>
            <pattern
              id={`${id}-grid`}
              width={GRID_WIDTH}
              height={RADIUS * 3}
              x={-preview().origin.x}
              y={-preview().origin.y}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M${GRID_WIDTH / 2},0 L${GRID_WIDTH},5 V15 L${GRID_WIDTH / 2},20 L0,15 V5 Z M${GRID_WIDTH / 2},20 V30`}
                class="formation-orientation-grid"
                vector-effect="non-scaling-stroke"
              />
            </pattern>
          </defs>
          <rect
            x={preview().left}
            y={preview().top}
            width={preview().width}
            height={preview().height}
            fill={`url(#${id}-grid)`}
          />
          <For each={preview().buildings}>
            {(building) => (
              <g
                classList={{
                  "formation-orientation-hq": true,
                  "is-anchor": building.anchored,
                }}
              >
                <For each={building.cells}>
                  {(points) => (
                    <polygon
                      points={points
                        .map((point) => `${point.x},${point.y}`)
                        .join(" ")}
                      vector-effect="non-scaling-stroke"
                    />
                  )}
                </For>
              </g>
            )}
          </For>
          <circle
            cx="0"
            cy="0"
            r="3.5"
            class="formation-orientation-anchor"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <span class="formation-orientation-north" aria-hidden="true">
          ↑ N
        </span>
      </div>
      <div class="formation-orientation-controls">
        <button
          type="button"
          aria-label={`Rotate ${subject()} counterclockwise 60 degrees`}
          title="Rotate counterclockwise 60°"
          onClick={() => props.onRotate(-1)}
        >
          <RotateCcw size={16} aria-hidden="true" />
          <span>−60°</span>
        </button>
        <button
          type="button"
          aria-label={`Rotate ${subject()} clockwise 60 degrees`}
          title="Rotate clockwise 60°"
          onClick={() => props.onRotate(1)}
        >
          <RotateCw size={16} aria-hidden="true" />
          <span>+60°</span>
        </button>
        <button
          type="button"
          class="formation-orientation-flip"
          aria-label={`Flip ${subject()} stagger`}
          aria-pressed={props.mirrored}
          title="Mirror the stagger direction"
          onClick={() => props.onFlip()}
        >
          <FlipVertical2 size={16} aria-hidden="true" />
          <span>Flip stagger</span>
        </button>
        <button
          type="button"
          aria-label={`Reset ${subject()} orientation`}
          title="Reset to 0° with no flip"
          disabled={degrees() === 0 && !props.mirrored}
          onClick={() => props.onReset()}
        >
          Reset
        </button>
      </div>
      <p id={`${id}-help`} class="formation-orientation-help">
        {props.symmetric
          ? "A full Daisy repeats every 60°. Staggered Daisies can be flipped to change their slant."
          : props.scope === "cluster"
            ? "Turns the whole cluster around the bright anchor. Terrain and spacing are checked before it moves."
            : "Choose the direction before placing. The bright dot marks the anchor."}
      </p>
    </fieldset>
  );
}
