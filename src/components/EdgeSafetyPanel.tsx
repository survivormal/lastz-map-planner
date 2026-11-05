import { For, Show } from "solid-js";
import { Switch } from "@ark-ui/solid/switch";
import {
  AlertTriangle,
  ArrowRight,
  Copy,
  Crosshair,
  Shield,
  X,
} from "lucide-solid";
import type {
  Placement,
  ReplacementAnalysis,
  TighteningSearchResult,
  TighteningSuggestion,
} from "../domain";

type Props = {
  placement: Placement;
  analysis?: ReplacementAnalysis;
  checking: boolean;
  failed: boolean;
  provisional: boolean;
  invalid: boolean;
  showOpen: boolean;
  onShowOpen: (value: boolean) => void;
  searching: boolean;
  applying: boolean;
  search?: TighteningSearchResult;
  preview?: TighteningSuggestion;
  placementName: (id: string) => string;
  onSearch: () => void;
  onPreview: (suggestion: TighteningSuggestion) => void;
  onCancel: () => void;
  onApply: () => void;
  onTouching: () => void;
  onCopy: (tile: { x: number; y: number }) => void;
};

export default function EdgeSafetyPanel(props: Props) {
  const incomplete = () => Boolean(props.analysis?.unknownTiles.length);
  return (
    <section
      class="panel-section edge-safety-panel"
      aria-label="HQ edge safety"
    >
      <div class="section-label">
        EDGE SAFETY <Shield size={14} />
      </div>
      <p class="field-help">
        Updates as you build. Tests whether losing this HQ opens room for two
        non-overlapping enemy HQs.
      </p>
      <Show when={props.failed}>
        <p class="plot-warning">
          Edge checking is unavailable. Reload the plan to retry.
        </p>
      </Show>
      <Show
        when={!props.checking}
        fallback={
          <p class="field-help" role="status">
            Checking HQ edges…
          </p>
        }
      >
        <Show
          when={!props.invalid}
          fallback={
            <p class="plot-warning">
              Resolve the plan’s invalid positions before relying on loss checks
              or tightening suggestions. An invalid blocker cannot provide
              protection.
            </p>
          }
        >
          <Show when={props.analysis}>
            {(result) => (
              <div
                class={`risk-result ${result().risk === "two-fit" ? "risk-high" : ""} ${incomplete() ? "risk-incomplete" : ""}`}
                aria-live="polite"
              >
                <strong>
                  {result().risk === "two-fit"
                    ? props.provisional
                      ? "Provisional · two HQs could fit"
                      : "1 HQ lost → 2 enemy HQs fit"
                    : incomplete()
                      ? "Terrain incomplete"
                      : "No two-HQ loss found here"}
                </strong>
                <Show when={incomplete()}>
                  <p>
                    {props.provisional
                      ? "Unknown tiles are assumed usable in this provisional check. "
                      : "Unverified terrain is nearby. "}
                    This result cannot establish that the edge is secure.
                  </p>
                </Show>
                <Show when={result().witnessPair}>
                  {(pair) => (
                    <>
                      <p>
                        {props.preview
                          ? "Cancel the adjustment preview to show Enemy A and B on the map again."
                          : props.provisional
                            ? "Enemy A and B show a candidate pair, assuming unknown tiles are usable."
                            : "Enemy A and B show one pair that fits after this HQ is removed."}
                      </p>
                      <div class="witness-coordinates">
                        <For each={pair()}>
                          {(tile, i) => (
                            <button
                              class="text-button"
                              onClick={() => props.onCopy(tile)}
                              aria-label={`Copy enemy ${i() ? "B" : "A"} coordinates`}
                            >
                              <b>{i() ? "B" : "A"}</b> X:{tile.x} Y:{tile.y}
                              <Copy size={12} />
                            </button>
                          )}
                        </For>
                      </div>
                    </>
                  )}
                </Show>
                <small>
                  Grass is usable enemy space. Restricted terrain blocks the
                  full footprint. Wedge lines do not block enemies. All other
                  buildings are assumed to remain.
                </small>
              </div>
            )}
          </Show>
        </Show>
      </Show>
      <Show when={props.analysis?.existingOpen.length}>
        <Switch.Root
          class="toggle-row edge-open-toggle"
          checked={props.showOpen}
          onCheckedChange={(d) => props.onShowOpen(d.checked)}
        >
          <Switch.Label>
            <span>Show already-open centers</span>
            <small>
              {props.analysis!.existingOpen.length} nearby candidates, separate
              from this loss. Candidates may overlap each other.
            </small>
          </Switch.Label>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.HiddenInput />
        </Switch.Root>
      </Show>
      <div class="edge-tightening">
        <div class="section-label">TIGHTEN THIS EDGE</div>
        <p class="field-help">
          Try a one- or two-tile adjustment or one extra HQ. These are
          deliberate exceptions to the stagger and can use touching spacing.
        </p>
        <button
          class="button full subtle"
          disabled={
            props.checking ||
            props.searching ||
            props.invalid ||
            !props.analysis ||
            incomplete()
          }
          onClick={props.onSearch}
        >
          <Crosshair size={15} />
          {props.searching
            ? "Comparing placements…"
            : "Find tighter placements"}
        </button>
        <Show when={props.search}>
          {(search) => (
            <div class="edge-search-result" aria-live="polite">
              <Show
                when={search().suggestions.length}
                fallback={
                  <p class="field-help">
                    {search().reason ??
                      "No improving single change found. Try a larger edge redesign or add a blocker on grass."}
                  </p>
                }
              >
                <p class="field-help">
                  Choose an option to preview. Counts compare confirmed two-HQ
                  losses across the plan.
                </p>
                <div class="edge-options">
                  <For each={search().suggestions}>
                    {(option) => (
                      <button
                        class="edge-option"
                        classList={{ active: props.preview?.id === option.id }}
                        aria-pressed={props.preview?.id === option.id}
                        onClick={() => props.onPreview(option)}
                      >
                        <span>
                          {option.kind === "move"
                            ? `Adjust ${props.placementName(option.placementId!)}`
                            : "Add an infill HQ"}
                        </span>
                        <small>
                          X:{option.to.x} Y:{option.to.y} ·{" "}
                          {option.kind === "move"
                            ? "keep assignment"
                            : "new assignment"}
                        </small>
                        <span class="edge-reduction">
                          <AlertTriangle size={13} />
                          {option.beforeCount}
                          <ArrowRight size={13} />
                          {option.afterCount} exposed HQs
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <p class="field-help">
                {search().evaluated} candidates compared.
                {search().truncated
                  ? " Search limit reached; other improvements may exist."
                  : " Local search; larger changes may improve this edge further."}
              </p>
            </div>
          )}
        </Show>
        <Show when={props.preview}>
          {(proposal) => (
            <div class="edge-apply-card">
              <strong>Preview only · plan unchanged</strong>
              <p class="field-help">
                {proposal().kind === "move"
                  ? "Cyan is the adjusted HQ; FROM marks its current position. This changes the plan, not an in-game teleport route. A moved HQ is unlinked from its preset cluster."
                  : "Cyan marks one new HQ assignment. It must be occupied to provide the shown protection."}{" "}
                The plot anchor stays fixed.
              </p>
              <div class="edge-apply-actions">
                <button
                  class="button primary"
                  onClick={props.onApply}
                  disabled={props.applying}
                >
                  {props.applying ? "Rechecking…" : "Apply edge adjustment"}
                </button>
                <button
                  class="icon-button"
                  onClick={props.onCancel}
                  aria-label="Cancel edge preview"
                >
                  <X size={16} />
                </button>
              </div>
              <p class="field-help">
                Rechecked before applying. Undo restores the previous plan.
              </p>
            </div>
          )}
        </Show>
        <button class="button full subtle" onClick={props.onTouching}>
          Use touching placement
        </button>
        <p class="field-help">
          For manual infill, switch to a single HQ with no empty-tile gap.
          Food/Wood can block grass; set their alliance range marker in Layers.
        </p>
      </div>
    </section>
  );
}
