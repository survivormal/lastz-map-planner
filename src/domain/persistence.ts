import { PlanSchema, coordinateToken, type Plan } from "./schema";

export { coordinateToken } from "./schema";

export const MAX_PLAN_BYTES = 2 * 1024 * 1024;
export const MAX_SHARE_FRAGMENT_LENGTH = 12_000;
export const LOCAL_STORAGE_KEY = "lastz-map-planner:v1";
const SHARE_PREFIX = "#lz1=";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type PlanStorage = Pick<Storage, "getItem" | "setItem">;

/** Validate before callers replace their current plan. This function has no side effects. */
export function parsePlan(text: string): Result<Plan> {
  if (
    text.length > MAX_PLAN_BYTES ||
    new TextEncoder().encode(text).length > MAX_PLAN_BYTES
  ) {
    return { ok: false, error: "This plan exceeds the 2 MiB import limit." };
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "This file is not valid JSON. Your current plan has not changed.",
    };
  }
  if (
    input &&
    typeof input === "object" &&
    "schemaVersion" in input &&
    input.schemaVersion !== 1
  ) {
    return {
      ok: false,
      error:
        "This plan uses an unsupported format version. Expected version 1.",
    };
  }
  const result = PlanSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.map(String).join(".") || "plan";
    return { ok: false, error: `Invalid ${path}: ${issue.message}` };
  }
  return { ok: true, value: result.data };
}

export function serializePlan(plan: Plan): Result<string> {
  const result = PlanSchema.safeParse(plan);
  if (!result.success)
    return {
      ok: false,
      error: "The plan contains invalid data and could not be saved.",
    };
  const text = JSON.stringify(result.data, null, 2);
  if (new TextEncoder().encode(text).length > MAX_PLAN_BYTES) {
    return { ok: false, error: "This plan exceeds the 2 MiB save limit." };
  }
  return { ok: true, value: text };
}

function browserStorage(): PlanStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function loadLocalPlan(storage?: PlanStorage): Result<Plan | null> {
  try {
    const target = storage ?? browserStorage();
    if (!target)
      return {
        ok: false,
        error: "Browser storage is unavailable. Export JSON to keep your plan.",
      };
    const saved = target.getItem(LOCAL_STORAGE_KEY);
    if (saved === null) return { ok: true, value: null };
    const parsed = parsePlan(saved);
    if (!parsed.ok)
      return {
        ok: false,
        error: `Saved plan could not be loaded: ${parsed.error} The saved data was kept.`,
      };
    return parsed;
  } catch {
    return {
      ok: false,
      error:
        "Browser storage could not be read. Export JSON to keep your plan.",
    };
  }
}

/** localStorage.setItem is atomic: a failed write leaves the previous saved value intact. */
export function saveLocalPlan(plan: Plan, storage?: PlanStorage): Result<void> {
  const serialized = serializePlan(plan);
  if (!serialized.ok) return serialized;
  try {
    const target = storage ?? browserStorage();
    if (!target)
      return {
        ok: false,
        error: "Browser storage is unavailable. Export JSON to keep your plan.",
      };
    target.setItem(LOCAL_STORAGE_KEY, serialized.value);
    return { ok: true, value: undefined };
  } catch {
    return {
      ok: false,
      error:
        "This plan could not be saved in this browser. Export JSON before closing the page.",
    };
  }
}

function csvCell(value: string | number): string {
  const text = String(value);
  // Quoting alone does not stop spreadsheet formulas. Prefix formulas and control characters.
  const safe =
    /^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportAssignmentsCsv(plan: Plan): string {
  const groups = new Map(plan.groups.map((group) => [group.id, group.name]));
  const rows: (string | number)[][] = [
    ["Server", "Group", "Assignment", "Kind", "X", "Y", "Coordinate token"],
    ...plan.placements.map((placement) => [
      plan.server,
      groups.get(placement.groupId) ?? placement.groupId,
      placement.name,
      placement.kind,
      placement.x,
      placement.y,
      coordinateToken(placement, plan.server),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

async function readLimitedStream(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new Error("size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Return a URL fragment only. Fragments are not submitted to the app server. */
export async function createShareFragment(plan: Plan): Promise<Result<string>> {
  const serialized = serializePlan(plan);
  if (!serialized.ok) return serialized;
  if (typeof CompressionStream === "undefined") {
    return {
      ok: false,
      error:
        "This browser cannot create compact links. Export the plan as JSON instead.",
    };
  }
  try {
    const compact = JSON.stringify(JSON.parse(serialized.value));
    const stream = new Response(compact).body!.pipeThrough(
      new CompressionStream("gzip"),
    );
    const bytes = await readLimitedStream(stream, MAX_PLAN_BYTES);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const encoded = btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const fragment = SHARE_PREFIX + encoded;
    if (fragment.length > MAX_SHARE_FRAGMENT_LENGTH) {
      return {
        ok: false,
        error:
          "This plan is too large for a reliable share link. Export JSON instead.",
      };
    }
    return { ok: true, value: fragment };
  } catch {
    return {
      ok: false,
      error: "A share link could not be created. Export JSON instead.",
    };
  }
}

export async function parseShareFragment(
  fragment: string,
): Promise<Result<Plan>> {
  if (
    !fragment.startsWith(SHARE_PREFIX) ||
    fragment.length > MAX_SHARE_FRAGMENT_LENGTH
  ) {
    return {
      ok: false,
      error:
        "This is not a supported plan link, or it exceeds the link size limit.",
    };
  }
  if (typeof DecompressionStream === "undefined") {
    return {
      ok: false,
      error:
        "This browser cannot open compact links. Import a JSON export instead.",
    };
  }
  try {
    const encoded = fragment.slice(SHARE_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded))
      throw new Error("invalid encoding");
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    const compressed = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const stream = new Response(compressed).body!.pipeThrough(
      new DecompressionStream("gzip"),
    );
    const bytes = await readLimitedStream(stream, MAX_PLAN_BYTES);
    return parsePlan(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return {
      ok: false,
      error:
        "This plan link is damaged or exceeds the import size limit. Your current plan has not changed.",
    };
  }
}
