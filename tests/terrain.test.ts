import test from "node:test";
import assert from "node:assert/strict";
import { createPlan, PlanSchema } from "../src/domain/schema";
import { terrainLookup } from "../src/data/terrain";

test("standard S1 selects decoded terrain and unsupported profiles fail closed", () => {
  const plan = createPlan();
  const lookup = terrainLookup(plan);
  assert.equal(lookup.rules({ x: 500, y: 500 }), "restricted");
  assert.equal(lookup.rules({ x: 518, y: 500 }), "restricted");
  assert.equal(lookup.verified({ x: 477, y: 477 }), true);
  plan.settings.terrainProfile = "unverified";
  const unknown = terrainLookup(plan);
  assert.equal(unknown.display({ x: 500, y: 500 }), "unknown");
  assert.equal(unknown.rules({ x: 477, y: 477 }), "unknown");
  assert.equal(unknown.verified({ x: 477, y: 477 }), false);
});

test("user terrain overrides remain explicit, including unknown cells", () => {
  const plan = createPlan();
  plan.terrainOverrides = [
    { x: 477, y: 477, terrain: "unknown" },
    { x: 500, y: 500, terrain: "grass" },
  ];
  const lookup = terrainLookup(plan);
  assert.equal(lookup.rules({ x: 477, y: 477 }), "unknown");
  assert.equal(lookup.verified({ x: 477, y: 477 }), false);
  assert.equal(lookup.rules({ x: 500, y: 500 }), "grass");
  assert.equal(lookup.verified({ x: 500, y: 500 }), true);
  const legacy = JSON.parse(JSON.stringify(plan));
  delete legacy.settings.terrainProfile;
  assert.equal(PlanSchema.parse(legacy).settings.terrainProfile, "s1-standard");
});
