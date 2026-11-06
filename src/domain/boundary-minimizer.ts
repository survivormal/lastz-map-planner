import {
  distance,
  footprint,
  footprintInBoundary,
  key,
  type Tile,
} from "./geometry";
import { SafetyIndex, auditIndex } from "./edge-safety";
import { nearestPlotSites } from "./plot";
import { boundaryFillAnchor, validatedClosedBoundary } from "./strategies";
import type { Placement } from "./schema";
import type {
  BoundaryOptimizationOptions,
  BoundaryOptimizationResult,
} from "./boundary-optimizer";

const MAX_NODES = 100_000;
const DEFAULT_NODES = 50_000;
const PATCH_NODES = 2000;
function popcount(value: bigint): number {
  let count = 0;
  while (value) {
    value &= value - 1n;
    count++;
  }
  return count;
}

/** Replace complete local groups with fewer HQs; a bare deletion always leaves its own center open. */
export function minimizeBoundaryPacking(
  options: BoundaryOptimizationOptions,
  repaired: BoundaryOptimizationResult,
): BoundaryOptimizationResult {
  const budget = options.maxMinimizationNodes ?? DEFAULT_NODES;
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > MAX_NODES)
    throw new RangeError(
      `The minimization node limit must be an integer from 0 to ${MAX_NODES}.`,
    );
  if (
    repaired.coverageComplete &&
    !repaired.scopedIds.length &&
    !repaired.after.twoFit &&
    !repaired.after.openCenters &&
    !repaired.after.uncertain &&
    !repaired.after.invalid &&
    options.placements.every(
      (p) => new SafetyIndex([p], options.terrainAt).facts(p).legalKnown,
    )
  )
    return {
      ...repaired,
      objective: "fewest",
      status: "resolved",
      reason:
        "No inside HQs are needed: the complete known boundary already has no open enemy HQ centers. Fixed outside HQs and blockers remain unchanged.",
    };
  if (
    repaired.status !== "resolved" ||
    !repaired.coverageComplete ||
    repaired.after.twoFit ||
    repaired.after.openCenters ||
    repaired.after.uncertain ||
    repaired.after.invalid
  ) {
    return {
      ...repaired,
      objective: "fewest",
      status: "blocked",
      reason:
        "Fewest HQs requires a fully checked layout with zero two-HQ loss warnings and zero open enemy HQ centers. No qualifying layout was found within this search; no minimum-count proposal is ready. " +
        repaired.reason,
    };
  }
  const boundary = validatedClosedBoundary(options.boundary);
  const originals = new Map(options.placements.map((p) => [p.id, p]));
  const preserve = options.preserveExisting !== false;
  const originalIndex = new SafetyIndex(options.placements, options.terrainAt);
  const category = (tile: Tile): "mud" | "grass" | null => {
    if (!originalIndex.facts(tile).legalKnown) return null;
    return footprint(tile).some((cell) => originalIndex.terrain(cell) === "mud")
      ? "mud"
      : "grass";
  };
  const categories = new Map(
    options.placements.map((p) => [p.id, category(p)]),
  );
  const compatible = (p: Placement, tile: Tile) =>
    originals.has(p.id)
      ? !categories.get(p.id) || categories.get(p.id) === category(tile)
      : options.strategy.terrain === "any" ||
        options.strategy.terrain === category(tile);
  const protectedOutside = new Set(
    repaired.audit.entries
      .filter(
        (entry) =>
          !repaired.scopedIds.includes(entry.placementId) &&
          entry.confidence === "known" &&
          !entry.placementIssues.length &&
          entry.analysis.risk !== "two-fit",
      )
      .map((entry) => entry.placementId),
  );
  const origin = boundaryFillAnchor(boundary);
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
    Math.min(
      options.maxCandidates ?? 4000,
      20_000,
      Math.max(100, Math.floor(400_000 / boundary.length)),
    ),
  );
  const legal = scan.sites
    .map((site) => site.tile)
    .filter(
      (tile) =>
        footprintInBoundary(tile, boundary) &&
        originalIndex.facts(tile).legalKnown,
    );
  if (scan.truncated)
    return {
      ...repaired,
      objective: "fewest",
      coverageComplete: false,
      status: "blocked",
      reason:
        "The entire boundary could not be checked within the area limit. Split it into smaller areas before finding the fewest HQs.",
    };
  const legalByKey = new Map(legal.map((tile) => [key(tile), tile]));
  let current = repaired.placements.map((p) => ({ ...p }));
  let nodes = 0,
    reductions = 0,
    limited = false;
  const startCount = repaired.scopedIds.length;
  const scopeIds = new Set(repaired.scopedIds);

  function place(template: Placement, to: Tile): Placement {
    const original = originals.get(template.id),
      next = { ...(original ?? template), ...to };
    if (original && (original.x !== to.x || original.y !== to.y))
      delete next.clusterId;
    return next;
  }
  function assign(patch: Placement[], sites: Tile[]): Placement[] | undefined {
    const required = preserve ? patch.filter((p) => originals.has(p.id)) : [];
    if (required.length > sites.length) return;
    const optional = patch
      .filter((p) => !required.some((r) => r.id === p.id))
      .sort(
        (a, b) =>
          Number(originals.has(b.id)) - Number(originals.has(a.id)) ||
          a.id.localeCompare(b.id),
      );
    const needed = sites.length - required.length;
    let result: Placement[] | undefined;
    function selected(start: number, records: Placement[]) {
      if (result) return;
      if (records.length === needed) {
        const agents = [...required, ...records];
        const choices = agents.map((p) =>
          sites
            .map((tile, i) => ({ tile, i }))
            .filter(({ tile }) => compatible(p, tile))
            .sort(
              (a, b) => distance(p, a.tile) - distance(p, b.tile) || a.i - b.i,
            )
            .map(({ i }) => i),
        );
        const owners = new Map<number, number>();
        function match(agent: number, seen: Set<number>): boolean {
          for (const slot of choices[agent]) {
            if (seen.has(slot)) continue;
            seen.add(slot);
            const prior = owners.get(slot);
            if (prior === undefined || match(prior, seen)) {
              owners.set(slot, agent);
              return true;
            }
          }
          return false;
        }
        const order = agents
          .map((_, i) => i)
          .sort((a, b) => choices[a].length - choices[b].length || a - b);
        for (const agent of order) if (!match(agent, new Set())) return;
        result = [...owners].map(([slot, agent]) =>
          place(agents[agent], sites[slot]),
        );
        return;
      }
      for (let i = start; i < optional.length; i++) {
        selected(i + 1, [...records, optional[i]]);
        if (result) return;
      }
    }
    selected(0, []);
    return result;
  }
  function searchPatch(patch: Placement[]): Placement[] | undefined {
    if (
      patch.length < 3 ||
      (preserve && patch.every((p) => originals.has(p.id)))
    )
      return;
    const patchIds = new Set(patch.map((p) => p.id));
    const retained = current.filter((p) => !patchIds.has(p.id));
    const index = new SafetyIndex(retained, options.terrainAt);
    // Every changed center is within two steps of a removed HQ. Only retained HQs
    // within another four steps can gain a new one-loss witness; final validation
    // still checks the complete plan once after all accepted patch replacements.
    const affected = new Set<string>();
    for (const old of patch)
      for (const p of index.nearbyHqs(old, 6))
        if (scopeIds.has(p.id) || protectedOutside.has(p.id))
          affected.add(p.id);
    const requiredMap = new Map<string, Tile>();
    for (const p of patch)
      for (const tile of footprint(p, 2))
        if (legalByKey.has(key(tile)) && index.unoccupied(tile))
          requiredMap.set(key(tile), tile);
    const required = [...requiredMap.values()];
    if (!required.length) return;
    const candidateMap = new Map<string, Tile>();
    for (const p of patch)
      for (const tile of footprint(p, 2))
        if (
          legalByKey.has(key(tile)) &&
          index.unoccupied(tile) &&
          patch.some((source) => compatible(source, tile))
        )
          candidateMap.set(key(tile), tile);
    const candidates = [...candidateMap.values()].sort(
      (a, b) => a.y - b.y || a.x - b.x,
    );
    if (!candidates.length || candidates.length > 180) return;
    const bits = candidates.map((_, i) => 1n << BigInt(i));
    const coverage = candidates.map((tile) =>
      required.reduce(
        (mask, cell, i) =>
          distance(tile, cell) <= 2 ? mask | (1n << BigInt(i)) : mask,
        0n,
      ),
    );
    const conflicts = candidates.map((tile) =>
      candidates.reduce(
        (mask, other, i) => (distance(tile, other) < 3 ? mask | bits[i] : mask),
        0n,
      ),
    );
    const coverers = required.map((_, i) =>
      coverage.reduce(
        (mask, cover, j) => (cover & (1n << BigInt(i)) ? mask | bits[j] : mask),
        0n,
      ),
    );
    const all = (1n << BigInt(candidates.length)) - 1n,
      full = (1n << BigInt(required.length)) - 1n;
    const goal = patch.length - 1,
      localLimit = Math.min(budget, nodes + PATCH_NODES);
    let answer: Placement[] | undefined;
    const failed = new Set<string>();
    function dfs(available: bigint, covered: bigint, chosen: number[]): void {
      if (answer || nodes >= localLimit) return;
      nodes++;
      const uncovered = full & ~covered;
      if (!uncovered) {
        const replacements = assign(
          patch,
          chosen.map((i) => candidates[i]),
        );
        if (replacements) {
          for (const p of replacements) index.add(p);
          const valid = [...affected, ...replacements.map((p) => p.id)].every(
            (id) => {
              const entry = index.analyze(index.placements.get(id)!, false);
              return (
                entry.confidence === "known" &&
                !entry.placementIssues.length &&
                entry.analysis.risk !== "two-fit"
              );
            },
          );
          for (const p of replacements) index.remove(p);
          if (valid) {
            answer = [...retained, ...replacements];
            return;
          }
        }
        // Coverage can precede safety or the number of retained assignments. More
        // support HQs may be needed, while still using fewer than the old patch.
        if (chosen.length < goal)
          for (let i = 0; i < candidates.length; i++)
            if (available & bits[i]) {
              dfs(available & ~conflicts[i], covered | coverage[i], [
                ...chosen,
                i,
              ]);
              if (answer || nodes >= localLimit) return;
            }
        return;
      }
      const remaining = goal - chosen.length;
      if (remaining <= 0) return;
      const chosenMask = chosen.reduce((mask, i) => mask | bits[i], 0n);
      const memo = `${available}:${uncovered}:${remaining}:${chosenMask}`;
      if (failed.has(memo)) return;
      let maxCover = 0,
        union = 0n;
      for (let i = 0; i < candidates.length; i++)
        if (available & bits[i]) {
          const cover = coverage[i] & uncovered;
          union |= cover;
          maxCover = Math.max(maxCover, popcount(cover));
        }
      if (
        union !== uncovered ||
        !maxCover ||
        Math.ceil(popcount(uncovered) / maxCover) > remaining
      ) {
        failed.add(memo);
        return;
      }
      let choices = 0n,
        minChoices = Infinity;
      for (let i = 0; i < required.length; i++)
        if (uncovered & (1n << BigInt(i))) {
          const possible = coverers[i] & available,
            count = popcount(possible);
          if (!count) {
            failed.add(memo);
            return;
          }
          if (count < minChoices) {
            minChoices = count;
            choices = possible;
            if (count === 1) break;
          }
        }
      const ordered = candidates
        .map((_, i) => i)
        .filter((i) => Boolean(choices & bits[i]))
        .sort(
          (a, b) =>
            popcount(coverage[b] & uncovered) -
              popcount(coverage[a] & uncovered) || a - b,
        );
      for (const i of ordered) {
        dfs(available & ~conflicts[i], covered | coverage[i], [...chosen, i]);
        if (answer || nodes >= localLimit) return;
      }
      failed.add(memo);
    }
    dfs(all, 0n, []);
    if (nodes >= localLimit) limited = true;
    return answer;
  }
  while (nodes < budget) {
    const scoped = current.filter((p) => scopeIds.has(p.id));
    const targets = scoped
      .filter((p) => !preserve || !originals.has(p.id))
      .sort(
        (a, b) =>
          Number(originals.has(a.id)) - Number(originals.has(b.id)) ||
          a.y - b.y ||
          a.x - b.x,
      );
    if (!targets.length) break;
    const tried = new Set<string>();
    let improvement: Placement[] | undefined;
    for (const target of targets) {
      const nearby = scoped
        .filter((p) => distance(target, p) <= 6)
        .sort(
          (a, b) =>
            distance(target, a) - distance(target, b) || a.y - b.y || a.x - b.x,
        );
      const patches: Placement[][] = [];
      for (const size of [3, 4, 6, 8])
        if (nearby.length >= size) patches.push(nearby.slice(0, size));
      // Different three-HQ wedges avoid locking the search to a single nearest-neighbor tie.
      for (let i = 1; i < Math.min(nearby.length, 6); i++)
        for (let j = i + 1; j < Math.min(nearby.length, 6); j++)
          patches.push([target, nearby[i], nearby[j]]);
      for (const patch of patches) {
        const id = patch
          .map((p) => p.id)
          .sort()
          .join("|");
        if (tried.has(id)) continue;
        tried.add(id);
        improvement = searchPatch(patch);
        if (improvement || nodes >= budget) break;
      }
      if (improvement || nodes >= budget) break;
    }
    if (!improvement) break;
    current = improvement;
    reductions++;
  }
  if (nodes >= budget) limited = true;
  // Revalidate the complete result independently of the search's local masks.
  const finalIndex = new SafetyIndex(current, options.terrainAt),
    audit = auditIndex(finalIndex, false);
  const scopedIds = current.filter((p) => scopeIds.has(p.id)).map((p) => p.id),
    scopedSet = new Set(scopedIds);
  const entries = audit.entries.filter((entry) =>
    scopedSet.has(entry.placementId),
  );
  const after = {
    twoFit: entries.filter((entry) => entry.analysis.risk === "two-fit").length,
    openCenters: legal.filter((tile) => finalIndex.unoccupied(tile)).length,
    uncertain: entries.filter((entry) => entry.confidence !== "known").length,
    invalid: audit.summary.invalidCount,
  };
  if (
    !scopedIds.length ||
    after.twoFit ||
    after.openCenters ||
    after.uncertain ||
    after.invalid ||
    [...protectedOutside].some((id) => {
      const entry = audit.entries.find((entry) => entry.placementId === id);
      return (
        !entry ||
        entry.confidence !== "known" ||
        entry.placementIssues.length ||
        entry.analysis.risk === "two-fit"
      );
    }) ||
    (preserve &&
      options.placements.some((p) => !current.some((next) => next.id === p.id)))
  )
    return {
      ...repaired,
      objective: "fewest",
      status: "blocked",
      reason:
        "The final minimum-count proposal did not pass complete safety and coverage validation. No minimum-count proposal is ready.",
    };
  const byId = new Map(current.map((p) => [p.id, p]));
  const placements = [
    ...options.placements
      .filter((p) => byId.has(p.id))
      .map((p) => byId.get(p.id)!),
    ...current.filter((p) => !originals.has(p.id)),
  ];
  const removedIds = options.placements
    .filter((p) => !byId.has(p.id))
    .map((p) => p.id);
  const movedIds = options.placements
    .filter(
      (p) =>
        byId.has(p.id) &&
        (p.x !== byId.get(p.id)!.x || p.y !== byId.get(p.id)!.y),
    )
    .map((p) => p.id);
  const finalAudit = auditIndex(
    new SafetyIndex(placements, options.terrainAt),
    false,
  );
  const comparison =
    scopedIds.length < startCount
      ? `Reduced from a verified ${startCount}-HQ packing.`
      : `The verified starting packing also used ${startCount} HQs.`;
  const reason = `Fewest found: ${scopedIds.length} HQs inside this boundary. ${comparison} Zero two-HQ loss warnings and zero open enemy HQ centers remain. ${preserve ? "All existing assignments were retained." : `${removedIds.length} existing inside assignments are removed in this preview.`} This bounded search does not prove a global minimum.${limited ? " The minimization work limit was reached." : ""}`;
  return {
    ...repaired,
    objective: "fewest",
    coverageComplete: true,
    placements,
    after,
    audit: finalAudit,
    movedIds,
    removedIds,
    addedIds: placements.filter((p) => !originals.has(p.id)).map((p) => p.id),
    scopedIds,
    status: "resolved",
    truncated: repaired.truncated || limited,
    reason,
    evaluated: repaired.evaluated + nodes,
    passes: repaired.passes + reductions,
    outsideTwoFitAfter: audit.summary.twoFitCount - after.twoFit,
    openCenterSamples: [],
  };
}
