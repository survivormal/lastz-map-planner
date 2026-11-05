import {
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  Show,
  For,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Tabs } from "@ark-ui/solid/tabs";
import { Switch } from "@ark-ui/solid/switch";
import { Dialog } from "@ark-ui/solid/dialog";
import { Tooltip } from "@ark-ui/solid/tooltip";
import {
  MousePointer2,
  Hand,
  Hexagon,
  Wheat,
  TreePine,
  Pentagon,
  Eraser,
  Ruler,
  Plus,
  Minus,
  Maximize,
  Undo2,
  Redo2,
  Download,
  Upload,
  Share2,
  Copy,
  Check,
  X,
  ChevronRight,
  Layers,
  Crosshair,
  Trash2,
  ArrowUpRight,
  Shield,
  AlertTriangle,
  Settings2,
  Flower2,
  MoveUpRight,
  MapPin,
  Menu,
} from "lucide-solid";
import StrategyEditor from "../components/StrategyEditor";
import WorldMap, {
  type MapTool,
  type MapApi,
  type Camera,
} from "../components/WorldMap";
import {
  createPlan,
  PlanSchema,
  validatePlacement,
  validateMove,
  generateFormation,
  analyzeReplacement,
  footprint,
  footprintInBoundary,
  distance,
  coordinateToken,
  inWorld,
  createStrategyRegistry,
  regularStrategy,
  smartFillBoundary,
  offset,
  rotateStrategyVector,
  type SmartFillResult,
  type Plan,
  type Placement,
  type Tile,
  type Terrain,
  type Spacing,
} from "../domain";
import {
  parsePlan,
  serializePlan,
  exportAssignmentsCsv,
  loadLocalPlan,
  saveLocalPlan,
  createShareFragment,
  parseShareFragment,
} from "../domain/persistence";
import { terrainLookup, PALACE } from "../data/terrain";

type Formation = "single" | "daisy" | "grass" | "mud";
type Strategy = string;
const tools = [
  { id: "select", label: "Select & move", key: "V", icon: MousePointer2 },
  { id: "pan", label: "Pan map", key: "H", icon: Hand },
  { id: "hq", label: "Place headquarters", key: "B", icon: Hexagon },
  { id: "food", label: "Alliance food", key: "F", icon: Wheat },
  { id: "wood", label: "Alliance wood", key: "W", icon: TreePine },
  { id: "boundary", label: "Draw boundary", key: "L", icon: Pentagon },
  { id: "measure", label: "Measure distance", key: "M", icon: Ruler },
  { id: "terrain", label: "Mark terrain", key: "T", icon: Layers },
  { id: "erase", label: "Erase placement", key: "E", icon: Eraser },
] as const;
const clone = <T,>(v: T): T => structuredClone(v);
function Toggle(props: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Switch.Root
      class="toggle-row"
      checked={props.checked}
      onCheckedChange={(d) => props.onChange(d.checked)}
    >
      <Switch.Label>
        <span>{props.label}</span>
        <Show when={props.detail}>
          <small>{props.detail}</small>
        </Show>
      </Switch.Label>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
      <Switch.HiddenInput />
    </Switch.Root>
  );
}
function ToolButton(props: {
  label: string;
  children: any;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip.Root openDelay={350}>
      <Tooltip.Trigger
        class={`icon-button ${props.active ? "active" : ""}`}
        aria-label={props.label}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.children}
      </Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content class="tooltip">{props.label}</Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}
export default function Planner() {
  const [plan, setPlan] = createSignal<Plan>(createPlan("Operation Northstar"));
  const [tool, setTool] = createSignal<MapTool>("select");
  const [selected, setSelected] = createSignal<string | null>(null);
  const [group, setGroup] = createSignal("grass");
  const formation = () => plan().settings.formation;
  const setFormation = (value: Formation) =>
    commit((p) => {
      p.settings.formation = value;
    });
  const strategy = () => plan().settings.strategyId;
  const setStrategy = (value: Strategy) =>
    commit((p) => {
      p.settings.strategyId = value;
    });
  const rotation = () => plan().settings.rotation;
  const setRotation = (value: number) =>
    commit((p) => {
      p.settings.rotation = value;
    });
  const [hover, setHover] = createSignal<Tile | null>(null);
  const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, zoom: 1 });
  const [tab, setTab] = createSignal("plan");
  const [draft, setDraft] = createSignal<Tile[]>([]);
  const [measure, setMeasure] = createSignal<Tile[]>([]);
  const [fillPreview, setFillPreview] = createSignal<SmartFillResult | null>(
    null,
  );
  const [risk, setRisk] = createSignal<ReturnType<
    typeof analyzeReplacement
  > | null>(null);
  const [notice, setNotice] = createSignal("");
  const [saved, setSaved] = createSignal("Local plan");
  const [ready, setReady] = createSignal(false);
  const [canSave, setCanSave] = createSignal(false);
  const [history, setHistory] = createSignal<Plan[]>([]);
  const [future, setFuture] = createSignal<Plan[]>([]);
  const [shareOpen, setShareOpen] = createSignal(false);
  const [shareUrl, setShareUrl] = createSignal("");
  const [shareStatus, setShareStatus] = createSignal("");
  const [mobilePanel, setMobilePanel] = createSignal(false);
  const [paint, setPaint] = createSignal<Terrain>("restricted");
  const [xInput, setXInput] = createSignal("477");
  const [yInput, setYInput] = createSignal("477");
  let map: MapApi | undefined,
    input!: HTMLInputElement,
    noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const terrain = createMemo(() => terrainLookup(plan()));
  const planIssues = createMemo(() =>
    plan().placements.flatMap((p) => {
      const result = validatePlacement(p, plan().placements, {
        terrainAt: terrain().rules,
        ignoreId: p.id,
        spacing: "tile",
        allowUnknown: plan().settings.allowUnknown,
      });
      return result.valid
        ? []
        : [{ id: p.id, name: p.name, issues: result.issues }];
    }),
  );
  const selectedPlacement = createMemo(() =>
    plan().placements.find((p) => p.id === selected()),
  );
  const selectedBoundary = createMemo(() =>
    plan().boundaries.find((p) => p.id === selected()),
  );
  const activeGroup = createMemo(
    () => plan().groups.find((g) => g.id === group()) ?? plan().groups[0],
  );
  const registry = createMemo(() => createStrategyRegistry(plan().strategies));
  const activeStrategy = createMemo(() =>
    strategy() === "regular"
      ? regularStrategy(plan().settings.spacing)
      : (registry().get(strategy()) ??
        regularStrategy(plan().settings.spacing)),
  );
  const options = () => ({
    terrainAt: terrain().rules,
    spacing: effectiveSpacing(),
    allowUnknown: plan().settings.allowUnknown,
  });
  const effectiveSpacing = (): Spacing =>
    activeStrategy().minGap >= 2
      ? "loose"
      : activeStrategy().minGap === 1
        ? "tight"
        : "tile";
  function notify(text: string) {
    setNotice(text);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => setNotice(""), 6500);
  }
  function commit(fn: (next: Plan) => void) {
    const current = plan(),
      next = clone(current);
    fn(next);
    const parsed = PlanSchema.safeParse(next);
    if (!parsed.success) {
      notify(parsed.error.issues[0]?.message ?? "Invalid plan");
      return false;
    }
    setHistory((h) => [...h.slice(-79), current]);
    setFuture([]);
    setPlan(parsed.data);
    setCanSave(true);
    setRisk(null);
    setFillPreview(null);
    return true;
  }
  function undo() {
    const stack = history();
    if (!stack.length) return;
    setFuture((f) => [...f, plan()]);
    setPlan(stack[stack.length - 1]);
    setHistory(stack.slice(0, -1));
    setRisk(null);
    setFillPreview(null);
    setCanSave(true);
  }
  function redo() {
    const stack = future();
    if (!stack.length) return;
    setHistory((h) => [...h, plan()]);
    setPlan(stack[stack.length - 1]);
    setFuture(stack.slice(0, -1));
    setRisk(null);
    setFillPreview(null);
    setCanSave(true);
  }
  function setting<K extends keyof Plan["settings"]>(
    key: K,
    value: Plan["settings"][K],
  ) {
    commit((p) => {
      p.settings[key] = value;
    });
  }
  function useTool(value: MapTool) {
    setTool(value);
    setFillPreview(null);
    setDraft([]);
    if (value !== "measure") setMeasure([]);
    if (value === "terrain") setTab("layers");
  }
  function deleteSelected() {
    if (!selected()) return;
    commit((p) => {
      p.placements = p.placements.filter((v) => v.id !== selected());
      p.boundaries = p.boundaries.filter((v) => v.id !== selected());
    });
    setSelected(null);
  }
  function candidateTiles(tile: Tile) {
    if (formation() === "single" || tool() !== "hq") return [tile];
    if (strategy() === "regular")
      return generateFormation(
        formation() as "daisy" | "grass" | "mud",
        tile,
        effectiveSpacing(),
        { rotation: rotation() },
      );
    const [a, b] = activeStrategy().basis.map((v) =>
      rotateStrategyVector(v, (activeStrategy().rotation + rotation()) % 6),
    );
    const vectors =
      formation() === "daisy"
        ? [
            { q: 0, r: 0 },
            a,
            b,
            { q: b.q - a.q, r: b.r - a.r },
            { q: -a.q, r: -a.r },
            { q: -b.q, r: -b.r },
            { q: a.q - b.q, r: a.r - b.r },
          ]
        : Array.from({ length: 12 }, (_, i) => ({
            q: (i % 4) * a.q + Math.floor(i / 4) * b.q,
            r: (i % 4) * a.r + Math.floor(i / 4) * b.r,
          }));
    return vectors.map((v) => offset(tile, v));
  }
  function candidate(tile: Tile, index = 0): Placement {
    return {
      id: crypto.randomUUID(),
      kind: tool() === "food" ? "food" : tool() === "wood" ? "wood" : "hq",
      ...tile,
      name: `${tool() === "food" ? "Food" : tool() === "wood" ? "Wood" : "HQ"} ${String(plan().placements.length + index + 1).padStart(2, "0")}`,
      groupId: activeGroup().id,
      showGraphic: false,
    };
  }
  function checkTiles(tiles: Tile[]) {
    const existing = [...plan().placements];
    const issues: string[] = [];
    for (const tile of tiles) {
      const p = candidate(tile);
      const result = validatePlacement(p, existing, options());
      issues.push(...result.issues);
      if (
        activeStrategy().terrain !== "any" &&
        p.kind === "hq" &&
        footprint(p).some(
          (c) => terrain().rules(c) !== activeStrategy().terrain,
        )
      )
        issues.push(
          `This strategy requires the entire HQ on ${activeStrategy().terrain}.`,
        );
      if (existing.some((e) => distance(e, p) < 3 + activeStrategy().minGap))
        issues.push(
          `This strategy requires ${activeStrategy().minGap} empty tiles of clearance.`,
        );
      existing.push(p);
    }
    return [...new Set(issues)];
  }
  const preview = createMemo(() =>
    hover() && ["hq", "food", "wood"].includes(tool())
      ? candidateTiles(hover()!)
      : [],
  );
  const previewIssues = createMemo(() =>
    preview().length ? checkTiles(preview()) : [],
  );
  function placeAt(tile: Tile) {
    const tiles = candidateTiles(tile),
      issues = checkTiles(tiles);
    if (issues.length) {
      notify(issues[0]);
      return;
    }
    const added = tiles.map((v, i) => candidate(v, i));
    commit((p) => p.placements.push(...added));
    setSelected(added[0].id);
    notify(
      `${added.length === 1 ? "Position" : `${added.length} positions`} added to ${activeGroup().name}.`,
    );
  }
  function clickMap(tile: Tile, p?: Placement) {
    if (!inWorld(tile)) return;
    if (tool() === "select") {
      setSelected(p?.id ?? null);
      setRisk(null);
      if (p) {
        setTab("inspect");
        setXInput(String(p.x));
        setYInput(String(p.y));
      }
      return;
    }
    if (["hq", "food", "wood"].includes(tool())) {
      placeAt(tile);
      return;
    }
    if (tool() === "erase") {
      if (p) {
        commit((d) => {
          d.placements = d.placements.filter((v) => v.id !== p.id);
        });
        if (selected() === p.id) setSelected(null);
      }
      return;
    }
    if (tool() === "boundary") {
      setDraft((d) => [...d, tile]);
      return;
    }
    if (tool() === "measure") {
      setMeasure((m) => (m.length === 1 ? [m[0], tile] : [tile]));
      return;
    }
    if (tool() === "terrain") {
      commit((d) => {
        d.terrainOverrides = d.terrainOverrides.filter(
          (t) => t.x !== tile.x || t.y !== tile.y,
        );
        d.terrainOverrides.push({ ...tile, terrain: paint() });
      });
    }
  }
  function move(id: string, tile: Tile) {
    const p = plan().placements.find((v) => v.id === id);
    if (!p) return;
    const check = validateMove(p, tile, plan().placements, options());
    if (p.kind === "hq") {
      if (
        activeStrategy().terrain !== "any" &&
        footprint(tile).some(
          (t) => terrain().rules(t) !== activeStrategy().terrain,
        )
      )
        check.issues.push(
          `This strategy requires the entire HQ on ${activeStrategy().terrain}.`,
        );
    }
    if (
      plan().placements.some(
        (e) => e.id !== id && distance(e, tile) < 3 + activeStrategy().minGap,
      )
    )
      check.issues.push(
        `This strategy requires ${activeStrategy().minGap} empty tiles of clearance.`,
      );
    check.valid = check.issues.length === 0;
    if (!check.valid) {
      notify(check.issues[0]);
      return;
    }
    commit((d) => {
      const v = d.placements.find((v) => v.id === id)!;
      v.x = tile.x;
      v.y = tile.y;
    });
    setSelected(id);
    setXInput(String(tile.x));
    setYInput(String(tile.y));
  }
  function computeFill() {
    const boundary = selectedBoundary(),
      anchor = typedTile();
    if (!boundary?.closed || !anchor)
      throw new Error("Choose a closed wedge and a valid anchor.");
    const result = smartFillBoundary({
      anchor,
      boundary: boundary.points,
      strategy: {
        ...activeStrategy(),
        rotation: (activeStrategy().rotation + rotation()) % 6,
      },
      placements: plan().placements,
      terrainAt: terrain().rules,
      groupId: activeGroup().id,
      namePrefix: activeGroup().name,
      allowUnknown: plan().settings.allowUnknown,
      maxCandidates: 4000,
      maxPlacements: 250,
    });
    result.provisional = result.placements.filter((p) =>
      footprint(p).some((t) => !terrain().verified(t)),
    ).length;
    return result;
  }
  function previewFill() {
    try {
      const result = computeFill();
      setFillPreview(result);
      setTool("select");
      notify(
        result.accepted
          ? `Previewing ${result.accepted} placements. Apply to add them to your plan.`
          : "No legal positions found. Check terrain, anchor and strategy.",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not fill this boundary.");
    }
  }
  function applyFill() {
    try {
      const prior = fillPreview();
      if (!prior) return;
      const fresh = computeFill();
      const key = (p: Placement) => `${p.kind}:${p.x},${p.y}:${p.groupId}`;
      if (
        prior.placements.map(key).join("|") !==
        fresh.placements.map(key).join("|")
      ) {
        setFillPreview(fresh);
        notify(
          "The plan changed. Review this updated preview before applying.",
        );
        return;
      }
      commit((p) => p.placements.push(...fresh.placements));
      notify(`Added ${fresh.accepted} positions.`);
    } catch (e) {
      setFillPreview(null);
      notify(e instanceof Error ? e.message : "Could not apply the fill.");
    }
  }
  function finishBoundary(closed: boolean) {
    if (draft().length < (closed ? 3 : 2)) {
      notify(
        closed
          ? "Add at least three points for a wedge."
          : "Add at least two points.",
      );
      return;
    }
    const id = crypto.randomUUID();
    commit((p) =>
      p.boundaries.push({
        id,
        name: `${closed ? "Wedge" : "Boundary"} ${p.boundaries.length + 1}`,
        points: draft(),
        closed,
      }),
    );
    setDraft([]);
    setSelected(id);
    setTool("select");
    setTab("inspect");
  }
  function analyze() {
    const target = selectedPlacement();
    if (!target || target.kind !== "hq") return;
    const issues = planIssues().find((v) => v.id === target.id);
    if (issues) {
      notify(issues.issues[0]);
      return;
    }
    const result = analyzeReplacement(target, plan().placements, {
      terrainAt: terrain().rules,
      allowUnknown: plan().settings.allowUnknown,
    });
    setRisk(result);
  }
  function typedTile(): Tile | null {
    const x = Number(xInput()),
      y = Number(yInput());
    if (
      !/^\d+$/.test(xInput()) ||
      !/^\d+$/.test(yInput()) ||
      !inWorld({ x, y })
    ) {
      notify("Enter whole coordinates from 0 to 999.");
      return null;
    }
    return { x, y };
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard.");
    } catch {
      setShareUrl(text);
      setShareOpen(true);
      setShareStatus("Select and copy the text below.");
    }
  }
  function download(text: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJson() {
    const r = serializePlan(plan());
    if (r.ok)
      download(r.value, `lastz-${plan().server}-plan.json`, "application/json");
    else notify(r.error);
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) {
        notify("Plan file must be under 2 MiB.");
        return;
      }
      const r = parsePlan(await file.text());
      if (!r.ok) {
        notify(r.error);
        return;
      }
      commit((p) => Object.assign(p, r.value));
      setSelected(null);
      setGroup(r.value.groups[0].id);
      notify(`Imported ${r.value.name}. Undo restores your previous plan.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not read this plan file.");
    } finally {
      input.value = "";
    }
  }

  async function share() {
    setShareOpen(true);
    setShareStatus("Preparing a self-contained plan link…");
    setShareUrl("");
    const r = await createShareFragment(plan());
    if (r.ok) {
      setShareUrl(`${location.origin}${location.pathname}${r.value}`);
      setShareStatus(
        "Anyone with this link receives a copy of this plan. Changes stay on their device.",
      );
    } else setShareStatus(r.error);
  }
  onMount(() => {
    const r = loadLocalPlan();
    if (r.ok && r.value) {
      setPlan(r.value);
      setGroup(r.value.groups[0].id);
      setSaved("Restored locally");
      setCanSave(true);
    } else if (!r.ok) {
      setSaved("Saved data needs attention");
      notify(r.error);
    } else setCanSave(true);
    setReady(true);
    if (location.hash.startsWith("#lz1=")) {
      parseShareFragment(location.hash).then((result) => {
        if (result.ok) {
          commit((p) => Object.assign(p, result.value));
          setGroup(result.value.groups[0].id);
          window.history.replaceState(
            null,
            "",
            location.pathname + location.search,
          );
          notify("Shared plan opened. Undo returns to your local plan.");
        } else notify(result.error);
      });
    }
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable], [role="dialog"]',
        )
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (e.key === "Escape") {
        setDraft([]);
        setRisk(null);
        setTool("select");
        setSelected(null);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === "Enter" && tool() === "boundary") finishBoundary(true);
      const found = tools.find(
        (t) => t.key.toLowerCase() === e.key.toLowerCase(),
      );
      if (found && !e.metaKey && !e.ctrlKey) useTool(found.id);
    };
    window.addEventListener("keydown", key);
    onCleanup(() => {
      window.removeEventListener("keydown", key);
      clearTimeout(noticeTimer);
    });
  });
  createEffect(() => {
    if (strategy() !== "regular" && !registry().get(strategy()))
      setStrategy("regular");
    plan();
    selected();
    xInput();
    yInput();
    strategy();
    formation();
    group();
    rotation();
    setFillPreview(null);
  });
  createEffect(() => {
    const p = plan();
    if (!ready() || !canSave()) return;
    const result = saveLocalPlan(p);
    setSaved(result.ok ? "Saved on this device" : "Save failed");
    if (!result.ok) notify(result.error);
  });
  const summary = createMemo(() => ({
    hq: plan().placements.filter((p) => p.kind === "hq").length,
    blockers: plan().placements.filter((p) => p.kind !== "hq").length,
  }));
  return (
    <div class="planner-shell">
      <header class="topbar">
        <a class="brand" href="/" aria-label="Fieldwork home">
          <span class="brand-mark">
            <Hexagon size={25} />
            <span />
          </span>
          <span>
            FIELDWORK<span class="brand-divider">/</span>
            <span class="brand-sub">LAST Z</span>
          </span>
        </a>
        <nav class="top-context">
          <span class="live-dot" />
          SVS map planner
          <span class="context-divider" />
          STATE {plan().server}
        </nav>
        <div class="header-actions">
          <span class="save-state">
            <Check size={13} />
            {saved()}
          </span>
          <ToolButton label="Import plan" onClick={() => input.click()}>
            <Upload size={17} />
          </ToolButton>
          <button class="button subtle export-button" onClick={exportJson}>
            <Download size={15} />
            Export
          </button>
          <button class="button primary" onClick={share}>
            <Share2 size={15} />
            Share plan
          </button>
          <button
            class="icon-button mobile-toggle"
            aria-label="Toggle planning panel"
            onClick={() => setMobilePanel(!mobilePanel())}
          >
            <Menu size={20} />
          </button>
        </div>
      </header>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void importFile(e.currentTarget.files?.[0])}
      />
      <div class="workspace">
        <main class="map-workspace" aria-label="Planning canvas">
          <Show
            when={ready()}
            fallback={<div class="loading-map">Preparing the world…</div>}
          >
            <WorldMap
              plan={plan()}
              tool={tool()}
              selectedId={selected()}
              terrainAt={terrain().display}
              preview={fillPreview()?.placements ?? preview()}
              previewValid={fillPreview() ? true : !previewIssues().length}
              boundaryDraft={draft()}
              measure={measure()}
              riskTiles={risk()?.witnessPair ?? []}
              onHover={setHover}
              onClick={clickMap}
              onMove={move}
              onSelect={(id) => {
                setSelected(id);
                setTab("inspect");
                setRisk(null);
                setFillPreview(null);
              }}
              onMoveBoundary={(id, points) =>
                commit((p) => {
                  p.boundaries.find((b) => b.id === id)!.points = points;
                })
              }
              onEraseBoundary={(id) => {
                commit((p) => {
                  p.boundaries = p.boundaries.filter((b) => b.id !== id);
                });
                if (selected() === id) setSelected(null);
              }}
              onCamera={setCamera}
              api={(v) => (map = v)}
            />
          </Show>
          <div class="map-heading">
            <div class="eyebrow">OPERATIONS / SVS</div>
            <input
              aria-label="Plan name"
              class="plan-title"
              value={plan().name}
              onChange={(e) =>
                commit((p) => {
                  p.name = e.currentTarget.value;
                })
              }
            />
            <div class="heading-meta">
              <span>Server {plan().server}</span>
              <span>1,000 × 1,000 tiles</span>
              <button
                class="reference-badge"
                onClick={() => {
                  setTab("layers");
                  setMobilePanel(true);
                }}
              >
                Cached terrain ↗
              </button>
            </div>
          </div>
          <div class="map-toolbar" aria-label="Map tools">
            <For each={tools}>
              {(item) => (
                <ToolButton
                  label={`${item.label} · ${item.key}`}
                  active={tool() === item.id}
                  onClick={() => useTool(item.id)}
                >
                  <item.icon size={19} />
                </ToolButton>
              )}
            </For>
            <span class="toolbar-divider" />
            <ToolButton
              label="Undo · ⌘Z"
              disabled={!history().length}
              onClick={undo}
            >
              <Undo2 size={18} />
            </ToolButton>
            <ToolButton
              label="Redo · ⇧⌘Z"
              disabled={!future().length}
              onClick={redo}
            >
              <Redo2 size={18} />
            </ToolButton>
          </div>
          <Show when={tool() === "boundary"}>
            <div class="floating-instruction">
              <Pentagon size={16} />
              <span>
                Click the corners of your wedge. <b>{draft().length} points</b>
              </span>
              <button
                class="text-button"
                disabled={draft().length < 3}
                onClick={() => finishBoundary(true)}
              >
                Close wedge
              </button>
              <button
                class="text-button"
                disabled={draft().length < 2}
                onClick={() => finishBoundary(false)}
              >
                Save line
              </button>
            </div>
          </Show>
          <Show when={tool() === "measure"}>
            <div class="floating-instruction">
              <Ruler size={16} />
              <span>
                {measure().length === 2
                  ? `${distance(measure()[0], measure()[1])} hex steps · straight grid distance`
                  : "Click a start and end tile to measure."}
              </span>
            </div>
          </Show>
          <Show when={!plan().placements.length && tool() === "select"}>
            <div class="canvas-empty">
              <span class="mini-eyebrow">A CLEAR PLAN. A STRONGER FRONT.</span>
              <h2>Make every tile count.</h2>
              <p>
                Map your wedge, build your formation,
                <br />
                and give everyone a place.
              </p>
              <button
                class="button primary"
                onClick={() => {
                  useTool("hq");
                  setTab("plan");
                }}
              >
                <Plus size={16} />
                Place your first HQ
                <ArrowUpRight size={16} />
              </button>
              <button
                class="empty-secondary"
                onClick={() => useTool("boundary")}
              >
                Start with a boundary <ChevronRight size={14} />
              </button>
            </div>
          </Show>
          <Show when={previewIssues().length && preview().length}>
            <div class="placement-feedback">
              <AlertTriangle size={15} />
              {previewIssues()[0]}
            </div>
          </Show>
          <div class="map-controls">
            <ToolButton label="Zoom in" onClick={() => map?.zoomBy(1.25)}>
              <Plus size={18} />
            </ToolButton>
            <span>{Math.round(camera().zoom * 100)}%</span>
            <ToolButton label="Zoom out" onClick={() => map?.zoomBy(0.8)}>
              <Minus size={18} />
            </ToolButton>
            <span class="control-divider" />
            <ToolButton
              label="View entire world"
              onClick={() => map?.fitWorld()}
            >
              <Maximize size={17} />
            </ToolButton>
            <ToolButton
              label="Go to palace"
              onClick={() => map?.focus(PALACE, 0.65)}
            >
              <Crosshair size={17} />
            </ToolButton>
          </div>
          <div class="map-legend">
            <span>
              <i class="grass" />
              Grass
            </span>
            <span>
              <i class="mud" />
              Mud
            </span>
            <span>
              <i class="restricted" />
              Restricted
            </span>
            <span class="legend-note">
              {camera().zoom <= 0.3
                ? "Generalized overview"
                : "Cached normal world"}
            </span>
          </div>
          <div class="map-status">
            <span>
              <MapPin size={12} />
              {hover()
                ? `X: ${hover()!.x}   Y: ${hover()!.y}`
                : "Hover to inspect a tile"}
            </span>
            <span class="status-tool">
              {tools.find((t) => t.id === tool())?.label}
              <span>·</span>Scroll to zoom · Space + drag to pan
            </span>
            <span>
              {summary().hq} HQs · {summary().blockers} blockers
            </span>
          </div>
        </main>
        <aside
          class={`side-panel ${mobilePanel() ? "mobile-open" : ""}`}
          aria-label="Plan controls"
        >
          <Show when={planIssues().length}>
            <button
              class="plan-review-banner"
              onClick={() => {
                setSelected(planIssues()[0].id);
                setTab("inspect");
                map?.focus(
                  plan().placements.find((p) => p.id === planIssues()[0].id)!,
                );
              }}
            >
              <AlertTriangle size={14} />
              {planIssues().length} positions need review
              <ChevronRight size={14} />
            </button>
          </Show>
          <div class="panel-heading">
            <div>
              <span class="eyebrow">YOUR BATTLE PLAN</span>
              <h1>Plan the advantage.</h1>
            </div>
            <span class="plan-icon">
              <Hexagon size={20} />
            </span>
          </div>
          <Tabs.Root
            value={tab()}
            onValueChange={(d) => setTab(d.value)}
            class="panel-tabs"
          >
            <Tabs.List>
              <Tabs.Trigger value="plan">Build</Tabs.Trigger>
              <Tabs.Trigger value="inspect">
                Inspect{" "}
                <Show when={selected()}>
                  <span class="tab-dot" />
                </Show>
              </Tabs.Trigger>
              <Tabs.Trigger value="layers">Layers</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="plan">
              <div class="panel-section">
                <div class="section-label">
                  PLACEMENT STRATEGY
                  <Settings2 size={13} />
                </div>
                <label class="field">
                  <span>Pattern</span>
                  <select
                    value={strategy()}
                    onChange={(e) =>
                      setStrategy(e.currentTarget.value as Strategy)
                    }
                  >
                    <option value="regular">Standard spacing</option>
                    <option value="mud-tight">Mud · optimized stagger</option>
                    <option value="grass-wide">Grass · wide stagger</option>
                    <For each={plan().strategies}>
                      {(s) => <option value={s.id}>{s.name}</option>}
                    </For>
                  </select>
                </label>
                <Show
                  when={strategy() === "regular"}
                  fallback={
                    <p class="field-help">{activeStrategy().description}</p>
                  }
                >
                  <div
                    class="segmented"
                    role="group"
                    aria-label="Placement spacing"
                  >
                    <For each={["tile", "tight", "loose"] as const}>
                      {(s) => (
                        <button
                          classList={{ active: plan().settings.spacing === s }}
                          onClick={() => setting("spacing", s)}
                        >
                          <span>
                            {s === "tile"
                              ? "By tile"
                              : s === "tight"
                                ? "Tight"
                                : "Loose"}
                          </span>
                          <small>
                            {s === "tile"
                              ? "No gap"
                              : s === "tight"
                                ? "1 tile gap"
                                : "2 tile gap"}
                          </small>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <StrategyEditor
                  strategies={plan().strategies}
                  onSave={(values) =>
                    commit((p) => {
                      p.strategies = values;
                    })
                  }
                  onSelect={setStrategy}
                  onNotice={notify}
                />
                <label class="field">
                  <span>Formation</span>
                  <select
                    value={formation()}
                    onChange={(e) => {
                      setFormation(e.currentTarget.value as Formation);
                      useTool("hq");
                    }}
                  >
                    <option value="single">Single headquarters</option>
                    <option value="daisy">Daisy · center + 6 HQs</option>
                    <option value="grass">Grass group · 3 × 4</option>
                    <option value="mud">Mud group · 3 × 4</option>
                  </select>
                </label>
                <Show when={formation() !== "single"}>
                  <button
                    class="button full subtle"
                    onClick={() => setRotation((rotation() + 1) % 6)}
                  >
                    <MoveUpRight size={15} />
                    Rotate formation · {rotation() * 60}°
                  </button>
                </Show>
                <div class="footprint-note">
                  <span class="seven-dot">⬡</span>
                  <span>
                    Every HQ occupies <b>7 hex tiles.</b>
                    <br />
                    Full footprints snap to the world grid.
                  </span>
                </div>
              </div>
              <div class="panel-section">
                <div class="section-label">
                  DEPLOYMENT GROUPS
                  <button
                    class="tiny-button"
                    aria-label="Add group"
                    onClick={() => {
                      const id = crypto.randomUUID();
                      commit((p) =>
                        p.groups.push({
                          id,
                          name: `Group ${p.groups.length + 1}`,
                          color: "#97c7ee",
                        }),
                      );
                      setGroup(id);
                    }}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <div class="group-list">
                  <For each={plan().groups}>
                    {(g) => (
                      <button
                        class={`group-row ${activeGroup().id === g.id ? "selected" : ""}`}
                        onClick={() => setGroup(g.id)}
                      >
                        <span
                          class="group-color"
                          style={{ background: g.color }}
                        />
                        <span>{g.name}</span>
                        <span class="group-count">
                          {
                            plan().placements.filter((p) => p.groupId === g.id)
                              .length
                          }
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </For>
                </div>
                <div class="group-edit">
                  <input
                    aria-label="Group color"
                    type="color"
                    value={activeGroup().color}
                    onChange={(e) =>
                      commit((p) => {
                        p.groups.find((g) => g.id === activeGroup().id)!.color =
                          e.currentTarget.value;
                      })
                    }
                  />
                  <input
                    aria-label="Group name"
                    value={activeGroup().name}
                    onChange={(e) =>
                      commit((p) => {
                        p.groups.find((g) => g.id === activeGroup().id)!.name =
                          e.currentTarget.value;
                      })
                    }
                  />
                </div>
              </div>
              <div class="panel-section">
                <div class="section-label">ADD TO THE MAP</div>
                <div class="placement-buttons">
                  <button
                    classList={{ active: tool() === "hq" }}
                    onClick={() => useTool("hq")}
                  >
                    <Hexagon size={22} />
                    <span>Headquarters</span>
                    <kbd>B</kbd>
                  </button>
                  <button
                    classList={{ active: tool() === "food" }}
                    onClick={() => useTool("food")}
                  >
                    <Wheat size={21} />
                    <span>Food blocker</span>
                    <kbd>F</kbd>
                  </button>
                  <button
                    classList={{ active: tool() === "wood" }}
                    onClick={() => useTool("wood")}
                  >
                    <TreePine size={21} />
                    <span>Wood blocker</span>
                    <kbd>W</kbd>
                  </button>
                  <button
                    classList={{ active: tool() === "boundary" }}
                    onClick={() => useTool("boundary")}
                  >
                    <Pentagon size={21} />
                    <span>Boundary</span>
                    <kbd>L</kbd>
                  </button>
                </div>
              </div>
              <div class="panel-section">
                <div class="section-label">COORDINATES</div>
                <div class="coordinate-fields">
                  <label>
                    X
                    <input
                      aria-label="X coordinate"
                      inputmode="numeric"
                      value={xInput()}
                      onInput={(e) => setXInput(e.currentTarget.value)}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      aria-label="Y coordinate"
                      inputmode="numeric"
                      value={yInput()}
                      onInput={(e) => setYInput(e.currentTarget.value)}
                    />
                  </label>
                  <button
                    class="icon-button"
                    aria-label="Go to coordinates"
                    onClick={() => {
                      const t = typedTile();
                      if (t) map?.focus(t);
                    }}
                  >
                    <Crosshair size={18} />
                  </button>
                </div>
                <button
                  class="button full subtle"
                  onClick={() => {
                    const t = typedTile();
                    if (t) {
                      if (!["hq", "food", "wood"].includes(tool()))
                        setTool("hq");
                      placeAt(t);
                    }
                  }}
                >
                  <Plus size={15} />
                  Place at coordinates
                </button>
              </div>
            </Tabs.Content>
            <Tabs.Content value="inspect">
              <Show
                when={selectedPlacement()}
                fallback={
                  <Show
                    when={selectedBoundary()}
                    fallback={
                      <div class="inspector-empty">
                        <MousePointer2 size={28} />
                        <h3>Select a position.</h3>
                        <p>
                          Click an HQ, blocker, or boundary to edit its details.
                        </p>
                      </div>
                    }
                  >
                    {(b) => (
                      <div class="panel-section">
                        <div class="section-label">
                          {b().closed ? "WEDGE" : "BOUNDARY"}
                        </div>
                        <label class="field">
                          <span>Name</span>
                          <input
                            value={b().name}
                            onChange={(e) =>
                              commit((p) => {
                                p.boundaries.find(
                                  (v) => v.id === b().id,
                                )!.name = e.currentTarget.value;
                              })
                            }
                          />
                        </label>
                        <p class="field-help">
                          {b().points.length} vertices. Drag a vertex to
                          reshape, or drag a line to move the boundary.
                        </p>
                        <Show when={b().closed}>
                          <div class="fill-card">
                            <div class="section-label">SMART FILL</div>
                            <p class="field-help">
                              {activeStrategy().name} · {activeGroup().name}.
                              Change the pattern in Build. Coordinates set the
                              lattice anchor.
                            </p>
                            <div class="coordinate-fields">
                              <label>
                                X
                                <input
                                  aria-label="Fill anchor X"
                                  value={xInput()}
                                  onInput={(e) =>
                                    setXInput(e.currentTarget.value)
                                  }
                                />
                              </label>
                              <label>
                                Y
                                <input
                                  aria-label="Fill anchor Y"
                                  value={yInput()}
                                  onInput={(e) =>
                                    setYInput(e.currentTarget.value)
                                  }
                                />
                              </label>
                            </div>
                            <button
                              class="button subtle full"
                              onClick={previewFill}
                            >
                              <Layers size={15} />
                              Preview smart placement
                            </button>
                            <Show when={fillPreview()}>
                              {(f) => (
                                <div class="fill-result">
                                  <strong>
                                    {f().accepted} positions fit the current
                                    rules
                                  </strong>
                                  <Show when={f().provisional}>
                                    <p class="field-help">
                                      {f().provisional} positions use
                                      provisional terrain.
                                    </p>
                                  </Show>
                                  <p class="field-help">
                                    Skipped: {f().rejected.boundary} outside
                                    wedge · {f().rejected.terrain} terrain ·{" "}
                                    {f().rejected.collision +
                                      f().rejected.spacing}{" "}
                                    collision / spacing.
                                  </p>
                                  <Show when={f().truncated}>
                                    <p class="field-help">
                                      Preview capped at 250 placements / 4,000
                                      candidates. Narrow the wedge to inspect
                                      the rest.
                                    </p>
                                  </Show>
                                  <button
                                    class="button primary full"
                                    disabled={!f().accepted}
                                    onClick={applyFill}
                                  >
                                    Apply {f().accepted} positions
                                  </button>
                                  <button
                                    class="button subtle full"
                                    onClick={() => setFillPreview(null)}
                                  >
                                    Discard preview
                                  </button>
                                </div>
                              )}
                            </Show>
                          </div>
                        </Show>
                        <button
                          class="button danger full"
                          onClick={deleteSelected}
                        >
                          <Trash2 size={15} />
                          Delete boundary
                        </button>
                      </div>
                    )}
                  </Show>
                }
              >
                {(p) => (
                  <>
                    <div class="panel-section">
                      <div class="section-label">
                        {p().kind === "hq"
                          ? "HEADQUARTERS"
                          : `ALLIANCE ${p().kind.toUpperCase()}`}
                        <span class="pill">7 tiles</span>
                      </div>
                      <Show when={planIssues().find((v) => v.id === p().id)}>
                        {(issue) => (
                          <div class="reference-card">
                            <strong>Placement needs review</strong>
                            <p>{issue().issues.join(" ")}</p>
                          </div>
                        )}
                      </Show>
                      <label class="field">
                        <span>Assignment / player name</span>
                        <input
                          value={p().name}
                          onChange={(e) =>
                            commit((d) => {
                              d.placements.find((v) => v.id === p().id)!.name =
                                e.currentTarget.value;
                            })
                          }
                        />
                      </label>
                      <label class="field">
                        <span>Group</span>
                        <select
                          value={p().groupId}
                          onChange={(e) =>
                            commit((d) => {
                              d.placements.find(
                                (v) => v.id === p().id,
                              )!.groupId = e.currentTarget.value;
                            })
                          }
                        >
                          <For each={plan().groups}>
                            {(g) => <option value={g.id}>{g.name}</option>}
                          </For>
                        </select>
                      </label>
                      <button
                        class="coordinate-copy"
                        onClick={() =>
                          copy(coordinateToken(p(), plan().server))
                        }
                      >
                        <span>
                          X: <b>{p().x}</b>
                          <span>
                            Y: <b>{p().y}</b>
                          </span>
                        </span>
                        <Copy size={15} />
                      </button>
                      <p class="field-help">
                        Click to copy the in-game coordinate token.
                      </p>
                      <div class="coordinate-fields">
                        <label>
                          X
                          <input
                            aria-label="Move X coordinate"
                            value={xInput()}
                            onInput={(e) => setXInput(e.currentTarget.value)}
                          />
                        </label>
                        <label>
                          Y
                          <input
                            aria-label="Move Y coordinate"
                            value={yInput()}
                            onInput={(e) => setYInput(e.currentTarget.value)}
                          />
                        </label>
                        <button
                          class="icon-button"
                          aria-label="Move selected placement"
                          onClick={() => {
                            const t = typedTile();
                            if (t) move(p().id, t);
                          }}
                        >
                          <MoveUpRight size={18} />
                        </button>
                      </div>
                      <p class="field-help">
                        Moving uses the active pattern: {activeStrategy().name}.
                      </p>
                      <Toggle
                        label="Show building symbol"
                        checked={p().showGraphic}
                        onChange={(v) =>
                          commit((d) => {
                            d.placements.find(
                              (q) => q.id === p().id,
                            )!.showGraphic = v;
                          })
                        }
                      />
                    </div>
                    <Show when={p().kind === "hq"}>
                      <div class="panel-section">
                        <div class="section-label">
                          SINGLE-LOSS CHECK
                          <Shield size={14} />
                        </div>
                        <p class="field-help">
                          If this HQ is zeroed, can two non-overlapping enemy
                          HQs use the newly opened space?
                        </p>
                        <button class="button full subtle" onClick={analyze}>
                          <Shield size={15} />
                          Check replacement risk
                        </button>
                        <Show when={risk()}>
                          {(r) => (
                            <div
                              class={`risk-result ${r().risk === "two-fit" ? "risk-high" : ""}`}
                            >
                              <strong>
                                {r().unknownTiles.length &&
                                !plan().settings.allowUnknown
                                  ? "Terrain incomplete"
                                  : r().risk === "two-fit"
                                    ? "Two HQs can fit"
                                    : r().risk === "one-fit"
                                      ? "One HQ fits the new opening"
                                      : "No newly legal center"}
                              </strong>
                              <p>
                                {r().newlyEnabled.length} newly opened centers ·{" "}
                                {r().existingOpen.length} pre-existing nearby
                                openings.
                              </p>
                              <Show when={r().witnessPair}>
                                <p>
                                  The orange footprints show a two-HQ witness.
                                </p>
                              </Show>
                              <small>
                                {plan().settings.allowUnknown
                                  ? "Provisional terrain. "
                                  : ""}
                                Local geometry only. All other buildings remain.
                                Outer gaps and multiple losses need separate
                                review.
                              </small>
                            </div>
                          )}
                        </Show>
                      </div>
                    </Show>
                    <div class="panel-section">
                      <div class="confidence-line">
                        <AlertTriangle size={14} />
                        {footprint(p()).every((t) => terrain().verified(t))
                          ? "User-mapped terrain"
                          : "Cached terrain · verify in game"}
                      </div>
                      <Show when={p().kind !== "hq"}>
                        <p class="field-help">
                          Leader/rally range and event availability must also be
                          verified in game.
                        </p>
                      </Show>
                      <button
                        class="button danger full"
                        onClick={deleteSelected}
                      >
                        <Trash2 size={15} />
                        Remove position
                      </button>
                    </div>
                  </>
                )}
              </Show>
              <div class="panel-section">
                <div class="section-label">
                  POSITIONS & BOUNDARIES
                  <span class="pill">
                    {plan().placements.length + plan().boundaries.length}
                  </span>
                </div>
                <div class="position-list">
                  <For each={plan().placements}>
                    {(p) => (
                      <button
                        classList={{ selected: selected() === p.id }}
                        onClick={() => {
                          setSelected(p.id);
                          setXInput(String(p.x));
                          setYInput(String(p.y));
                          setRisk(null);
                          map?.focus(p);
                        }}
                      >
                        <span
                          class="group-color"
                          style={{
                            background: plan().groups.find(
                              (g) => g.id === p.groupId,
                            )?.color,
                          }}
                        />
                        <span>
                          {p.name}
                          <small>
                            {p.x}, {p.y}
                          </small>
                        </span>
                        <ChevronRight size={13} />
                      </button>
                    )}
                  </For>
                  <For each={plan().boundaries}>
                    {(b) => (
                      <button
                        onClick={() => {
                          setSelected(b.id);
                          map?.focus(b.points[0]);
                        }}
                      >
                        <Pentagon size={14} />
                        <span>{b.name}</span>
                        <ChevronRight size={13} />
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Tabs.Content>
            <Tabs.Content value="layers">
              <div class="panel-section">
                <div class="section-label">MAP DISPLAY</div>
                <Toggle
                  label="Hex grid"
                  detail="Exact odd-row world coordinates"
                  checked={plan().settings.showGrid}
                  onChange={(v) => setting("showGrid", v)}
                />
                <Toggle
                  label="Assignment labels"
                  checked={plan().settings.showLabels}
                  onChange={(v) => setting("showLabels", v)}
                />
                <Toggle
                  label="Building symbols"
                  detail="Simple icons over seven-tile footprints"
                  checked={plan().settings.showGraphics}
                  onChange={(v) => setting("showGraphics", v)}
                />
              </div>
              <div class="panel-section">
                <div class="section-label">
                  TERRAIN CONFIDENCE
                  <AlertTriangle size={14} />
                </div>
                <div class="reference-card">
                  <strong>Decoded normal-world baseline.</strong>
                  <p>
                    Includes the installed map’s 43,279 static blocked tiles, 90
                    city exclusion zones, and mud rules from the November 4
                    cache. Server 802’s active season and live occupancy are not
                    yet confirmed.
                  </p>
                </div>
                <Toggle
                  label="Use cached normal-world terrain"
                  detail="Provisional until the active season is confirmed"
                  checked={plan().settings.allowUnknown}
                  onChange={(v) => setting("allowUnknown", v)}
                />
                <p class="field-help">
                  With this off, only your mapped cells are accepted. Current
                  buildings, events and alliance leader range still need in-game
                  verification.
                </p>
              </div>
              <div class="panel-section">
                <div class="section-label">MAP A TERRAIN CELL</div>
                <label class="field">
                  <span>Terrain classification</span>
                  <select
                    value={paint()}
                    onChange={(e) => setPaint(e.currentTarget.value as Terrain)}
                  >
                    <option value="restricted">Restricted / obstacle</option>
                    <option value="grass">Grass</option>
                    <option value="mud">Mud</option>
                    <option value="unknown">Unverified</option>
                  </select>
                </label>
                <button
                  class={`button full ${tool() === "terrain" ? "primary" : "subtle"}`}
                  onClick={() => useTool("terrain")}
                >
                  <Layers size={15} />
                  Mark cells on map
                </button>
                <p class="field-help">
                  Click each verified tile. {plan().terrainOverrides.length}{" "}
                  mapped cells are stored with this plan. Undo removes your last
                  edit.
                </p>
              </div>
              <div class="panel-section">
                <div class="section-label">EXPORT & REFERENCE</div>
                <button
                  class="button full subtle"
                  onClick={() =>
                    download(
                      exportAssignmentsCsv(plan()),
                      `lastz-${plan().server}-assignments.csv`,
                      "text/csv",
                    )
                  }
                >
                  <Download size={15} />
                  Assignment spreadsheet (.csv)
                </button>
                <button
                  class="button full subtle"
                  onClick={() => map?.exportImage()}
                >
                  <Download size={15} />
                  Current map image (.png)
                </button>
                <button
                  class="button full subtle"
                  onClick={() => map?.fitWorld()}
                >
                  <Maximize size={15} />
                  View the entire world
                </button>
                <p class="field-help">
                  Movement measurements show hex distance, not game march time
                  or pathfinding.
                </p>
              </div>
            </Tabs.Content>
          </Tabs.Root>
          <div class="panel-footer">
            <span class="mini-grid">⬡</span>
            <span>
              Small footprints.
              <br />
              <b>Better battle plans.</b>
            </span>
            <span class="version">v0.1</span>
          </div>
        </aside>
      </div>
      <Show when={notice()}>
        <div class="toast" role="status">
          <span>{notice()}</span>
          <button
            class="tiny-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      </Show>
      <Dialog.Root
        open={shareOpen()}
        onOpenChange={(d) => setShareOpen(d.open)}
      >
        <Portal>
          <Dialog.Backdrop class="dialog-backdrop" />
          <Dialog.Positioner class="dialog-positioner">
            <Dialog.Content class="dialog-content">
              <div class="dialog-heading">
                <Share2 size={22} />
                <Dialog.CloseTrigger
                  class="icon-button"
                  aria-label="Close share dialog"
                >
                  <X size={20} />
                </Dialog.CloseTrigger>
              </div>
              <Dialog.Title>Share the plan.</Dialog.Title>
              <Dialog.Description>{shareStatus()}</Dialog.Description>
              <Show when={shareUrl()}>
                <textarea
                  aria-label="Shareable plan link"
                  readonly
                  value={shareUrl()}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  class="button primary full"
                  onClick={() => copy(shareUrl())}
                >
                  <Copy size={15} />
                  Copy link
                </button>
              </Show>
              <button class="button subtle full" onClick={exportJson}>
                <Download size={15} />
                Download plan file
              </button>
              <p class="field-help">
                Includes assignments, boundaries, mapped terrain and display
                settings. No account required.
              </p>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </div>
  );
}
