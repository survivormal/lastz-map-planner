import { distance, footprint, inWorld, key, type Tile } from "./geometry";
import type { ReplacementAnalysis, TerrainLookup } from "./placement";
import type { Placement, Terrain } from "./schema";

export type SafetyOptions = {
  terrainAt: TerrainLookup;
  allowUnknown?: boolean;
};
export type PlacementSafetyEntry = {
  placementId: string;
  analysis: ReplacementAnalysis;
  confidence: "known" | "incomplete" | "provisional";
  /** Confirmed footprint/occupancy errors; unknown terrain is reflected in confidence. */
  placementIssues: string[];
};
export type PlacementSafetyAudit = {
  entries: PlacementSafetyEntry[];
  summary: {
    hqCount: number;
    twoFitCount: number;
    incompleteCount: number;
    provisionalCount: number;
    invalidCount: number;
  };
};
export type TighteningSuggestion = {
  id: string;
  kind: "move" | "infill";
  placementId?: string;
  from?: Tile;
  to: Tile;
  /** Global strict two-fit HQ counts, with all other known placements retained. */
  beforeCount: number;
  afterCount: number;
  affectedBeforeCount: number;
  affectedAfterCount: number;
  affectedIds: string[];
  selectedBefore: ReplacementAnalysis;
  selectedAfter: ReplacementAnalysis;
  addedAnalysis?: ReplacementAnalysis;
};
export type TighteningSearchResult = {
  suggestions: TighteningSuggestion[];
  evaluated: number;
  analyzedHqs: number;
  truncated: boolean;
  reason?: string;
};
export type TighteningOptions = SafetyOptions & {
  maxCandidates?: number;
  maxAuditEvaluations?: number;
  maxSuggestions?: number;
};

export const MAX_TIGHTENING_CANDIDATES = 192;
export const MAX_TIGHTENING_AUDITS = 12_000;
const SCOPE =
  "One removed HQ; every other shown building remains. Only pairs of newly opened seven-tile HQ footprints count as two replacements. Already-open centers within four steps are listed separately. Grass is legal enemy terrain; drawn planning boundaries are not obstacles. Live occupancy, event rules, multiple losses and terrain uncertainty can change the outcome.";

type CenterFacts = {
  legalKnown: boolean;
  legalProvisional: boolean;
  unknownTiles: Tile[];
  outOfWorld: boolean;
  restricted: boolean;
};

/** A placement blocks exactly nineteen possible radius-one HQ centers. */
export class SafetyIndex {
  readonly placements = new Map<string, Placement>();
  private readonly centers = new Map<string, Set<string>>();
  private readonly blockedCenters = new Map<string, Set<string>>();
  private readonly terrainCells = new Map<string, Terrain>();
  private readonly centerFacts = new Map<string, CenterFacts>();

  constructor(
    placements: readonly Placement[],
    private readonly terrainAt: TerrainLookup,
  ) {
    if (placements.length > 5000)
      throw new RangeError(
        "Safety analysis supports at most 5,000 placements.",
      );
    for (const placement of placements) {
      if (this.placements.has(placement.id))
        throw new RangeError("Safety analysis requires unique placement IDs.");
      if (!inWorld(placement))
        throw new RangeError(
          "Placement centers must be valid world coordinates.",
        );
      this.add(placement);
    }
  }

  add(placement: Placement): void {
    this.placements.set(placement.id, placement);
    this.addTo(this.centers, key(placement), placement.id);
    for (const tile of footprint(placement, 2))
      this.addTo(this.blockedCenters, key(tile), placement.id);
  }

  remove(placement: Placement): void {
    this.placements.delete(placement.id);
    this.removeFrom(this.centers, key(placement), placement.id);
    for (const tile of footprint(placement, 2))
      this.removeFrom(this.blockedCenters, key(tile), placement.id);
  }

  private addTo(map: Map<string, Set<string>>, cell: string, id: string): void {
    const occupants = map.get(cell);
    if (occupants) occupants.add(id);
    else map.set(cell, new Set([id]));
  }

  private removeFrom(
    map: Map<string, Set<string>>,
    cell: string,
    id: string,
  ): void {
    const occupants = map.get(cell);
    if (!occupants) return;
    occupants.delete(id);
    if (!occupants.size) map.delete(cell);
  }

  terrain(tile: Tile): Terrain {
    if (!inWorld(tile)) return "restricted";
    const id = key(tile),
      cached = this.terrainCells.get(id);
    if (cached !== undefined) return cached;
    const terrain = this.terrainAt(tile);
    this.terrainCells.set(id, terrain);
    return terrain;
  }

  facts(center: Tile): CenterFacts {
    const id = key(center),
      cached = this.centerFacts.get(id);
    if (cached) return cached;
    const unknownTiles: Tile[] = [];
    let outOfWorld = false,
      restricted = false;
    for (const tile of footprint(center)) {
      if (!inWorld(tile)) {
        outOfWorld = true;
        continue;
      }
      const terrain = this.terrain(tile);
      if (terrain === "restricted") restricted = true;
      if (terrain === "unknown") unknownTiles.push(tile);
    }
    const legalProvisional = !outOfWorld && !restricted;
    const facts = {
      legalKnown: legalProvisional && !unknownTiles.length,
      legalProvisional,
      unknownTiles,
      outOfWorld,
      restricted,
    };
    this.centerFacts.set(id, facts);
    return facts;
  }

  unoccupied(center: Tile, removedId?: string): boolean {
    const blockers = this.blockedCenters.get(key(center));
    return (
      !blockers ||
      (blockers.size === 1 &&
        removedId !== undefined &&
        blockers.has(removedId))
    );
  }

  nearbyHqs(center: Tile, radius: number): Placement[] {
    const result: Placement[] = [];
    for (const tile of footprint(center, radius))
      for (const id of this.centers.get(key(tile)) ?? []) {
        const placement = this.placements.get(id)!;
        if (placement.kind === "hq") result.push(placement);
      }
    return result;
  }

  category(placement: Tile): "grass" | "mud" | null {
    const values = footprint(placement).map((tile) => this.terrain(tile));
    return values.every((terrain) => terrain === "mud")
      ? "mud"
      : values.every((terrain) => terrain === "grass")
        ? "grass"
        : null;
  }

  placementIssues(placement: Placement): string[] {
    const facts = this.facts(placement),
      issues: string[] = [];
    if (facts.outOfWorld) issues.push("Footprint extends outside the world.");
    if (facts.restricted) issues.push("Footprint crosses restricted terrain.");
    if (
      placement.kind !== "hq" &&
      footprint(placement).some((tile) => this.terrain(tile) === "mud")
    )
      issues.push("Alliance food/wood cannot occupy mud terrain.");
    if (!this.unoccupied(placement, placement.id))
      issues.push("Footprint overlaps another placement.");
    return issues;
  }

  analyze(target: Placement, allowUnknown: boolean): PlacementSafetyEntry {
    const newlyEnabled: Tile[] = [],
      existingOpen: Tile[] = [],
      unknown = new Map<string, Tile>();
    const inner = footprint(target, 2),
      outer = footprint(target, 4).filter((tile) => distance(tile, target) > 2);
    for (const [newOpening, centers] of [
      [true, inner],
      [false, outer],
    ] as const)
      for (const center of centers) {
        const facts = this.facts(center);
        for (const tile of facts.unknownTiles) unknown.set(key(tile), tile);
        if (
          !(allowUnknown ? facts.legalProvisional : facts.legalKnown) ||
          !this.unoccupied(center, target.id)
        )
          continue;
        if (newOpening) newlyEnabled.push(center);
        else existingOpen.push(center);
      }
    let witnessPair: [Tile, Tile] | undefined;
    outer: for (let i = 0; i < newlyEnabled.length; i++)
      for (let j = i + 1; j < newlyEnabled.length; j++) {
        if (distance(newlyEnabled[i], newlyEnabled[j]) >= 3) {
          witnessPair = [newlyEnabled[i], newlyEnabled[j]];
          break outer;
        }
      }
    const unknownTiles = [...unknown.values()];
    return {
      placementId: target.id,
      analysis: {
        risk: witnessPair
          ? "two-fit"
          : newlyEnabled.length
            ? "one-fit"
            : "none",
        newlyEnabled,
        existingOpen,
        witnessPair,
        unknownTiles,
        scope: SCOPE,
      },
      confidence: unknownTiles.length
        ? allowUnknown
          ? "provisional"
          : "incomplete"
        : "known",
      placementIssues: this.placementIssues(target),
    };
  }
}

export function auditIndex(
  index: SafetyIndex,
  allowUnknown: boolean,
): PlacementSafetyAudit {
  const entries: PlacementSafetyEntry[] = [];
  const summary = {
    hqCount: 0,
    twoFitCount: 0,
    incompleteCount: 0,
    provisionalCount: 0,
    invalidCount: 0,
  };
  for (const placement of index.placements.values()) {
    if (index.placementIssues(placement).length) summary.invalidCount++;
    if (placement.kind !== "hq") continue;
    const entry = index.analyze(placement, allowUnknown);
    entries.push(entry);
    summary.hqCount++;
    if (entry.analysis.risk === "two-fit") summary.twoFitCount++;
    if (entry.confidence === "incomplete") summary.incompleteCount++;
    if (entry.confidence === "provisional") summary.provisionalCount++;
  }
  return { entries, summary };
}

export function auditPlacementSafety(
  placements: readonly Placement[],
  options: SafetyOptions,
): PlacementSafetyAudit {
  return auditIndex(
    new SafetyIndex(placements, options.terrainAt),
    options.allowUnknown ?? false,
  );
}

function bounded(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 0)
    throw new RangeError("Search limits must be nonnegative safe integers.");
  return Math.min(selected, maximum);
}

/**
 * Bounded local planning edits, not executable teleports. Terrain is always required to be
 * known for suggestions, even if display/audit sandbox mode permits provisional geometry.
 * Only changed neighborhoods need recomputation: radius four affects new openings; radius
 * six also refreshes the separately reported existing-open centers.
 */
export function findTighteningSuggestions(
  selectedId: string,
  placements: readonly Placement[],
  options: TighteningOptions,
): TighteningSearchResult {
  const result: TighteningSearchResult = {
    suggestions: [],
    evaluated: 0,
    analyzedHqs: 0,
    truncated: false,
  };
  const index = new SafetyIndex(placements, options.terrainAt),
    selected = index.placements.get(selectedId);
  if (!selected || selected.kind !== "hq")
    return {
      ...result,
      reason: "Select an HQ to review local tightening options.",
    };
  if (
    [...index.placements.values()].some(
      (placement) => index.placementIssues(placement).length,
    )
  )
    return {
      ...result,
      reason:
        "Resolve invalid existing footprints or blockers before tightening; they cannot be counted as reliable protection.",
    };
  if (
    [...index.placements.values()].some(
      (placement) =>
        placement.kind !== "hq" && !index.facts(placement).legalKnown,
    )
  )
    return {
      ...result,
      reason:
        "Confirm existing blocker terrain before tightening; unknown blockers cannot be counted as reliable protection.",
    };
  const selectedEntry = index.analyze(selected, false);
  if (selectedEntry.placementIssues.length)
    return {
      ...result,
      reason: "Resolve the selected HQ's invalid footprint before tightening.",
    };
  if (selectedEntry.confidence !== "known")
    return {
      ...result,
      reason:
        "Terrain is incomplete around this HQ. Confirm the surrounding tiles before tightening.",
    };
  if (selectedEntry.analysis.risk !== "two-fit")
    return {
      ...result,
      reason: "No confirmed two-HQ replacement opening at the selected HQ.",
    };
  const baseline = auditIndex(index, false),
    before = new Map(
      baseline.entries.map((entry) => [entry.placementId, entry]),
    );
  const maxCandidates = bounded(
    options.maxCandidates,
    MAX_TIGHTENING_CANDIDATES,
    MAX_TIGHTENING_CANDIDATES,
  );
  const maxAudits = bounded(
    options.maxAuditEvaluations,
    MAX_TIGHTENING_AUDITS,
    MAX_TIGHTENING_AUDITS,
  );
  const maxSuggestions = bounded(options.maxSuggestions, 3, 3);
  const movers = index
    .nearbyHqs(selected, 6)
    .sort(
      (a, b) =>
        distance(a, selected) - distance(b, selected) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 7);
  type Candidate = { kind: "move" | "infill"; source?: Placement; to: Tile };
  const candidates: Candidate[] = [];
  for (const source of movers) {
    const moves = footprint(source, 2)
      .filter((tile) => distance(source, tile) > 0)
      .sort(
        (a, b) =>
          distance(source, a) - distance(source, b) || a.y - b.y || a.x - b.x,
      );
    for (const to of moves) candidates.push({ kind: "move", source, to });
  }
  if (placements.length < 5000)
    for (const to of footprint(selected, 4).sort(
      (a, b) =>
        distance(selected, a) - distance(selected, b) || a.y - b.y || a.x - b.x,
    ))
      candidates.push({ kind: "infill", to });
  let infillId = "__tightening_infill__";
  while (index.placements.has(infillId)) infillId += "_";
  for (const candidate of candidates) {
    if (result.evaluated >= maxCandidates) {
      result.truncated = true;
      break;
    }
    result.evaluated++;
    const { source, to, kind } = candidate;
    const facts = index.facts(to);
    if (!facts.legalKnown || !index.unoccupied(to, source?.id)) continue;
    const category = index.category(source ?? selected);
    if (
      category &&
      footprint(to).some((tile) => index.terrain(tile) !== category)
    )
      continue;
    if (
      source &&
      (before.get(source.id)!.confidence !== "known" ||
        before.get(source.id)!.placementIssues.length)
    )
      continue;
    const affected = new Map<string, Placement>();
    for (const origin of source ? [source, to] : [to])
      for (const placement of index.nearbyHqs(origin, 6))
        affected.set(placement.id, placement);
    if (source) affected.set(source.id, source);
    if (
      [...affected.keys()].some(
        (id) =>
          before.get(id)!.confidence !== "known" ||
          before.get(id)!.placementIssues.length,
      )
    )
      continue;
    const requiredAudits = affected.size + (kind === "infill" ? 1 : 0);
    if (result.analyzedHqs + requiredAudits > maxAudits) {
      result.truncated = true;
      break;
    }
    const moved: Placement = source
      ? { ...source, ...to }
      : {
          ...to,
          id: infillId,
          kind: "hq",
          name: "Proposed infill HQ",
          groupId: selected.groupId,
          showGraphic: false,
        };
    if (source) index.remove(source);
    index.add(moved);
    const after = new Map<string, PlacementSafetyEntry>();
    let added: PlacementSafetyEntry | undefined;
    try {
      for (const id of affected.keys()) {
        after.set(id, index.analyze(index.placements.get(id)!, false));
        result.analyzedHqs++;
      }
      if (kind === "infill") {
        added = index.analyze(moved, false);
        result.analyzedHqs++;
      }
    } finally {
      index.remove(moved);
      if (source) index.add(source);
    }
    if (
      [...after.values()].some(
        (entry) => entry.confidence !== "known" || entry.placementIssues.length,
      ) ||
      (added &&
        (added.confidence !== "known" ||
          added.placementIssues.length ||
          added.analysis.risk === "two-fit"))
    )
      continue;
    if (
      [...after].some(
        ([id, entry]) =>
          before.get(id)!.analysis.risk !== "two-fit" &&
          entry.analysis.risk === "two-fit",
      )
    )
      continue;
    const affectedBeforeCount = [...affected.keys()].filter(
      (id) => before.get(id)!.analysis.risk === "two-fit",
    ).length;
    const affectedAfterCount = [...after.values()].filter(
      (entry) => entry.analysis.risk === "two-fit",
    ).length;
    const beforeCount = baseline.summary.twoFitCount,
      afterCount = beforeCount - affectedBeforeCount + affectedAfterCount;
    if (afterCount >= beforeCount) continue;
    const selectedAfter =
      after.get(selected.id)?.analysis ?? selectedEntry.analysis;
    result.suggestions.push({
      id: `${kind}:${source?.id ?? selected.id}:${source ? key(source) + ">" : ""}${key(to)}`,
      kind,
      placementId: source?.id,
      from: source ? { x: source.x, y: source.y } : undefined,
      to: { ...to },
      beforeCount,
      afterCount,
      affectedBeforeCount,
      affectedAfterCount,
      affectedIds: [...affected.keys()].sort(),
      selectedBefore: selectedEntry.analysis,
      selectedAfter,
      addedAnalysis: added?.analysis,
    });
  }
  result.suggestions.sort(
    (a, b) =>
      Number(b.selectedAfter.risk !== "two-fit") -
        Number(a.selectedAfter.risk !== "two-fit") ||
      a.afterCount - b.afterCount ||
      Number(a.kind === "infill") - Number(b.kind === "infill") ||
      (a.from ? distance(a.from, a.to) : 0) -
        (b.from ? distance(b.from, b.to) : 0) ||
      a.id.localeCompare(b.id),
  );
  const ranked = result.suggestions;
  result.suggestions = ranked.slice(0, maxSuggestions);
  // Offer an equally effective infill alternative when it avoids moving an assigned player.
  // A weaker result never displaces a stronger reduction or a resolved selected opening.
  if (
    maxSuggestions > 1 &&
    result.suggestions.length > 1 &&
    result.suggestions.every((suggestion) => suggestion.kind === "move")
  ) {
    const best = result.suggestions[0];
    const infill = ranked.find(
      (suggestion) =>
        suggestion.kind === "infill" &&
        suggestion.afterCount === best.afterCount &&
        (suggestion.selectedAfter.risk !== "two-fit") ===
          (best.selectedAfter.risk !== "two-fit"),
    );
    if (infill) result.suggestions[result.suggestions.length - 1] = infill;
  }
  if (!result.suggestions.length)
    result.reason = result.truncated
      ? "The bounded search found no verified improvement before its work limit. Try another nearby HQ or adjust the edge manually."
      : "No one- or two-tile move or single-HQ infill improves the confirmed two-fit count without creating a new risk. Larger coordinated changes may be needed.";
  return result;
}
