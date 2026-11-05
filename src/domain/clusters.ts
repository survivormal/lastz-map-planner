import {
  distance,
  footprint,
  fromAxial,
  inWorld,
  toAxial,
  type Axial,
} from "./geometry";
import { orientVector } from "./orientation";
import { validatePlacement, type TerrainLookup } from "./placement";
import type { Cluster, Placement, Plan } from "./schema";

export type ClusterTransform = { turns?: number; flip?: boolean };
export type ClusterTransformResult =
  | { valid: true; issues: []; placements: Placement[]; cluster: Cluster }
  | {
      valid: false;
      issues: string[];
      placements: Placement[];
      cluster: Cluster | null;
    };

/**
 * Transform the remaining members around their saved anchor as one planning edit.
 * This is not a game teleport: old member footprints are vacated simultaneously.
 * A symmetric Daisy can keep the same occupied set while its named positions rotate.
 */
export function transformCluster(
  plan: Plan,
  clusterId: string,
  action: ClusterTransform,
  terrainAt: TerrainLookup,
): ClusterTransformResult {
  const original = plan.clusters.find((cluster) => cluster.id === clusterId);
  const failure = (issues: string[]): ClusterTransformResult => ({
    valid: false,
    issues,
    placements: plan.placements,
    cluster: original ?? null,
  });
  if (!original) return failure(["Choose an existing formation cluster."]);
  const turns = action.turns ?? 0;
  if (
    !Number.isSafeInteger(turns) ||
    (action.flip !== undefined && typeof action.flip !== "boolean")
  ) {
    return failure([
      "Use whole 60-degree turns and a true/false mirror setting.",
    ]);
  }
  const rotation = (((original.rotation + (turns % 6)) % 6) + 6) % 6;
  const mirrored = action.flip ? !original.mirrored : original.mirrored;
  const cluster: Cluster = { ...original, rotation, mirrored };
  const anchor = toAxial(cluster.anchor);
  const transform = (placement: Placement): Placement => {
    const position = toAxial(placement);
    const relative: Axial = {
      q: position.q - anchor.q,
      r: position.r - anchor.r,
    };
    // Invert R*M with M*R^-1, then apply the requested local orientation.
    const unrotated = orientVector(relative, -original.rotation);
    const canonical = orientVector(unrotated, 0, original.mirrored);
    const oriented = orientVector(canonical, rotation, mirrored);
    return {
      ...placement,
      ...fromAxial({ q: anchor.q + oriented.q, r: anchor.r + oriented.r }),
    };
  };
  const members = plan.placements
    .filter((placement) => placement.clusterId === clusterId)
    .map(transform);
  const remaining = plan.placements.filter(
    (placement) => placement.clusterId !== clusterId,
  );
  const accepted = [...remaining];
  const issues = new Set<string>();
  for (const member of members) {
    const validation = validatePlacement(member, accepted, {
      terrainAt,
      spacing: "tile",
      allowUnknown: plan.settings.allowUnknown,
      allianceAnchor: plan.allianceAnchor ?? undefined,
      allianceAnchorKind: plan.allianceAnchorKind,
    });
    validation.issues.forEach((issue) =>
      issues.add(`${member.name}: ${issue}`),
    );
    if (
      cluster.terrain !== "any" &&
      footprint(member).some((tile) => {
        if (!inWorld(tile)) return false; // The footprint-bounds issue is already reported above.
        const terrain = terrainAt(tile);
        return terrain === "unknown"
          ? !plan.settings.allowUnknown
          : terrain !== cluster.terrain;
      })
    )
      issues.add(
        `${member.name}: the full footprint must stay on ${cluster.terrain}.`,
      );
    for (const other of accepted) {
      const separation = distance(member, other);
      if (separation >= 3 && separation < 3 + cluster.minGap) {
        issues.add(
          `${member.name}: needs ${cluster.minGap} empty tile${cluster.minGap === 1 ? "" : "s"} before ${other.name}.`,
        );
      }
    }
    accepted.push(member);
  }
  if (issues.size) return failure([...issues]);
  const byId = new Map(members.map((member) => [member.id, member]));
  return {
    valid: true,
    issues: [],
    placements: plan.placements.map(
      (placement) => byId.get(placement.id) ?? placement,
    ),
    cluster,
  };
}
