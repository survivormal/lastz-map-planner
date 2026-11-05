import assert from "node:assert/strict";
import test from "node:test";
import { createPlan, PlanSchema } from "../src/domain";
import {
  parsePlan,
  serializePlan,
  createShareFragment,
  parseShareFragment,
} from "../src/domain/persistence";

test("legacy plans get an unanchored plot without changing existing assignments", () => {
  const plan = createPlan();
  plan.placements.push({
    id: "legacy-hq",
    name: "Player One",
    x: 500,
    y: 475,
    kind: "hq",
    groupId: "mud",
    showGraphic: false,
  });
  const { plotAnchor: _anchor, ...legacy } = plan;
  const { plotGuide: _guide, ...settings } = legacy.settings;
  const restored = PlanSchema.parse({ ...legacy, settings });
  assert.equal(restored.plotAnchor, null);
  assert.equal(restored.settings.plotGuide, true);
  assert.deepEqual(restored.placements, plan.placements);
  assert.equal(
    PlanSchema.safeParse({ ...plan, plotAnchor: { x: -1, y: 475 } }).success,
    false,
  );
});

test("plot anchor, snapping preference and orientation survive JSON and shared plans", async () => {
  const plan = createPlan();
  plan.plotAnchor = { x: 500, y: 475 };
  plan.settings.strategyId = "mud-tight";
  plan.settings.plotGuide = false;
  plan.settings.rotation = 2;
  plan.settings.mirrored = true;
  const serialized = serializePlan(plan);
  assert.equal(serialized.ok, true);
  if (serialized.ok) {
    const restored = parsePlan(serialized.value);
    assert.equal(restored.ok, true);
    if (restored.ok) assert.deepEqual(restored.value, plan);
  }
  const shared = await createShareFragment(plan);
  assert.equal(shared.ok, true);
  if (shared.ok) {
    const received = await parseShareFragment(shared.value);
    assert.equal(received.ok, true);
    if (received.ok) assert.deepEqual(received.value, plan);
  }
});
