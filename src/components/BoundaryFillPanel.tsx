import { createUniqueId, For, Show } from "solid-js";
import { Checkbox } from "@ark-ui/solid/checkbox";
import {
  AlertTriangle,
  Check,
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

type OptimizationMetrics = {
  twoFit: number;
  openCenters: number;
  uncertain: number;
  invalid: number;
};

export type BoundaryOptimizationSummary = {
  status: "resolved" | "improved" | "unchanged" | "blocked";
  before: OptimizationMetrics;
  after: OptimizationMetrics;
  moved: number;
  added: number;
  removed: number;
  removedNames?: string[];
  coverageComplete: boolean;
  truncated: boolean;
  reason?: string;
  seedCount: number;
};

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
  autoTighten: boolean;
  fewestHqs: boolean;
  preserveExisting: boolean;
  optimizing: boolean;
  optimization: BoundaryOptimizationSummary | null;
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
  onFillMode: (value: Plan["settings"]["fillMode"]) => void;
  onPreserveExisting: (value: boolean) => void;
  onCancelOptimization: () => void;
};

export default function BoundaryFillPanel(props: BoundaryFillPanelProps) {
  const id = createUniqueId();
  const degrees = () => (((props.rotation % 6) + 6) % 6) * 60;
  const strategy = () =>
    props.strategies.find((value) => value.id === props.strategyId);
  const ready = () => props.safety?.status === "ready";
  const fillMode = () =>
    props.fewestHqs ? "fewest" : props.autoTighten ? "auto" : "exact";
  const mayRemoveExisting = () => props.fewestHqs && !props.preserveExisting;
  const qualifiesForFewest = () => {
    const result = props.optimization;
    return (
      result?.status === "resolved" &&
      result.coverageComplete &&
      result.after.twoFit === 0 &&
      result.after.openCenters === 0 &&
      result.after.invalid === 0 &&
      result.after.uncertain === 0
    );
  };
  const optimizationReady = () =>
    props.optimization &&
    props.optimization.status !== "blocked" &&
    props.optimization.moved +
      props.optimization.added +
      props.optimization.removed >
      0 &&
    (!props.optimization.removed ||
      props.optimization.removedNames?.length === props.optimization.removed) &&
    (!props.fewestHqs || qualifiesForFewest());
  const optimizationHeading = () => {
    const result = props.optimization;
    if (!result) return "Boundary comparison";
    if (props.fewestHqs)
      return qualifiesForFewest()
        ? "Fewest qualifying HQs found"
        : "No qualifying layout found";
    if (result.status === "blocked") return "Optimization needs review";
    if (result.after.invalid || result.after.uncertain)
      return "Terrain or placements need review";
    if (result.truncated) return "Search limited · review remaining area";
    if (result.status === "unchanged") return "No improving layout found";
    if (result.after.twoFit) return "Layout improved · loss warnings remain";
    if (result.after.openCenters) return "Open HQ centers remain";
    return "No openings found in this boundary";
  };

  return (
    <section class="boundary-fill" aria-label="Boundary auto-fill">
      <div class="section-label">
        BOUNDARY AUTO-FILL <Layers size={14} aria-hidden="true" />
      </div>
      <p class="field-help">
        {props.autoTighten
          ? mayRemoveExisting()
            ? "Find a smaller layout for this area. HQs wholly inside may move or be removed; retained HQs keep their names and assignments. Outside HQs and blockers stay fixed."
            : "Fill and tighten this area automatically. HQs wholly inside may move; their names and assignments stay attached. Outside HQs and blockers stay fixed."
          : "Fill this closed area with individual HQs. Every seven-tile footprint stays inside the boundary; existing placements stay put."}
      </p>
      <fieldset class="boundary-fill-controls" disabled={props.optimizing}>
        <label class="field">
          <span>Fill method</span>
          <select
            value={fillMode()}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "auto" || value === "fewest" || value === "exact")
                props.onFillMode(value);
            }}
          >
            <option value="fewest" selected={props.fewestHqs}>
              Fewest HQs
            </option>
            <option
              value="auto"
              selected={props.autoTighten && !props.fewestHqs}
            >
              Auto-tighten
            </option>
            <option value="exact" selected={!props.autoTighten}>
              Exact strategy
            </option>
          </select>
        </label>
        <Show when={props.fewestHqs}>
          <p class="boundary-fill-goal">
            Find the fewest HQs with zero two-HQ loss warnings and no open HQ
            centers inside this boundary. Both counts must be zero before you
            can apply a layout.
          </p>
          <Checkbox.Root
            class="boundary-fill-preserve"
            checked={props.preserveExisting}
            disabled={props.optimizing}
            onCheckedChange={(details) =>
              props.onPreserveExisting(details.checked === true)
            }
            aria-describedby={`${id}-preserve`}
          >
            <Checkbox.Control>
              <Checkbox.Indicator>
                <Check size={14} aria-hidden="true" />
              </Checkbox.Indicator>
            </Checkbox.Control>
            <Checkbox.Label>Keep existing HQs</Checkbox.Label>
            <Checkbox.HiddenInput />
          </Checkbox.Root>
          <p id={`${id}-preserve`} class="field-help">
            {props.preserveExisting
              ? "Retains every current HQ and assignment; only new additions are minimized."
              : "Existing HQs wholly inside may be removed. Preview lists removals; Undo restores them. Nothing is removed until you apply."}
          </p>
        </Show>
        <Show when={props.autoTighten}>
          <p class="field-help">
            Starts with your chosen pattern, then adjusts and adds HQs to close
            gaps. HQs may touch or sit off the plot; terrain and the full
            boundary footprint remain hard limits.
          </p>
        </Show>
        <label class="field">
          <span>
            {props.autoTighten ? "Preferred strategy" : "Fill strategy"}
          </span>
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
          {props.autoTighten ? "Starting pattern: " : ""}
          {strategy()?.minGap ?? 0} empty tiles between HQ footprints ·{" "}
          {strategy()?.terrain === "any"
            ? "Grass or mud"
            : strategy()?.terrain === "mud"
              ? props.autoTighten
                ? "At least one HQ tile on mud; rest may be grass"
                : "Entire HQ on mud"
              : "Entire HQ on grass"}
        </p>
        <Show when={props.autoTighten && strategy()?.terrain === "mud"}>
          <p class="field-help">
            Planning rule: mud HQs may straddle the grass edge. The drawn
            boundary still contains the full footprint. Retained pure-grass HQs
            stay on grass.
          </p>
        </Show>
        <label class="field">
          <span>
            {props.autoTighten ? "Group for new HQs" : "Assign to group"}
          </span>
          <select
            value={props.groupId}
            onChange={(event) => props.onGroup(event.currentTarget.value)}
          >
            <For each={props.groupOptions}>
              {(option) => (
                <option
                  value={option.id}
                  selected={props.groupId === option.id}
                >
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

        <fieldset
          class="boundary-fill-anchor"
          aria-describedby={`${id}-anchor`}
        >
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
            <button
              class="button subtle"
              type="button"
              onClick={props.onCenter}
            >
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
            {props.pickingAnchor
              ? "Cancel picking anchor"
              : "Pick anchor on map"}
          </button>
          <p id={`${id}-anchor`} class="field-help">
            {props.pickingAnchor
              ? "Click a tile to align the pattern. This does not place an HQ."
              : props.autoTighten
                ? "Sets the starting alignment. Auto-tighten can adjust individual positions while keeping every full HQ inside the boundary."
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
          {props.fewestHqs
            ? "Find fewest HQs"
            : props.autoTighten
              ? "Optimize boundary fill"
              : props.result
                ? "Rebuild fill preview"
                : "Preview auto-fill"}
        </button>
      </fieldset>

      <Show when={props.optimizing}>
        <div class="boundary-fill-progress">
          <div role="status" aria-live="polite">
            <strong>
              {props.fewestHqs
                ? "Comparing HQ counts…"
                : "Comparing boundary layouts…"}
            </strong>
            <p>
              {props.fewestHqs
                ? "Searching for fewer HQs while keeping both opening counts at zero. Your plan stays unchanged until you apply a qualifying preview."
                : "Testing gaps and HQ-loss openings, then tightening the complete layout. Your plan stays unchanged until you apply the preview."}
            </p>
          </div>
          <button
            class="button subtle full"
            type="button"
            onClick={props.onCancelOptimization}
          >
            Cancel optimization
          </button>
        </div>
      </Show>

      <Show when={!props.optimizing && props.result}>
        {(result) => (
          <div class="boundary-fill-result" aria-live="polite">
            <div class="boundary-fill-result-heading">
              <strong>{result().accepted}</strong>
              <span>
                {props.autoTighten
                  ? "boundary HQs in preview"
                  : "HQ positions fit"}
              </span>
              <small>PREVIEW ONLY</small>
            </div>
            <Show when={props.autoTighten && props.optimization}>
              {(optimization) => (
                <div class="boundary-fill-optimization">
                  <h3>{optimizationHeading()}</h3>
                  <Show when={props.fewestHqs}>
                    <p
                      class="boundary-fill-goal-result"
                      classList={{ "is-blocked": !qualifiesForFewest() }}
                    >
                      {qualifiesForFewest()
                        ? "Both opening counts are zero in the checked layout. This is the fewest HQs found by the bounded search, not a proven global minimum."
                        : "This preview cannot be applied in Fewest HQs mode. A qualifying layout must have zero two-HQ loss warnings, zero open HQ centers, and complete terrain checks."}
                    </p>
                  </Show>
                  <p class="field-help">
                    {optimization().moved} assigned HQ
                    {optimization().moved === 1 ? "" : "s"} moved ·{" "}
                    {optimization().added} new HQ
                    {optimization().added === 1 ? "" : "s"} added
                    <Show when={optimization().removed > 0}>
                      {" "}
                      · {optimization().removed} existing HQ
                      {optimization().removed === 1 ? "" : "s"} removed
                    </Show>
                  </p>
                  <Show when={optimization().removed > 0}>
                    <details class="boundary-fill-removals">
                      <summary>
                        Review {optimization().removed}{" "}
                        {optimization().removed === 1
                          ? "removed assignment"
                          : "removed assignments"}
                      </summary>
                      <p>
                        Removed only when you apply this layout. Undo restores
                        these HQs and their assignments.
                      </p>
                      <ul>
                        <For each={optimization().removedNames ?? []}>
                          {(name) => <li>{name}</li>}
                        </For>
                      </ul>
                      <Show
                        when={
                          optimization().removedNames?.length !==
                          optimization().removed
                        }
                      >
                        <p>
                          The complete removal list is unavailable. Rebuild the
                          preview before applying.
                        </p>
                      </Show>
                    </details>
                  </Show>
                  <p class="field-help">
                    Compared with the chosen strategy’s starting fill of{" "}
                    {optimization().seedCount} HQs, including existing
                    assignments inside the boundary.
                  </p>
                  <table aria-label="Boundary optimization comparison">
                    <thead>
                      <tr>
                        <th scope="col">Inside this boundary</th>
                        <th scope="col">Start</th>
                        <th scope="col">Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Show when={props.fewestHqs}>
                        <tr>
                          <th scope="row">HQ count</th>
                          <td>{optimization().seedCount}</td>
                          <td>{result().accepted}</td>
                        </tr>
                      </Show>
                      <tr>
                        <th scope="row">Two-HQ loss warnings</th>
                        <td>{optimization().before.twoFit}</td>
                        <td
                          classList={{
                            "has-risk": optimization().after.twoFit > 0,
                          }}
                        >
                          {optimization().after.twoFit}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Open HQ centers</th>
                        <td>{optimization().before.openCenters}</td>
                        <td
                          classList={{
                            "has-openings":
                              optimization().after.openCenters > 0,
                          }}
                        >
                          {optimization().after.openCenters}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p class="field-help">
                    Open centers are candidate locations that may overlap, not
                    the number of enemies that fit at once. These counts cover
                    this boundary, not the entire map.
                  </p>
                  <Show when={optimization().reason}>
                    <p class="boundary-fill-notice">{optimization().reason}</p>
                  </Show>
                  <Show when={optimization().truncated}>
                    <p class="boundary-fill-notice">
                      {props.fewestHqs
                        ? "Search limit reached. A smaller qualifying layout may exist; this does not prove the minimum HQ count."
                        : "Search limit reached. This is the best layout found in the search; other improvements may exist."}
                    </p>
                  </Show>
                  <Show
                    when={
                      optimization().after.twoFit > 0 ||
                      optimization().after.openCenters > 0
                    }
                  >
                    <p class="boundary-fill-notice">
                      Openings remain. Try enlarging the boundary to give nearby
                      HQs room to adjust, confirm the terrain, and run
                      {props.fewestHqs
                        ? " the search again."
                        : " auto-tighten again."}
                    </p>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={!props.autoTighten && !props.optimization}>
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
                  lower limits for complex boundaries or a nearly full plan.
                  Fill smaller areas to check the rest.
                </p>
              </Show>
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
                    <strong>
                      {props.autoTighten ? "Layout check" : "HQ loss check"}
                    </strong>
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
                      <Show when={!props.autoTighten}>
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
                            {safety().uncertain ? "could" : "can"} each open
                            room for two enemies if lost.
                          </p>
                        </Show>
                      </Show>
                      <Show
                        when={props.autoTighten && safety().proposedTwoFit > 0}
                      >
                        <p>
                          <b>
                            {safety().proposedTwoFit} boundary{" "}
                            {safety().proposedTwoFit === 1 ? "HQ" : "HQs"}
                          </b>{" "}
                          {safety().uncertain ? "could" : "can"} each open room
                          for two enemies if lost.
                        </p>
                      </Show>
                      <Show when={safety().existingTwoFit > 0}>
                        <p>
                          {safety().existingTwoFit}{" "}
                          {props.autoTighten ? "outside" : "existing"}{" "}
                          {safety().existingTwoFit === 1
                            ? "HQ also has"
                            : "HQs also have"}{" "}
                          loss warnings in this layout.
                          {props.autoTighten
                            ? " Outside HQs remain fixed and are not included in the boundary comparison."
                            : ""}
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
                    {props.autoTighten
                      ? " This checks one HQ lost at a time, not simultaneous losses."
                      : ""}
                  </p>
                </div>
              )}
            </Show>

            <button
              class="button primary full"
              type="button"
              disabled={
                !ready() ||
                (props.autoTighten ? !optimizationReady() : !result().accepted)
              }
              onClick={props.onApply}
            >
              {props.fewestHqs
                ? "Apply fewest found layout"
                : props.autoTighten
                  ? props.optimization &&
                    (props.optimization.after.twoFit > 0 ||
                      props.optimization.after.openCenters > 0 ||
                      props.optimization.truncated)
                    ? "Apply best found layout"
                    : "Apply optimized layout"
                  : `Apply ${result().accepted} HQ positions`}
            </button>
            <button
              class="button subtle full"
              type="button"
              onClick={props.onDiscard}
            >
              Discard preview
            </button>
            <p class="field-help">
              {props.autoTighten
                ? mayRemoveExisting()
                  ? "Applies the complete layout and the listed removals in one step. Retained HQs keep their names and assignments. Undo restores the previous layout, including removed HQs."
                  : "Applies the complete layout in one step, preserving existing names and assignments. Undo restores the previous layout."
                : "Adds named assignments to the plan. Undo removes the whole fill. Switch to Auto-tighten to compare adjustments across this boundary automatically."}
            </p>
          </div>
        )}
      </Show>
    </section>
  );
}
