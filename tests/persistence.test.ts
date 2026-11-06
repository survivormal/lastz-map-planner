import assert from "node:assert/strict";
import test from "node:test";
import { createPlan } from "../src/domain/schema";
import {
  createShareFragment,
  coordinateToken,
  exportAssignmentsCsv,
  loadLocalPlan,
  LOCAL_STORAGE_KEY,
  MAX_PLAN_BYTES,
  MAX_SHARE_FRAGMENT_LENGTH,
  parsePlan,
  parseShareFragment,
  saveLocalPlan,
  serializePlan,
  type PlanStorage,
} from "../src/domain/persistence";
import { POST } from "../src/routes/api/validate";
import { GET } from "../src/routes/api/health";

function memoryStorage(
  initial?: string,
): PlanStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(LOCAL_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

test("JSON round trip preserves names, groups, assignments, and display settings", () => {
  const plan = createPlan("802 · 泥地 plan");
  assert.equal(plan.settings.terrainStyle, "game");
  assert.equal(plan.settings.fillMode, "auto");
  plan.settings.terrainStyle = "tactical";
  plan.settings.fillMode = "exact";
  plan.placements.push({
    id: "hq-1",
    kind: "hq",
    x: 425,
    y: 341,
    name: "DANIMAL042",
    groupId: "mud",
    showGraphic: true,
  });
  const result = serializePlan(plan);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const loaded = parsePlan(result.value);
  assert.deepEqual(loaded, { ok: true, value: plan });
  const legacy = parsePlan(
    JSON.stringify({
      ...plan,
      settings: {
        ...plan.settings,
        terrainStyle: undefined,
        fillMode: undefined,
      },
    }),
  );
  assert.deepEqual(legacy, {
    ok: true,
    value: {
      ...plan,
      settings: { ...plan.settings, terrainStyle: "game", fillMode: "auto" },
    },
  });
  assert.equal(
    coordinateToken(plan.placements[0], plan.server),
    "[#:802 X:425 Y:341]",
  );
});

test("invalid JSON, unsupported versions, and broken references are rejected without changing saved data", () => {
  const original = createPlan("Saved plan");
  const storage = memoryStorage();
  assert.equal(saveLocalPlan(original, storage).ok, true);
  const before = storage.values.get(LOCAL_STORAGE_KEY);
  assert.equal(parsePlan("{broken").ok, false);
  assert.equal(
    parsePlan(JSON.stringify({ ...original, schemaVersion: 999 })).ok,
    false,
  );
  const broken = createPlan();
  broken.placements.push({
    id: "missing-group",
    kind: "hq",
    x: 500,
    y: 500,
    name: "Invalid",
    groupId: "gone",
    showGraphic: false,
  });
  assert.equal(saveLocalPlan(broken, storage).ok, false);
  assert.equal(storage.values.get(LOCAL_STORAGE_KEY), before);
  assert.deepEqual(loadLocalPlan(storage), { ok: true, value: original });
});

test("import limit counts UTF-8 bytes, not JavaScript string characters", () => {
  const text = '"' + "é".repeat(MAX_PLAN_BYTES / 2) + '"';
  assert.ok(text.length < MAX_PLAN_BYTES);
  const result = parsePlan(text);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /2 MiB/);
});

test("storage failure is reported and corrupted storage is retained", () => {
  const corrupted = memoryStorage("unreadable data");
  const load = loadLocalPlan(corrupted);
  assert.equal(load.ok, false);
  assert.equal(corrupted.values.get(LOCAL_STORAGE_KEY), "unreadable data");
  const unavailable: PlanStorage = {
    getItem: () => {
      throw new Error("Access denied");
    },
    setItem: () => {
      throw new Error("Quota exceeded");
    },
  };
  assert.equal(loadLocalPlan(unavailable).ok, false);
  assert.equal(saveLocalPlan(createPlan(), unavailable).ok, false);
  assert.deepEqual(loadLocalPlan(memoryStorage()), { ok: true, value: null });
});

test("assignment CSV escapes quotes, newlines, and spreadsheet formulas", () => {
  const plan = createPlan();
  plan.groups[0].name = "@SUM(1,2)";
  plan.placements.push({
    id: "hq-1",
    kind: "hq",
    x: 425,
    y: 341,
    name: '  =HYPERLINK("bad")\nSpot',
    groupId: "daisy",
    showGraphic: false,
  });
  const csv = exportAssignmentsCsv(plan);
  assert.ok(csv.includes('"\'@SUM(1,2)"'));
  assert.ok(csv.includes('"\'  =HYPERLINK(""bad"")\nSpot"'));
  assert.ok(csv.includes('"[#:802 X:425 Y:341]"'));
  assert.ok(csv.endsWith("\r\n"));
});

test("compressed share links round trip and reject malformed or excessive fragments", async () => {
  const plan = createPlan("Share me · 802");
  const encoded = await createShareFragment(plan);
  assert.equal(encoded.ok, true);
  if (!encoded.ok) return;
  assert.ok(encoded.value.startsWith("#lz1="));
  assert.deepEqual(await parseShareFragment(encoded.value), {
    ok: true,
    value: plan,
  });
  assert.equal((await parseShareFragment("#lz1=not-gzip")).ok, false);
  assert.equal((await parseShareFragment("#unknown=abc")).ok, false);
  assert.equal(
    (await parseShareFragment("#lz1=" + "a".repeat(MAX_SHARE_FRAGMENT_LENGTH)))
      .ok,
    false,
  );
});

test("a highly compressed oversized share payload is rejected during decompression", async () => {
  const compressed = await new Response(
    new Response(" ".repeat(MAX_PLAN_BYTES + 1)).body!.pipeThrough(
      new CompressionStream("gzip"),
    ),
  ).arrayBuffer();
  const encoded = Buffer.from(compressed).toString("base64url");
  const result = await parseShareFragment("#lz1=" + encoded);
  assert.equal(result.ok, false);
});

test("stateless API accepts plans and rejects invalid input and oversized streamed bodies", async () => {
  const plan = createPlan("API plan");
  const request = (
    body: string,
    headers: Record<string, string> = { "Content-Type": "application/json" },
  ) =>
    new Request("http://localhost/api/validate", {
      method: "POST",
      headers,
      body,
    });
  const response = await POST({ request: request(JSON.stringify(plan)) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { valid: true, plan });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await POST({ request: request("{}") })).status, 400);
  assert.equal((await POST({ request: request("not JSON") })).status, 400);
  assert.equal(
    (await POST({ request: request("{}", { "Content-Type": "text/plain" }) }))
      .status,
    415,
  );
  assert.equal(
    (await POST({ request: request(" ".repeat(MAX_PLAN_BYTES + 1)) })).status,
    413,
  );
  assert.equal(
    (
      await POST({
        request: request("{}", {
          "Content-Type": "application/json",
          "Content-Length": String(MAX_PLAN_BYTES + 1),
        }),
      })
    ).status,
    413,
  );
  assert.equal(GET().status, 200);
});
