import { createUniqueId, For, Show } from "solid-js";
import {
  AlertTriangle,
  Crosshair,
  FlipVertical2,
  Layers,
  MapPin,
  RotateCcw,
  RotateCw,
  Shield,
} from "lucide-solid";
import type { Plan } from "../domain/schema";
import type { SmartFillResult, Strategy } from "../domain/strategies";
import "./boundary-fill.css";

export type BoundaryFillPanelProps = {
  strategies: readonly Strategy[];
  strategyId: string;
  groupOptions: Plan["groups"];
  groupId: string;
  rotation: number;
  mirrored: boolean;
  anchorX: string;
  anchorY: string;
  hasPlotAnchor: boolean;
  pickingAnchor: boolean;
  result: SmartFillResult | null;
  safety: {
    status: "checking" | "ready" | "error";
    proposedTwoFit: number;
    existingTwoFit: number;
    uncertain: number;
    invalid: number;
  } | null;
  onStrategy: (id: string) => void;
  onGroup: (id: string) => void;
  onRotate: (delta: number) => void;
  onFlip: () => void;
  onReset: () => void;
  onAnchorX: (value: string) => void;
  onAnchorY: (value: string) => void;
  onCenter: () => void;
  onUsePlot: () => void;
  onPickAnchor: () => void;
  onPreview: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onReviewWarnings: () => void;
};

export default function BoundaryFillPanel(props: BoundaryFillPanelProps) {
  const id = createUniqueId();
  const degrees = () => (((props.rotation % 6) + 6) % 6) * 60;
  const strategy = () =>
    props.strategies.find((value) => value.id === props.strategyId);
  const ready = () => props.safety?.status === "ready";

  return (
    <section class="boundary-fill" aria-label="Boundary auto-fill">
      <div class="section-label">
        BOUNDARY AUTO-FILL <Layers size={14} aria-hidden="true" />
      </div>
      <p class="field-help">
        Fill this closed area with individual HQs. Every seven-tile footprint
        stays inside the boundary; existing placements stay put.
      </p>
      <label class="field">
        <span>Fill strategy</span>
        <select
          value={props.strategyId}
          onChange={(event) => props.onStrategy(event.currentTarget.value)}
        >
          <For each={props.strategies}>
            {(option) => (
              <option
                value={option.id}
                selected={props.strategyId === option.id}
              >
                {option.name}
              </option>
            )}
          </For>
        </select>
      </label>
      <p class="field-help boundary-fill-rule">
        {strategy()?.minGap ?? 0} empty tiles between HQ footprints ·{" "}
        {strategy()?.terrain === "any"
          ? "Grass or mud"
          : strategy()?.terrain === "mud"
            ? "Entire HQ on mud"
            : "Entire HQ on grass"}
      </p>
      <label class="field">
        <span>Assign to group</span>
        <select
          value={props.groupId}
          onChange={(event) => props.onGroup(event.currentTarget.value)}
        >
          <For each={props.groupOptions}>
            {(option) => (
              <option value={option.id} selected={props.groupId === option.id}>
                {option.name}
              </option>
            )}
          </For>
        </select>
      </label>

      <fieldset class="boundary-fill-orientation">
        <legend>Pattern orientation</legend>
        <output class="boundary-fill-angle" aria-live="polite">
          {degrees()}°{props.mirrored ? " · Flipped" : ""}
        </output>
        <div class="boundary-fill-turns">
          <button
            type="button"
            aria-label="Rotate fill counterclockwise 60 degrees"
            onClick={() => props.onRotate(-1)}
          >
            <RotateCcw size={15} aria-hidden="true" /> −60°
          </button>
          <button
            type="button"
            aria-label="Rotate fill clockwise 60 degrees"
            onClick={() => props.onRotate(1)}
          >
            <RotateCw size={15} aria-hidden="true" /> +60°
          </button>
          <button
            type="button"
            aria-pressed={props.mirrored}
            onClick={props.onFlip}
          >
            <FlipVertical2 size={15} aria-hidden="true" /> Flip stagger
          </button>
          <button
            type="button"
            disabled={degrees() === 0 && !props.mirrored}
            onClick={props.onReset}
          >
            Reset
          </button>
        </div>
        <p class="field-help">
          A regular stagger repeats every 60°. Flip changes its slant.
        </p>
      </fieldset>

      <fieldset class="boundary-fill-anchor" aria-describedby={`${id}-anchor`}>
        <legend>Pattern anchor</legend>
        <div class="coordinate-fields">
          <label>
            X
            <input
              aria-label="Fill anchor X"
              inputmode="numeric"
              value={props.anchorX}
              onInput={(event) => props.onAnchorX(event.currentTarget.value)}
            />
          </label>
          <label>
            Y
            <input
              aria-label="Fill anchor Y"
              inputmode="numeric"
              value={props.anchorY}
              onInput={(event) => props.onAnchorY(event.currentTarget.value)}
            />
          </label>
        </div>
        <div class="boundary-fill-anchor-actions">
          <button class="button subtle" type="button" onClick={props.onCenter}>
            Center in boundary
          </button>
          <button
            class="button subtle"
            type="button"
            onClick={props.onUsePlot}
            disabled={!props.hasPlotAnchor}
            title={
              props.hasPlotAnchor
                ? "Continue the spacing from your current plot anchor"
                : "Set a single-HQ plot anchor first"
            }
          >
            Use plot anchor
          </button>
        </div>
        <button
          class="button subtle full boundary-fill-pick"
          type="button"
          aria-pressed={props.pickingAnchor}
          onClick={props.onPickAnchor}
        >
          <MapPin size={15} aria-hidden="true" />
          {props.pickingAnchor ? "Cancel picking anchor" : "Pick anchor on map"}
        </button>
        <p id={`${id}-anchor`} class="field-help">
          {props.pickingAnchor
            ? "Click a tile to align the pattern. This does not place an HQ."
            : "The anchor aligns the repeating pattern; it can sit outside the area. Use your plot anchor to continue an existing stagger."}
        </p>
      </fieldset>

      <button
        class="button subtle full"
        type="button"
        onClick={props.onPreview}
        disabled={props.pickingAnchor}
      >
        <Layers size={15} aria-hidden="true" />
        {props.result ? "Rebuild fill preview" : "Preview auto-fill"}
      </button>

      <Show when={props.result}>
        {(result) => (
          <div class="boundary-fill-result" aria-live="polite">
            <div class="boundary-fill-result-heading">
              <strong>{result().accepted}</strong>
              <span>HQ positions fit</span>
              <small>PREVIEW ONLY</small>
            </div>
            <p class="field-help">
              Skipped: {result().rejected.boundary} outside boundary ·{" "}
              {result().rejected.terrain} terrain ·{" "}
              {result().rejected.collision + result().rejected.spacing}{" "}
              collision / spacing.
            </p>
            <Show when={!result().accepted}>
              <p class="field-help">
                Try another anchor or strategy, or enlarge the boundary. The
                full HQ footprint must fit on permitted terrain.
              </p>
            </Show>
            <Show when={result().provisional}>
              <p class="boundary-fill-notice">
                {result().provisional} proposed positions use provisional
                terrain.
              </p>
            </Show>
            <Show when={result().truncated}>
              <p class="boundary-fill-notice">
                Partial preview. Limited to 250 HQs / 4,000 candidates, with
                lower limits for complex boundaries or a nearly full plan. Fill
                smaller areas to check the rest.
              </p>
            </Show>

            <Show when={props.safety}>
              {(safety) => (
                <div
                  class="boundary-fill-safety"
                  classList={{
                    "has-risk": ready() && safety().proposedTwoFit > 0,
                    "is-uncertain":
                      ready() &&
                      (safety().uncertain > 0 || safety().invalid > 0),
                  }}
                >
                  <div class="boundary-fill-safety-heading">
                    <Shield size={15} aria-hidden="true" />
                    <strong>HQ loss check</strong>
                  </div>
                  <Show when={safety().status === "checking"}>
                    <p>Checking the complete proposed layout…</p>
                  </Show>
                  <Show when={safety().status === "error"}>
                    <p>
                      The loss check could not finish. Rebuild the preview to
                      retry before applying.
                    </p>
                  </Show>
                  <Show when={ready()}>
                    <Show
                      when={!safety().invalid}
                      fallback={
                        <p>
                          {safety().invalid} existing{" "}
                          {safety().invalid === 1
                            ? "position needs"
                            : "positions need"}{" "}
                          review. Fix them before relying on these loss checks;
                          invalid blockers cannot provide protection.
                        </p>
                      }
                    >
                      <Show
                        when={safety().proposedTwoFit > 0}
                        fallback={
                          <Show when={!safety().uncertain}>
                            <p>
                              No two-HQ losses found among the proposed HQs.
                            </p>
                          </Show>
                        }
                      >
                        <p>
                          <b>
                            {safety().proposedTwoFit} proposed{" "}
                            {safety().proposedTwoFit === 1 ? "HQ" : "HQs"}
                          </b>{" "}
                          {safety().uncertain ? "could" : "can"} each open room
                          for two enemies if lost.
                        </p>
                      </Show>
                      <Show when={safety().existingTwoFit > 0}>
                        <p>
                          {safety().existingTwoFit} existing{" "}
                          {safety().existingTwoFit === 1
                            ? "HQ also has"
                            : "HQs also have"}{" "}
                          loss warnings in this layout.
                        </p>
                      </Show>
                      <Show when={safety().proposedTwoFit > 0}>
                        <button
                          class="button subtle full"
                          type="button"
                          onClick={props.onReviewWarnings}
                        >
                          <Crosshair size={15} aria-hidden="true" />
                          Review preview warnings
                        </button>
                      </Show>
                    </Show>
                    <Show when={safety().uncertain > 0}>
                      <p class="boundary-fill-uncertain">
                        <AlertTriangle size={14} aria-hidden="true" />
                        {safety().uncertain} HQ checks involve unverified
                        terrain. This cannot establish that an edge is secure.
                      </p>
                    </Show>
                  </Show>
                  <p class="boundary-fill-safety-note">
                    Boundary lines limit the fill; enemies can cross them.
                    Checks assume every other shown building remains.
                  </p>
                </div>
              )}
            </Show>

            <button
              class="button primary full"
              type="button"
              disabled={!result().accepted || !ready()}
              onClick={props.onApply}
            >
              Apply {result().accepted} HQ positions
            </button>
            <button
              class="button subtle full"
              type="button"
              onClick={props.onDiscard}
            >
              Discard preview
            </button>
            <p class="field-help">
              Adds named assignments to the plan. Undo removes the whole fill.
              To adjust an exposed edge after applying, select a coral HQ and
              choose Find tighter placements.
            </p>
          </div>
        )}
      </Show>
    </section>
  );
}
