import { z } from "zod";
import { CustomStrategySchema } from "./strategy-schema";

const coordinate = z.number().int().min(0).max(999);
const id = z.string().min(1).max(120);
const name = z.string().trim().min(1).max(160);
export const TileSchema = z.object({ x: coordinate, y: coordinate });
export const TerrainSchema = z.enum(["grass", "mud", "restricted", "unknown"]);
export const SpacingSchema = z.enum(["tile", "tight", "loose"]);
export const PlacementSchema = z.object({
  id,
  kind: z.enum(["hq", "food", "wood"]),
  x: coordinate,
  y: coordinate,
  name,
  groupId: id,
  showGraphic: z.boolean().default(false),
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

export const PlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name,
    server: z.number().int().positive().max(999999),
    placements: z.array(PlacementSchema).max(5000),
    groups: z.array(GroupSchema).min(1).max(100),
    boundaries: z.array(BoundarySchema).max(200),
    terrainOverrides: z
      .array(TileSchema.extend({ terrain: TerrainSchema }))
      .max(100000),
    strategies: z.array(CustomStrategySchema).max(100).default([]),
    settings: z.object({
      spacing: SpacingSchema,
      strategyId: z.string().max(80).default("regular"),
      formation: z.enum(["single", "daisy", "grass", "mud"]).default("single"),
      rotation: z.number().int().min(0).max(5).default(0),
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
    plan.placements.forEach((placement, index) => {
      if (!groups.has(placement.groupId))
        ctx.addIssue({
          code: "custom",
          message: "Placement refers to a missing group.",
          path: ["placements", index, "groupId"],
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
export type Terrain = z.infer<typeof TerrainSchema>;
export type Spacing = z.infer<typeof SpacingSchema>;

export function createPlan(planName = "Server 802 · SVS plan"): Plan {
  return {
    schemaVersion: 1,
    id: globalThis.crypto.randomUUID(),
    name: planName,
    server: 802,
    placements: [],
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
      strategyId: "regular",
      formation: "single",
      rotation: 0,
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
