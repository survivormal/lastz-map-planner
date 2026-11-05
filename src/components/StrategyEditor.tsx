import { createMemo, createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Dialog } from "@ark-ui/solid/dialog";
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Plus,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-solid";
import { ZodError } from "zod";
import {
  BUILTIN_STRATEGIES,
  BUILTIN_STRATEGY_IDS,
  CustomStrategySchema,
  parseStrategyConfig,
  rotateStrategyVector,
  serializeStrategyConfig,
  type Strategy,
} from "../domain/strategies";
import "./strategy-editor.css";

export type StrategyEditorProps = {
  /** Custom strategies belonging to the current plan. */
  strategies: Strategy[];
  onSave: (strategies: Strategy[]) => void;
  onSelect: (id: string) => void;
  onNotice: (text: string) => void;
};

type Draft = {
  id: string;
  name: string;
  description: string;
  aq: string;
  ar: string;
  bq: string;
  br: string;
  minGap: string;
  terrain: Strategy["terrain"];
  rotation: number;
  provenance?: string;
  source?: string;
};

const initialDraft: Draft = {
  id: "",
  name: "",
  description: "",
  aq: "3",
  ar: "1",
  bq: "-1",
  br: "4",
  minGap: "1",
  terrain: "mud",
  rotation: 0,
};

function draftFrom(strategy: Strategy): Draft {
  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    aq: String(strategy.basis[0].q),
    ar: String(strategy.basis[0].r),
    bq: String(strategy.basis[1].q),
    br: String(strategy.basis[1].r),
    minGap: String(strategy.minGap),
    terrain: strategy.terrain,
    rotation: strategy.rotation,
    provenance: strategy.provenance,
    source: strategy.source,
  };
}

function strategyFrom(draft: Draft): unknown {
  const number = (text: string) =>
    text.trim() === "" ? Number.NaN : Number(text);
  return {
    schemaVersion: 1,
    id: draft.id,
    name: draft.name,
    description: draft.description,
    basis: [
      { q: number(draft.aq), r: number(draft.ar) },
      { q: number(draft.bq), r: number(draft.br) },
    ],
    minGap: number(draft.minGap),
    terrain: draft.terrain,
    rotation: draft.rotation,
    ...(draft.provenance ? { provenance: draft.provenance } : {}),
    ...(draft.source ? { source: draft.source } : {}),
  };
}

function readableError(error: unknown): string {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    if (issue.path.includes("basis"))
      return "Use whole-number steps from −100 to 100, with two directions that are not parallel.";
    if (issue.path.includes("name"))
      return "Give this strategy a name from 1 to 120 characters.";
    if (issue.path.includes("description"))
      return "Describe when to use this strategy in 1 to 2,000 characters.";
    if (issue.path.includes("minGap"))
      return "The minimum gap must be a whole number from 0 to 10 empty tiles.";
    return issue.message;
  }
  if (error instanceof SyntaxError)
    return "This file is not valid JSON. Choose a strategy configuration exported from the planner.";
  return error instanceof Error
    ? error.message
    : "The strategy configuration could not be read.";
}

function describeVector(qText: string, rText: string): string {
  const q = Number(qText),
    r = Number(rText);
  if (!qText || !rText || !Number.isFinite(q) || !Number.isFinite(r))
    return "Enter two tile steps";
  const parts = [
    q ? `${Math.abs(q)} ${q > 0 ? "right" : "left"}` : "",
    r ? `${Math.abs(r)} ${r > 0 ? "down-right" : "up-left"}` : "",
  ].filter(Boolean);
  return parts.join(" + ") || "No movement";
}

function downloadConfig(strategies: Strategy[]): void {
  const text = serializeStrategyConfig(strategies);
  if (new TextEncoder().encode(text).byteLength > 256_000)
    throw new RangeError(
      "This export exceeds 256 KB. Export fewer strategies at a time.",
    );
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lastz-custom-strategies.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function StrategyEditor(props: StrategyEditorProps) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<Draft>({ ...initialDraft });
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [template, setTemplate] = createSignal("mud-tight");
  const [error, setError] = createSignal("");
  const [pendingImport, setPendingImport] = createSignal<Strategy[] | null>(
    null,
  );
  const [importing, setImporting] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;
  let dialogContent: HTMLDivElement | undefined;
  let importPreview: HTMLElement | undefined;
  let errorMessage: HTMLParagraphElement | undefined;
  const custom = createMemo(() =>
    props.strategies.filter(
      (strategy) => !BUILTIN_STRATEGY_IDS.includes(strategy.id),
    ),
  );
  const importingReplacements = createMemo(
    () =>
      pendingImport()?.filter((strategy) =>
        custom().some((existing) => existing.id === strategy.id),
      ).length ?? 0,
  );
  const preview = createMemo(() => {
    const values = [draft().aq, draft().ar, draft().bq, draft().br].map(Number);
    if (!values.every(Number.isFinite)) return null;
    const vectors = [
      rotateStrategyVector({ q: values[0], r: values[1] }, draft().rotation),
      rotateStrategyVector({ q: values[2], r: values[3] }, draft().rotation),
    ];
    const points = vectors.map(({ q, r }) => ({
      x: q + r / 2,
      y: (r * Math.sqrt(3)) / 2,
    }));
    const scale =
      47 /
      Math.max(1, ...points.flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)]));
    return points.map(({ x, y }) => ({ x: 80 + x * scale, y: 62 + y * scale }));
  });

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function reportError(message: string) {
    setError(message);
    queueMicrotask(() => errorMessage?.scrollIntoView({ block: "nearest" }));
  }

  function beginClone(id: string) {
    const base =
      BUILTIN_STRATEGIES.find((strategy) => strategy.id === id) ??
      BUILTIN_STRATEGIES[3];
    setTemplate(base.id);
    setDraft({
      ...draftFrom(base),
      id: `custom-${crypto.randomUUID()}`,
      name: `${base.name} · custom`,
      provenance: `Adapted from ${base.name}.`,
    });
    setEditingId(null);
    setPendingImport(null);
    setError("");
  }

  function edit(strategy: Strategy) {
    setDraft(draftFrom(strategy));
    setEditingId(strategy.id);
    setPendingImport(null);
    setError("");
  }

  function save() {
    const parsed = CustomStrategySchema.safeParse(strategyFrom(draft()));
    if (!parsed.success) {
      reportError(readableError(parsed.error));
      return;
    }
    try {
      const existing = custom().some((strategy) => strategy.id === editingId());
      const next = existing
        ? custom().map((strategy) =>
            strategy.id === editingId() ? parsed.data : strategy,
          )
        : [...custom(), parsed.data];
      // Validate the whole registry as well as this form, including duplicates and its size limit.
      serializeStrategyConfig(next);
      props.onSave(next);
      props.onSelect(parsed.data.id);
      props.onNotice(`${parsed.data.name} saved and selected.`);
      setEditingId(parsed.data.id);
      setDraft(draftFrom(parsed.data));
      setOpen(false);
    } catch (cause) {
      reportError(readableError(cause));
    }
  }

  function remove() {
    const id = editingId();
    if (!id) return;
    const removed = custom().find((strategy) => strategy.id === id);
    props.onSave(custom().filter((strategy) => strategy.id !== id));
    props.onNotice(
      `${removed?.name ?? "Strategy"} removed. Existing placements are unchanged.`,
    );
    beginClone(template());
  }

  async function importFile(
    event: Event & { currentTarget: HTMLInputElement },
  ) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    setPendingImport(null);
    setImporting(true);
    try {
      if (file.size > 256_000)
        throw new RangeError("Strategy configuration exceeds 256 KB.");
      const imported = parseStrategyConfig(await file.text());
      if (!imported.length)
        throw new Error("This file contains no custom strategies.");
      setPendingImport(imported);
      queueMicrotask(() => importPreview?.scrollIntoView({ block: "start" }));
    } catch (cause) {
      reportError(readableError(cause));
    } finally {
      setImporting(false);
    }
  }

  function applyImport() {
    const imported = pendingImport();
    if (!imported) return;
    try {
      const byId = new Map(custom().map((strategy) => [strategy.id, strategy]));
      imported.forEach((strategy) => byId.set(strategy.id, strategy));
      const next = [...byId.values()];
      serializeStrategyConfig(next);
      props.onSave(next);
      edit(imported[0]);
      props.onNotice(
        `${imported.length} custom ${imported.length === 1 ? "strategy" : "strategies"} imported.`,
      );
    } catch (cause) {
      reportError(readableError(cause));
    }
  }

  return (
    <Dialog.Root
      open={open()}
      onOpenChange={(details) => {
        if (details.open) {
          const current = custom().find(
            (strategy) => strategy.id === editingId(),
          );
          if (current) edit(current);
          else if (editingId()) {
            // Undo or importing a different plan can remove a configuration while this dialog is closed.
            // Preserve the old pattern as a new draft instead of silently saving to a missing ID.
            setEditingId(null);
            setDraft((previous) => ({
              ...previous,
              id: `custom-${crypto.randomUUID()}`,
            }));
            setError("");
          } else if (!draft().id) beginClone(template());
        }
        setOpen(details.open);
        if (details.open)
          queueMicrotask(() => {
            if (dialogContent) dialogContent.scrollTop = 0;
          });
      }}
    >
      <Dialog.Trigger class="button subtle full strategy-manager-trigger">
        <Settings2 size={13} />
        Manage strategies
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop class="dialog-backdrop" />
        <Dialog.Positioner class="dialog-positioner">
          <Dialog.Content
            ref={dialogContent}
            class="dialog-content strategy-editor"
          >
            <div class="dialog-heading">
              <span class="eyebrow">PLACEMENT LIBRARY</span>
              <Dialog.CloseTrigger
                class="icon-button"
                aria-label="Close strategy editor"
              >
                <X size={18} />
              </Dialog.CloseTrigger>
            </div>
            <Dialog.Title>Make the pattern yours.</Dialog.Title>
            <Dialog.Description>
              Build a repeating placement pattern from two tile directions. Save
              it with this plan, or share a configuration with your alliance.
            </Dialog.Description>
            <div class="strategy-editor-layout">
              <aside class="strategy-library" aria-label="Custom strategies">
                <div class="strategy-library-heading">
                  <span>YOUR STRATEGIES</span>
                  <span>{custom().length}/100</span>
                </div>
                <button
                  type="button"
                  class="button subtle full"
                  onClick={() => beginClone(template())}
                >
                  <Plus size={14} />
                  New strategy
                </button>
                <div class="strategy-library-list">
                  <For
                    each={custom()}
                    fallback={
                      <p class="field-help strategy-empty">
                        Your custom patterns will appear here. Start with a
                        built-in pattern and adjust its spacing.
                      </p>
                    }
                  >
                    {(strategy) => (
                      <button
                        type="button"
                        class="strategy-library-item"
                        classList={{ selected: editingId() === strategy.id }}
                        onClick={() => edit(strategy)}
                        aria-pressed={editingId() === strategy.id}
                      >
                        <span>
                          {strategy.name}
                          <small>
                            {strategy.terrain === "any"
                              ? "Any permitted terrain"
                              : `${strategy.terrain[0].toUpperCase()}${strategy.terrain.slice(1)} only`}{" "}
                            · {strategy.minGap} tile gap
                          </small>
                        </span>
                        <Show when={editingId() === strategy.id}>
                          <Check size={14} />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
                <div class="strategy-transfer">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    aria-label="Import strategy configuration file"
                    onChange={importFile}
                  />
                  <button
                    type="button"
                    class="button subtle full"
                    disabled={importing()}
                    onClick={() => fileInput?.click()}
                  >
                    <Upload size={13} />
                    {importing() ? "Reading file…" : "Import configuration"}
                  </button>
                  <button
                    type="button"
                    class="button subtle full"
                    disabled={!custom().length}
                    onClick={() => {
                      try {
                        downloadConfig(custom());
                        props.onNotice(
                          "Custom strategy configuration exported.",
                        );
                      } catch (cause) {
                        reportError(readableError(cause));
                      }
                    }}
                  >
                    <Download size={13} />
                    Export all custom
                  </button>
                </div>
              </aside>
              <div class="strategy-form-area">
                <Show when={pendingImport()}>
                  {(strategies) => (
                    <section
                      ref={importPreview}
                      class="strategy-import-preview"
                      aria-label="Review imported strategies"
                    >
                      <strong>
                        {strategies().length}{" "}
                        {strategies().length === 1 ? "strategy" : "strategies"}{" "}
                        ready to import
                      </strong>
                      <p>
                        {strategies()
                          .map(({ name }) => name)
                          .join(", ")}
                      </p>
                      <p>
                        {importingReplacements()
                          ? `${importingReplacements()} matching ${importingReplacements() === 1 ? "configuration will" : "configurations will"} be replaced. Existing placements stay in place.`
                          : "These will be added to your custom strategy library."}
                      </p>
                      <div class="strategy-inline-actions">
                        <button class="button primary" onClick={applyImport}>
                          Apply import
                        </button>
                        <button
                          class="button subtle"
                          onClick={() => setPendingImport(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </section>
                  )}
                </Show>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    save();
                  }}
                >
                  <Show when={!editingId()}>
                    <label class="field">
                      <span>Start from</span>
                      <select
                        value={template()}
                        onChange={(event) =>
                          beginClone(event.currentTarget.value)
                        }
                      >
                        <For each={BUILTIN_STRATEGIES}>
                          {(strategy) => (
                            <option value={strategy.id}>{strategy.name}</option>
                          )}
                        </For>
                      </select>
                    </label>
                  </Show>
                  <Show when={editingId()}>
                    <div class="strategy-edit-label">
                      <Copy size={13} />
                      Custom strategy · built-in patterns stay available
                    </div>
                  </Show>
                  <label class="field">
                    <span>Strategy name</span>
                    <input
                      value={draft().name}
                      maxlength={120}
                      required
                      onInput={(event) =>
                        update("name", event.currentTarget.value)
                      }
                      placeholder="e.g. North wedge stagger"
                    />
                  </label>
                  <label class="field">
                    <span>When to use it</span>
                    <textarea
                      class="strategy-description"
                      value={draft().description}
                      maxlength={2000}
                      required
                      onInput={(event) =>
                        update("description", event.currentTarget.value)
                      }
                      placeholder="Describe the formation and the area it is intended for."
                    />
                  </label>
                  <div class="strategy-pattern-panel">
                    <div class="strategy-pattern-visual" aria-hidden="true">
                      <svg viewBox="0 0 160 124" role="img">
                        <For each={Array.from({ length: 7 }, (_, i) => i)}>
                          {(row) => (
                            <For each={Array.from({ length: 9 }, (_, i) => i)}>
                              {(column) => (
                                <circle
                                  cx={15 + column * 16 + (row % 2 ? 8 : 0)}
                                  cy={14 + row * 16}
                                  r="1"
                                  fill="#647b54"
                                />
                              )}
                            </For>
                          )}
                        </For>
                        <Show when={preview()}>
                          {(points) => (
                            <>
                              <line
                                x1="80"
                                y1="62"
                                x2={points()[0].x}
                                y2={points()[0].y}
                                stroke="#c4eca6"
                                stroke-width="2"
                              />
                              <line
                                x1="80"
                                y1="62"
                                x2={points()[1].x}
                                y2={points()[1].y}
                                stroke="#b5a0f5"
                                stroke-width="2"
                              />
                              <circle
                                cx={points()[0].x}
                                cy={points()[0].y}
                                r="4"
                                fill="#c4eca6"
                              />
                              <text
                                x={points()[0].x + 7}
                                y={points()[0].y - 5}
                                fill="#c4eca6"
                                font-size="10"
                              >
                                A
                              </text>
                              <circle
                                cx={points()[1].x}
                                cy={points()[1].y}
                                r="4"
                                fill="#b5a0f5"
                              />
                              <text
                                x={points()[1].x + 7}
                                y={points()[1].y - 5}
                                fill="#b5a0f5"
                                font-size="10"
                              >
                                B
                              </text>
                            </>
                          )}
                        </Show>
                        <circle
                          cx="80"
                          cy="62"
                          r="5"
                          fill="#e9f2db"
                          stroke="#18241b"
                          stroke-width="2"
                        />
                      </svg>
                      <span>Repeat from an anchor</span>
                    </div>
                    <div class="strategy-vector-fields">
                      <p class="strategy-vector-help">
                        <b>q</b> steps right · <b>r</b> steps down-right
                        <br />
                        Negative numbers reverse the direction.
                      </p>
                      <fieldset>
                        <legend>
                          <i class="strategy-vector-a" />
                          Direction A
                        </legend>
                        <div class="strategy-vector-inputs">
                          <label>
                            q
                            <input
                              aria-label="Direction A q steps"
                              type="number"
                              step="1"
                              min="-100"
                              max="100"
                              required
                              value={draft().aq}
                              onInput={(event) =>
                                update("aq", event.currentTarget.value)
                              }
                            />
                          </label>
                          <label>
                            r
                            <input
                              aria-label="Direction A r steps"
                              type="number"
                              step="1"
                              min="-100"
                              max="100"
                              required
                              value={draft().ar}
                              onInput={(event) =>
                                update("ar", event.currentTarget.value)
                              }
                            />
                          </label>
                        </div>
                        <small>{describeVector(draft().aq, draft().ar)}</small>
                      </fieldset>
                      <fieldset>
                        <legend>
                          <i class="strategy-vector-b" />
                          Direction B
                        </legend>
                        <div class="strategy-vector-inputs">
                          <label>
                            q
                            <input
                              aria-label="Direction B q steps"
                              type="number"
                              step="1"
                              min="-100"
                              max="100"
                              required
                              value={draft().bq}
                              onInput={(event) =>
                                update("bq", event.currentTarget.value)
                              }
                            />
                          </label>
                          <label>
                            r
                            <input
                              aria-label="Direction B r steps"
                              type="number"
                              step="1"
                              min="-100"
                              max="100"
                              required
                              value={draft().br}
                              onInput={(event) =>
                                update("br", event.currentTarget.value)
                              }
                            />
                          </label>
                        </div>
                        <small>{describeVector(draft().bq, draft().br)}</small>
                      </fieldset>
                    </div>
                  </div>
                  <div class="strategy-rule-fields">
                    <label class="field">
                      <span>Terrain</span>
                      <select
                        value={draft().terrain}
                        onChange={(event) =>
                          update(
                            "terrain",
                            event.currentTarget.value as Strategy["terrain"],
                          )
                        }
                      >
                        <option value="any">Any permitted</option>
                        <option value="grass">Grass only</option>
                        <option value="mud">Mud only</option>
                      </select>
                    </label>
                    <label class="field">
                      <span>Minimum empty tiles</span>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="1"
                        required
                        value={draft().minGap}
                        onInput={(event) =>
                          update("minGap", event.currentTarget.value)
                        }
                      />
                    </label>
                    <label class="field">
                      <span>Rotation</span>
                      <select
                        value={draft().rotation}
                        onChange={(event) =>
                          update("rotation", Number(event.currentTarget.value))
                        }
                      >
                        <For each={[0, 1, 2, 3, 4, 5]}>
                          {(turn) => <option value={turn}>{turn * 60}°</option>}
                        </For>
                      </select>
                    </label>
                  </div>
                  <p class="field-help">
                    For the mud stagger, A is 3 right + 1 down-right; B is 1
                    left + 4 down-right. Minimum gap filters placements. Smart
                    fill checks every footprint against terrain and existing
                    placements.
                  </p>
                  <Show when={error()}>
                    <p ref={errorMessage} class="strategy-error" role="alert">
                      {error()}
                    </p>
                  </Show>
                  <div class="strategy-form-actions">
                    <Show when={editingId()}>
                      <button
                        type="button"
                        class="button danger"
                        onClick={remove}
                      >
                        <Trash2 size={13} />
                        Remove strategy
                      </button>
                    </Show>
                    <button type="submit" class="button primary">
                      <ArrowUpRight size={14} />
                      Save &amp; use strategy
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
