import { z } from "zod";
import { CustomStrategySchema } from "./strategy-schema";

const coordinate = z.number().int().min(0).max(999);
const id = z.string().min(1).max(120);
const name = z.string().trim().min(1).max(160);
export const TileSchema = z.object({ x: coordinate, y: coordinate });
export const TerrainSchema = z.enum(["grass", "mud", "restricted", "unknown"]);
export const SpacingSchema = z.enum(["tile", "tight", "loose"]);
export const AllianceAnchorKindSchema = z.enum(["leader", "rally"]);
export const PlacementSchema = z.object({
  id,
  kind: z.enum(["hq", "food", "wood"]),
  x: coordinate,
  y: coordinate,
  name,
  groupId: id,
  showGraphic: z.boolean().default(false),
  clusterId: id.optional(),
});
export const GroupSchema = z.object({
  id,
  name,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export const BoundarySchema = z
  .object({
    id,
    name,
    points: z.array(TileSchema).min(2).max(2000),
    closed: z.boolean(),
  })
  .refine((boundary) => !boundary.closed || boundary.points.length >= 3, {
    message: "Closed boundaries need at least three points.",
    path: ["points"],
  });

/** Snapshot the placement rules so a saved cluster survives changes to the strategy registry. */
export const ClusterSchema = z.object({
  id,
  name,
  kind: z.enum(["daisy", "grass", "mud"]),
  anchor: TileSchema,
  rotation: z.number().int().min(0).max(5).default(0),
  mirrored: z.boolean().default(false),
  minGap: z.number().int().min(0).max(10),
  terrain: z.enum(["any", "grass", "mud"]),
});

export const PlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name,
    server: z.number().int().positive().max(999999),
    allianceAnchor: TileSchema.nullable().default(null),
    allianceAnchorKind: AllianceAnchorKindSchema.default("leader"),
    plotAnchor: TileSchema.nullable().default(null),
    placements: z.array(PlacementSchema).max(5000),
    clusters: z.array(ClusterSchema).max(5000).default([]),
    groups: z.array(GroupSchema).min(1).max(100),
    boundaries: z.array(BoundarySchema).max(200),
    terrainOverrides: z
      .array(TileSchema.extend({ terrain: TerrainSchema }))
      .max(100000),
    strategies: z.array(CustomStrategySchema).max(100).default([]),
    settings: z.object({
      spacing: SpacingSchema,
      terrainProfile: z
        .enum(["s1-standard", "unverified"])
        .default("s1-standard"),
      terrainStyle: z.enum(["game", "tactical"]).default("game"),
      fillMode: z.enum(["auto", "exact"]).default("auto"),
      strategyId: z.string().max(80).default("regular"),
      formation: z.enum(["single", "daisy", "grass", "mud"]).default("single"),
      rotation: z.number().int().min(0).max(5).default(0),
      mirrored: z.boolean().default(false),
      plotGuide: z.boolean().default(true),
      showSafety: z.boolean().default(true),
      showGrid: z.boolean(),
      showLabels: z.boolean(),
      showGraphics: z.boolean(),
      allowUnknown: z.boolean().default(false),
    }),
  })
  .superRefine((plan, ctx) => {
    for (const field of [
      "placements",
      "groups",
      "boundaries",
      "strategies",
      "clusters",
    ] as const) {
      const seen = new Set<string>();
      plan[field].forEach((item, index) => {
        if (seen.has(item.id))
          ctx.addIssue({
            code: "custom",
            message: "IDs must be unique.",
            path: [field, index, "id"],
          });
        seen.add(item.id);
      });
    }
    const groups = new Set(plan.groups.map((group) => group.id));
    const clusters = new Set(plan.clusters.map((cluster) => cluster.id));
    plan.placements.forEach((placement, index) => {
      if (!groups.has(placement.groupId))
        ctx.addIssue({
          code: "custom",
          message: "Placement refers to a missing group.",
          path: ["placements", index, "groupId"],
        });
      if (placement.clusterId && !clusters.has(placement.clusterId))
        ctx.addIssue({
          code: "custom",
          message: "Placement refers to a missing cluster.",
          path: ["placements", index, "clusterId"],
        });
    });
    const terrainCells = new Set<string>();
    plan.terrainOverrides.forEach((tile, index) => {
      const key = `${tile.x},${tile.y}`;
      if (terrainCells.has(key))
        ctx.addIssue({
          code: "custom",
          message: "A terrain cell may only be overridden once.",
          path: ["terrainOverrides", index],
        });
      terrainCells.add(key);
    });
  });

export type Plan = z.infer<typeof PlanSchema>;
export type Placement = z.infer<typeof PlacementSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Boundary = z.infer<typeof BoundarySchema>;
export type Cluster = z.infer<typeof ClusterSchema>;
export type FormationCluster = Cluster;
export type Terrain = z.infer<typeof TerrainSchema>;
export type Spacing = z.infer<typeof SpacingSchema>;
export type AllianceAnchorKind = z.infer<typeof AllianceAnchorKindSchema>;

export function createPlan(planName = "Server 802 · SVS plan"): Plan {
  return {
    schemaVersion: 1,
    id: globalThis.crypto.randomUUID(),
    name: planName,
    server: 802,
    allianceAnchor: null,
    allianceAnchorKind: "leader",
    plotAnchor: null,
    placements: [],
    clusters: [],
    groups: [
      { id: "daisy", name: "Daisy Group", color: "#b5a0f5" },
      { id: "grass", name: "Grass Group", color: "#7dd3a8" },
      { id: "mud", name: "Mud Group", color: "#8ebdef" },
    ],
    boundaries: [],
    terrainOverrides: [],
    strategies: [],
    settings: {
      spacing: "tile",
      terrainProfile: "s1-standard",
      terrainStyle: "game",
      fillMode: "auto",
      strategyId: "regular",
      formation: "single",
      rotation: 0,
      mirrored: false,
      plotGuide: true,
      showSafety: true,
      showGrid: true,
      showLabels: true,
      showGraphics: false,
      allowUnknown: false,
    },
  };
}

export function coordinateToken(
  tile: { x: number; y: number },
  server = 802,
): string {
  return `[#:${server} X:${tile.x} Y:${tile.y}]`;
}
