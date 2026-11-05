import { z } from "zod";

const AxialVectorSchema = z
  .object({
    q: z.number().int().min(-100).max(100),
    r: z.number().int().min(-100).max(100),
  })
  .strict();

/** Portable, declarative lattice definition. No executable code is accepted. */
export const StrategySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    basis: z.tuple([AxialVectorSchema, AxialVectorSchema]),
    minGap: z.number().int().min(0).max(10),
    terrain: z.enum(["any", "grass", "mud"]),
    rotation: z.number().int().min(0).max(5).default(0),
    provenance: z.string().trim().min(1).max(2000).optional(),
    source: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine(({ basis: [a, b] }) => a.q * b.r - a.r * b.q !== 0, {
    message: "The two lattice vectors must be linearly independent.",
    path: ["basis"],
  });

export type Strategy = z.infer<typeof StrategySchema>;

export const BUILTIN_STRATEGY_IDS: readonly string[] = [
  "regular-tile",
  "regular-tight",
  "regular-loose",
  "mud-tight",
  "grass-wide",
];

export const CustomStrategySchema = StrategySchema.refine(
  (strategy) => !BUILTIN_STRATEGY_IDS.includes(strategy.id),
  {
    message: "Built-in strategy IDs are reserved. Choose a different ID.",
    path: ["id"],
  },
);

export const STRATEGY_BASIS = {
  "mud-tight": [
    { q: 3, r: 1 },
    { q: -1, r: 4 },
  ],
  "grass-wide": [
    { q: 3, r: 2 },
    { q: -2, r: 5 },
  ],
} as const;
