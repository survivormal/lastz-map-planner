import {
  distance,
  footprint,
  footprintInBoundary,
  inWorld,
  key,
  type Tile,
} from "./geometry";
import {
  SafetyIndex,
  auditIndex,
  type PlacementSafetyAudit,
  type PlacementSafetyEntry,
} from "./edge-safety";
import { nearestPlotSites } from "./plot";
import {
  smartFillBoundary,
  validatedClosedBoundary,
  boundaryFillAnchor,
  StrategySchema,
  type Strategy,
} from "./strategies";
import type { TerrainLookup } from "./placement";
import type { Placement } from "./schema";
import { minimizeBoundaryPacking } from "./boundary-minimizer";

export type BoundaryOptimizationOptions = {
  objective?: "repair" | "fewest";
  /** Fewest mode only; assigned inside HQs may be removed only when explicitly false. */
  preserveExisting?: boolean;
  /** Bounded coordinated-repacking search nodes in fewest mode. */
  maxMinimizationNodes?: number;
  boundary: readonly Tile[];
  anchor: Tile;
  strategy: Strategy;
  mirrored?: boolean;
  placements: readonly Placement[];
  terrainAt: TerrainLookup;
  groupId: string;
  namePrefix?: string;
  allowUnknown?: boolean;
  maxCandidates?: number;
  maxPlacements?: number;
  maxEvaluations?: number;
  maxPasses?: number;
};
export type BoundaryOptimizationMetrics = {
  twoFit: number;
  /** Candidate centers, not the number of simultaneously placeable enemy HQs. */
  openCenters: number;
  uncertain: number;
  invalid: number;
};
export type BoundaryOptimizationResult = {
  objective: "repair" | "fewest";
  /** Every possible enemy HQ center inside the boundary was included in the scan. */
  coverageComplete: boolean;
  /** Complete proposed plan, including all unchanged fixed placements. */
  placements: Placement[];
  before: BoundaryOptimizationMetrics;
  after: BoundaryOptimizationMetrics;
  audit: PlacementSafetyAudit;
  movedIds: string[];
  removedIds: string[];
  addedIds: string[];
  scopedIds: string[];
  status: "resolved" | "improved" | "unchanged" | "blocked";
  truncated: boolean;
  reason: string;
  evaluated: number;
  passes: number;
  seedCount: number;
  seedAddedCount: number;
  outsideTwoFitBefore: number;
  outsideTwoFitAfter: number;
  openCenterSamples: Tile[];
};

const MAX_SCOPE = 500;
const MAX_EVALUATIONS = 12_000;
const MAX_PASSES = 96;
function bound(
  value: number | undefined,
  fallback: number,
  maximum: number,
  allowZero = false,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < (allowZero ? 0 : 1))
    throw new RangeError("Optimization limits must be bounded whole numbers.");
  return Math.min(selected, maximum);
}
function pairCount(entry: PlacementSafetyEntry): number {
  const sites = entry.analysis.newlyEnabled;
  let count = 0;
  for (let i = 0; i < sites.length; i++)
    for (let j = 0; j < i; j++) if (distance(sites[i], sites[j]) >= 3) count++;
  return count;
}
type Score = [number, number, number, number];
function compare(a: Score, b: Score): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * A bounded packing search: compare complete strategy/dense lattice seeds, reassign the
 * existing HQ identities, then coordinate local moves and infill. Boundaries constrain
 * friendly destinations only; loss analysis always sees terrain and buildings outside.
 */
function repairBoundaryFill(
  options: BoundaryOptimizationOptions,
): BoundaryOptimizationResult {
  StrategySchema.parse(options.strategy);
  if (!options.groupId.trim() || options.groupId.length > 120)
    throw new RangeError("A valid placement group is required.");
  const boundary = validatedClosedBoundary(options.boundary);
  const maxCandidates = bound(options.maxCandidates, 4000, 20_000);
  const maxNew = Math.min(
    bound(options.maxPlacements, 250, 1000, true),
    Math.max(0, 5000 - options.placements.length),
  );
  const maxEvaluations = bound(
    options.maxEvaluations,
    8000,
    MAX_EVALUATIONS,
    true,
  );
  const maxPasses = bound(options.maxPasses, 48, MAX_PASSES, true);
  const original = options.placements.map((p) => ({ ...p }));
  const originals = new Map(original.map((p) => [p.id, p]));
  const initialIndex = new SafetyIndex(original, options.terrainAt);
  const originalAudit = auditIndex(initialIndex, false);
  const originalScope = original.filter(
    (p) => p.kind === "hq" && footprintInBoundary(p, boundary),
  );
  const movableIds = new Set(originalScope.map((p) => p.id));
  const fixed = original.filter((p) => !movableIds.has(p.id));
  const protectedIds = new Set(
    originalAudit.entries
      .filter(
        (entry) =>
          entry.confidence === "known" &&
          !entry.placementIssues.length &&
          entry.analysis.risk !== "two-fit",
      )
      .map((entry) => entry.placementId),
  );
  // User planning rule: an HQ touching any mud tile remains a mud HQ. This is
  // intentionally broader than exact strategy-fill's all-mud footprint rule.
  const categoryAt = (tile: Tile): "grass" | "mud" | null => {
    if (!initialIndex.facts(tile).legalKnown) return null;
    return footprint(tile).some((cell) => initialIndex.terrain(cell) === "mud")
      ? "mud"
      : "grass";
  };
  const categories = new Map(originalScope.map((p) => [p.id, categoryAt(p)]));
  const fixedIndex = new SafetyIndex(fixed, options.terrainAt);
  const names = new Set(
    original.filter((p) => p.groupId === options.groupId).map((p) => p.name),
  );
  const ids = new Set(original.map((p) => p.id));
  const templates: Placement[] = [];
  let nextId = 1,
    nextName = 1;
  for (let i = 0; i < maxNew; i++) {
    let id: string, name: string;
    do {
      id = `boundary-auto-${nextId++}`;
    } while (ids.has(id));
    do {
      name = `${options.namePrefix?.trim() || options.strategy.name} ${String(nextName++).padStart(2, "0")}`;
    } while (names.has(name));
    ids.add(id);
    names.add(name);
    if (name.length > 160)
      throw new RangeError("The generated placement name is too long.");
    templates.push({
      id,
      name,
      groupId: options.groupId,
      kind: "hq",
      showGraphic: false,
      x: 0,
      y: 0,
    });
  }
  let nextSeed = 0;
  const seeded = maxNew
    ? smartFillBoundary({
        ...options,
        boundary,
        placements: original,
        allowUnknown: false,
        maxCandidates,
        maxPlacements: maxNew,
        makeId: () => templates[nextSeed++].id,
      })
    : { placements: [], truncated: false };
  const baseline = [...original, ...seeded.placements];
  const seedScopeIds = new Set([
    ...movableIds,
    ...seeded.placements.map((p) => p.id),
  ]);
  const seedCount = seedScopeIds.size;
  const origin = boundaryFillAnchor(boundary);
  const candidateBudget = Math.min(
    maxCandidates,
    Math.max(100, Math.floor(400_000 / boundary.length)),
  );
  const scan = nearestPlotSites(
    {
      anchor: { x: 0, y: 0 },
      basis: [
        { q: 1, r: 0 },
        { q: 0, r: 1 },
      ],
    },
    {
      minX: Math.min(...boundary.map((p) => p.x)) - 1,
      maxX: Math.max(...boundary.map((p) => p.x)) + 1,
      minY: Math.min(...boundary.map((p) => p.y)),
      maxY: Math.max(...boundary.map((p) => p.y)),
    },
    origin,
    candidateBudget,
  );
  const candidates = scan.sites
    .map((site) => site.tile)
    .filter((tile) => footprintInBoundary(tile, boundary));
  const unknownCenters = candidates.filter(
    (tile) =>
      initialIndex.facts(tile).legalProvisional &&
      !initialIndex.facts(tile).legalKnown,
  ).length;
  const legal = candidates.filter(
    (tile) => initialIndex.facts(tile).legalKnown,
  );
  const legalKeys = new Set(legal.map(key));
  const newLegal = (tile: Tile) =>
    initialIndex.facts(tile).legalKnown &&
    (options.strategy.terrain === "any" ||
      categoryAt(tile) === options.strategy.terrain);
  const eligible = legal.filter(newLegal),
    eligibleKeys = new Set(eligible.map(key));
  const compatible = (placement: Placement, tile: Tile) => {
    const category = categories.get(placement.id);
    return originals.has(placement.id)
      ? !category || categoryAt(tile) === category
      : newLegal(tile);
  };
  let evaluated = 0,
    passes = 0,
    truncated = scan.truncated || seeded.truncated;
  type State = {
    index: SafetyIndex;
    entries: Map<string, PlacementSafetyEntry>;
    scoped: Set<string>;
    score: Score;
    open: Set<string>;
    audit: PlacementSafetyAudit;
  };
  function stateFor(placements: Placement[]): State {
    const index = new SafetyIndex(placements, options.terrainAt),
      audit = auditIndex(index, false);
    const entries = new Map(
      audit.entries.map((entry) => [entry.placementId, entry]),
    );
    const scoped = new Set(
      placements
        .filter(
          (p) =>
            p.kind === "hq" && (movableIds.has(p.id) || !originals.has(p.id)),
        )
        .map((p) => p.id),
    );
    const open = new Set(
      legal.filter((tile) => index.unoccupied(tile)).map(key),
    );
    const scopeEntries = [...scoped].map((id) => entries.get(id)!);
    const score: Score = [
      scopeEntries.filter((entry) => entry.analysis.risk === "two-fit").length,
      open.size,
      scopeEntries.reduce((total, entry) => total + pairCount(entry), 0),
      -scoped.size,
    ];
    return { index, entries, scoped, score, open, audit };
  }
  function metrics(state: State): BoundaryOptimizationMetrics {
    return {
      twoFit: state.score[0],
      openCenters: state.open.size,
      uncertain:
        unknownCenters +
        [...state.scoped].filter(
          (id) => state.entries.get(id)!.confidence !== "known",
        ).length,
      invalid: state.audit.summary.invalidCount,
    };
  }
  function protectedSafe(state: State): boolean {
    return [...protectedIds].every((id) => {
      const entry = state.entries.get(id);
      return (
        entry &&
        entry.confidence === "known" &&
        !entry.placementIssues.length &&
        entry.analysis.risk !== "two-fit"
      );
    });
  }
  const beforeState = stateFor(baseline),
    before = metrics(beforeState);
  const outsideTwoFitBefore =
    beforeState.audit.summary.twoFitCount - before.twoFit;
  let best = beforeState;
  function finish(
    status: BoundaryOptimizationResult["status"],
    reason: string,
  ): BoundaryOptimizationResult {
    const optimized = [...best.index.placements.values()];
    const byId = new Map(optimized.map((p) => [p.id, p]));
    const placements = [
      ...original.map((p) => byId.get(p.id)!),
      ...optimized.filter((p) => !originals.has(p.id)),
    ];
    const audit = auditIndex(
      new SafetyIndex(placements, options.terrainAt),
      false,
    );
    best.audit = audit;
    const after = metrics(best);
    const movedIds = original
      .filter((p) => p.x !== byId.get(p.id)!.x || p.y !== byId.get(p.id)!.y)
      .map((p) => p.id);
    return {
      objective: "repair",
      coverageComplete: !scan.truncated,
      placements,
      before,
      after,
      audit,
      movedIds,
      removedIds: [],
      addedIds: placements.filter((p) => !originals.has(p.id)).map((p) => p.id),
      scopedIds: [...best.scoped],
      status,
      truncated,
      reason,
      evaluated,
      passes,
      seedCount,
      seedAddedCount: seeded.placements.length,
      outsideTwoFitBefore,
      outsideTwoFitAfter: audit.summary.twoFitCount - after.twoFit,
      openCenterSamples: legal
        .filter((tile) => best.open.has(key(tile)))
        .slice(0, 32),
    };
  }
  if (originalScope.length > MAX_SCOPE || seedCount > MAX_SCOPE)
    return finish(
      "blocked",
      `This area exceeds the ${MAX_SCOPE}-HQ automatic rearrangement limit. Split it into smaller boundaries; no assigned HQs were removed.`,
    );
  if (
    [...fixedIndex.placements.values()].some(
      (p) => fixedIndex.placementIssues(p).length,
    )
  )
    return finish(
      "blocked",
      "A fixed outside HQ or food/wood blocker has an invalid footprint. Correct it before automatic packing.",
    );
  if (
    unknownCenters ||
    originalAudit.entries.some(
      (entry) =>
        movableIds.has(entry.placementId) && entry.confidence !== "known",
    ) ||
    fixed.some((p) => !initialIndex.facts(p).legalKnown)
  )
    return finish(
      "blocked",
      "Terrain is unverified inside this area or around an existing HQ/blocker. Confirm it before automatic rearrangement.",
    );
  if (!eligible.length && !originalScope.length)
    return finish(
      "blocked",
      "No known legal HQ positions fit both this boundary and the selected strategy terrain.",
    );
  if (!originalScope.length && !maxNew)
    return finish(
      "blocked",
      "There are no movable HQs in this boundary and no capacity to add new HQs. Existing assignments were retained.",
    );
  if (!maxEvaluations || !maxPasses) {
    truncated = true;
    return finish(
      "unchanged",
      "The optimization work limit is zero; the strategy-seeded preview is unchanged.",
    );
  }

  const legalByKey = new Map(legal.map((tile) => [key(tile), tile]));
  function placed(template: Placement, to: Tile): Placement {
    const next = { ...template, ...to };
    const source = originals.get(template.id);
    if (source && (source.x !== to.x || source.y !== to.y))
      delete next.clusterId;
    return next;
  }
  function densify(
    placements: Placement[],
    order: readonly Tile[] = eligible,
  ): Placement[] {
    const index = new SafetyIndex(placements, options.terrainAt);
    const used = new Set(placements.map((p) => p.id));
    let count = placements.filter((p) => !originals.has(p.id)).length;
    for (const tile of order) {
      if (count >= maxNew || index.placements.size >= 5000) break;
      if (!index.unoccupied(tile) || !newLegal(tile)) continue;
      const template = templates.find((p) => !used.has(p.id));
      if (!template) break;
      const p = placed(template, tile);
      index.add(p);
      used.add(p.id);
      count++;
    }
    return [...index.placements.values()];
  }
  function considerLayout(placements: Placement[]): State | undefined {
    if (evaluated >= maxEvaluations) {
      truncated = true;
      return;
    }
    evaluated++;
    const state = stateFor(placements);
    if (
      state.scoped.size < seedCount ||
      state.scoped.size > MAX_SCOPE ||
      state.audit.summary.invalidCount ||
      metrics(state).uncertain ||
      !protectedSafe(state)
    )
      return;
    // When the HQ limit prevents complete coverage, compacting a cluster can reduce
    // its exposed corners by creating a larger empty region. That is not a repair.
    if (
      !before.invalid &&
      (state.score[0] > before.twoFit || state.open.size > before.openCenters)
    )
      return;
    if (compare(state.score, best.score) < 0 || best.audit.summary.invalidCount)
      best = state;
    return state;
  }

  // Reassign identities by a complete bipartite matching. Protected HQs can only receive
  // safe centers, and each assigned player's original grass/mud category is retained.
  function assignExisting(layout: Placement[]): Placement[] | undefined {
    const index = new SafetyIndex(layout, options.terrainAt);
    const sites = layout.filter((p) => !fixedIndex.placements.has(p.id));
    if (sites.length < seedCount || sites.length < originalScope.length) return;
    const slots = sites.map((p) => ({
      tile: { x: p.x, y: p.y },
      safe: index.analyze(p, false).analysis.risk !== "two-fit",
    }));
    const records = [
      ...originalScope,
      ...templates.slice(0, slots.length - originalScope.length),
    ];
    const choices = records.map((p) =>
      slots
        .map((slot, i) => ({ ...slot, i }))
        .filter(
          (slot) =>
            compatible(p, slot.tile) && (!protectedIds.has(p.id) || slot.safe),
        )
        .sort(
          (a, b) =>
            (originals.has(p.id)
              ? distance(p, a.tile) - distance(p, b.tile)
              : 0) ||
            a.tile.y - b.tile.y ||
            a.tile.x - b.tile.x,
        )
        .map((slot) => slot.i),
    );
    const owners = new Map<number, number>();
    function match(record: number, seen: Set<number>): boolean {
      for (const slot of choices[record]) {
        if (seen.has(slot)) continue;
        seen.add(slot);
        const previous = owners.get(slot);
        if (previous === undefined || match(previous, seen)) {
          owners.set(slot, record);
          return true;
        }
      }
      return false;
    }
    const order = records
      .map((_, i) => i)
      .sort(
        (a, b) =>
          choices[a].length - choices[b].length ||
          Number(!originals.has(records[a].id)) -
            Number(!originals.has(records[b].id)) ||
          a - b,
      );
    for (const record of order) if (!match(record, new Set())) return;
    return [
      ...fixed,
      ...[...owners].map(([slot, record]) =>
        placed(records[record], slots[slot].tile),
      ),
    ];
  }

  const starts: State[] = [beforeState];
  const denseBase: Strategy = {
    ...options.strategy,
    id: "boundary-dense",
    name: "Boundary touching packing",
    description:
      "Seven-cell touching packing used for coordinated edge repair.",
    basis: [
      { q: 2, r: 1 },
      { q: -1, r: 3 },
    ],
    minGap: 0,
    terrain: "any",
    rotation: 0,
  };
  const phases = footprint(origin, 1);
  for (const mirror of [false, true])
    for (const phase of phases) {
      if (!inWorld(phase)) continue;
      const packing = smartFillBoundary({
        ...options,
        boundary,
        anchor: phase,
        strategy: denseBase,
        mirrored: mirror,
        placements: fixed,
        allowUnknown: false,
        maxCandidates,
        maxPlacements: Math.min(MAX_SCOPE, originalScope.length + maxNew),
        groupId: options.groupId,
      });
      const sites = packing.placements.filter(
        (p) =>
          newLegal(p) || originalScope.some((source) => compatible(source, p)),
      );
      // Consume the terrain-specific slots needed by existing players before adding new HQs.
      const unused = [...sites];
      const arranged: Placement[] = [...fixed];
      let failed = false;
      const orderedExisting = [...originalScope].sort(
        (a, b) =>
          Number(categories.get(b.id) !== null) -
            Number(categories.get(a.id) !== null) || a.id.localeCompare(b.id),
      );
      for (const source of orderedExisting) {
        const candidates = unused
          .map((tile, i) => ({ tile, i }))
          .filter(({ tile }) => compatible(source, tile))
          .sort(
            (a, b) =>
              distance(source, a.tile) - distance(source, b.tile) ||
              a.tile.y - b.tile.y ||
              a.tile.x - b.tile.x,
          );
        if (!candidates.length) {
          failed = true;
          break;
        }
        const { tile, i } = candidates[0];
        unused.splice(i, 1);
        arranged.push(placed(source, tile));
      }
      if (failed) continue;
      let added = 0;
      for (const tile of unused)
        if (newLegal(tile) && added < maxNew)
          arranged.push(placed(templates[added++], tile));
      const matched = assignExisting(densify(arranged));
      if (!matched) continue;
      const state = considerLayout(matched);
      if (state) starts.push(state);
      if (
        best.score[0] === 0 &&
        best.score[1] === 0 &&
        !metrics(best).uncertain
      )
        break;
    }
  const filled = considerLayout(densify(baseline));
  if (filled) starts.push(filled);

  type Change = { from?: Placement; to: Placement };
  type Proposal = {
    changes: Change[];
    score: Score;
    entries: Map<string, PlacementSafetyEntry>;
    open: Set<string>;
  };
  function tryChanges(state: State, changes: Change[]): Proposal | undefined {
    if (evaluated >= maxEvaluations) {
      truncated = true;
      return;
    }
    evaluated++;
    const index = state.index;
    const affected = new Set<string>();
    const openKeys = new Set<string>();
    for (const change of changes)
      for (const center of change.from
        ? [change.from, change.to]
        : [change.to]) {
        for (const p of index.nearbyHqs(center, 4)) affected.add(p.id);
        for (const tile of footprint(center, 2))
          if (legalKeys.has(key(tile))) openKeys.add(key(tile));
      }
    for (const { from } of changes) if (from) index.remove(from);
    let invalid = false;
    for (const { to } of changes) {
      if (
        !legalKeys.has(key(to)) ||
        !compatible(to, to) ||
        !index.unoccupied(to)
      ) {
        invalid = true;
        break;
      }
      index.add(to);
      affected.add(to.id);
    }
    let proposal: Proposal | undefined;
    try {
      if (invalid) return;
      const entries = new Map<string, PlacementSafetyEntry>();
      let risk = state.score[0],
        pairs = state.score[2];
      for (const id of affected) {
        const p = index.placements.get(id)!;
        const entry = index.analyze(p, false),
          beforeEntry = state.entries.get(id);
        if (
          entry.confidence !== "known" ||
          entry.placementIssues.length ||
          (protectedIds.has(id) && entry.analysis.risk === "two-fit")
        )
          return;
        entries.set(id, entry);
        if (
          state.scoped.has(id) ||
          changes.some((change) => !change.from && change.to.id === id)
        ) {
          risk +=
            Number(entry.analysis.risk === "two-fit") -
            Number(beforeEntry?.analysis.risk === "two-fit");
          pairs +=
            pairCount(entry) - (beforeEntry ? pairCount(beforeEntry) : 0);
        }
      }
      const open = new Set(state.open);
      for (const cell of openKeys) {
        const tile = legalByKey.get(cell)!;
        if (index.unoccupied(tile)) open.add(cell);
        else open.delete(cell);
      }
      const score: Score = [
        risk,
        open.size,
        pairs,
        state.score[3] - changes.filter((change) => !change.from).length,
      ];
      if (risk > state.score[0] || open.size > state.open.size) return;
      if (compare(score, state.score) < 0)
        proposal = { changes, score, entries, open };
    } finally {
      for (const { to } of changes)
        if (index.placements.has(to.id)) index.remove(to);
      for (const { from } of changes) if (from) index.add(from);
    }
    return proposal;
  }
  function applyProposal(state: State, proposal: Proposal): void {
    for (const { from } of proposal.changes) if (from) state.index.remove(from);
    for (const { to } of proposal.changes) {
      state.index.add(to);
      state.scoped.add(to.id);
    }
    for (const [id, entry] of proposal.entries) state.entries.set(id, entry);
    state.score = proposal.score;
    state.open = proposal.open;
  }
  const finalists = starts
    .filter(
      (state) =>
        !state.audit.summary.invalidCount &&
        !metrics(state).uncertain &&
        protectedSafe(state),
    )
    .sort((a, b) => compare(a.score, b.score))
    .slice(0, 16);
  for (const state of finalists) {
    for (
      let pass = 0;
      pass < 12 && passes < maxPasses && evaluated < maxEvaluations;
      pass++
    ) {
      passes++;
      if (!state.score[0] && !state.score[1]) break;
      let proposal: Proposal | undefined;
      const consider = (candidate: Proposal | undefined) => {
        if (
          candidate &&
          (!proposal || compare(candidate.score, proposal.score) < 0)
        )
          proposal = candidate;
      };
      const sources = [...state.scoped]
        .map((id) => state.index.placements.get(id)!)
        .sort(
          (a, b) =>
            Number(state.entries.get(b.id)!.analysis.risk === "two-fit") -
              Number(state.entries.get(a.id)!.analysis.risk === "two-fit") ||
            a.id.localeCompare(b.id),
        );
      for (const source of sources) {
        for (const tile of footprint(source, 2)) {
          if (
            !distance(source, tile) ||
            !legalKeys.has(key(tile)) ||
            !compatible(source, tile) ||
            !state.index.unoccupied(tile, source.id)
          )
            continue;
          consider(
            tryChanges(state, [{ from: source, to: placed(source, tile) }]),
          );
          if (evaluated >= maxEvaluations) break;
        }
        if (evaluated >= maxEvaluations) break;
      }
      const usedNew = [...state.index.placements.values()].filter(
        (p) => !originals.has(p.id),
      ).length;
      const next = templates.find((p) => !state.index.placements.has(p.id));
      if (next && usedNew < maxNew && state.scoped.size < MAX_SCOPE)
        for (const tile of eligible) {
          if (!state.open.has(key(tile))) continue;
          consider(tryChanges(state, [{ to: placed(next, tile) }]));
          if (evaluated >= maxEvaluations) break;
        }
      // A pair can move together even when either individual move would collide or
      // temporarily weaken the other HQ. Search these only after single edits plateau.
      if (!proposal && evaluated < maxEvaluations) {
        const seenPairs = new Set<string>();
        for (const source of sources
          .filter((p) => state.entries.get(p.id)!.analysis.risk === "two-fit")
          .slice(0, 12)) {
          const neighbors = state.index
            .nearbyHqs(source, 5)
            .filter((p) => p.id !== source.id && state.scoped.has(p.id))
            .slice(0, 6);
          for (const other of neighbors) {
            const pairId = [source.id, other.id].sort().join("|");
            if (seenPairs.has(pairId)) continue;
            seenPairs.add(pairId);
            state.index.remove(source);
            state.index.remove(other);
            const aSites = footprint(source, 2).filter(
              (tile) =>
                legalKeys.has(key(tile)) &&
                compatible(source, tile) &&
                state.index.unoccupied(tile),
            );
            const bSites = footprint(other, 2).filter(
              (tile) =>
                legalKeys.has(key(tile)) &&
                compatible(other, tile) &&
                state.index.unoccupied(tile),
            );
            state.index.add(source);
            state.index.add(other);
            for (const a of aSites)
              for (const b of bSites) {
                if (
                  (!distance(source, a) && !distance(other, b)) ||
                  !legalKeys.has(key(a)) ||
                  !legalKeys.has(key(b)) ||
                  !compatible(source, a) ||
                  !compatible(other, b) ||
                  distance(a, b) < 3
                )
                  continue;
                consider(
                  tryChanges(state, [
                    { from: source, to: placed(source, a) },
                    { from: other, to: placed(other, b) },
                  ]),
                );
                if (evaluated >= maxEvaluations) break;
              }
            if (evaluated >= maxEvaluations) break;
          }
          if (evaluated >= maxEvaluations) break;
        }
      }
      if (!proposal) break;
      applyProposal(state, proposal);
      if (compare(state.score, best.score) < 0) best = state;
      if (pass + 1 === 12) truncated = true;
    }
    if (!best.score[0] && !best.score[1]) break;
  }
  if (evaluated >= maxEvaluations || passes >= maxPasses) truncated = true;
  // Rebuild every entry for the final full plan; incremental scores are never the proof.
  best = stateFor([...best.index.placements.values()]);
  const after = metrics(best);
  if (after.invalid || after.uncertain || !protectedSafe(best))
    return finish(
      "blocked",
      "No verified complete packing was found. Invalid or unverified positions still require attention; assigned HQs were retained.",
    );
  if (
    best.scoped.size &&
    !after.twoFit &&
    !after.openCenters &&
    !scan.truncated
  )
    return finish(
      "resolved",
      "No two-HQ replacement warnings or currently open HQ centers remain inside this boundary. Outside warnings are separate; boundary lines do not block enemies.",
    );
  const outsideTerrain = legal.filter(
    (tile) => best.open.has(key(tile)) && !eligibleKeys.has(key(tile)),
  ).length;
  const improved =
    after.twoFit < before.twoFit ||
    (after.twoFit === before.twoFit &&
      after.openCenters < before.openCenters) ||
    before.invalid > after.invalid;
  const reason = `${after.twoFit} HQ-loss warnings and ${after.openCenters} open candidate centers remain inside this area.${outsideTerrain ? ` ${outsideTerrain} open centers require terrain outside the chosen strategy.` : ""}${truncated ? " The bounded search reached a work or area limit." : " Larger changes or support beyond the boundary may be needed."} All existing assignments were retained.`;
  return finish(improved ? "improved" : "unchanged", reason);
}

export function optimizeBoundaryFill(
  options: BoundaryOptimizationOptions,
): BoundaryOptimizationResult {
  const repaired = repairBoundaryFill(options);
  return options.objective === "fewest"
    ? minimizeBoundaryPacking(options, repaired)
    : repaired;
}
