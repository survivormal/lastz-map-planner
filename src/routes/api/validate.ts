import type { APIEvent } from "@solidjs/start/server";
import { MAX_PLAN_BYTES, parsePlan } from "../../domain/persistence";

function failure(error: string, status: number): Response {
  return Response.json(
    { valid: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Stateless validation; does not persist plans or contact the game. */
export async function POST({
  request,
}: Pick<APIEvent, "request">): Promise<Response> {
  const type = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (type !== "application/json")
    return failure("Send a plan with Content-Type: application/json.", 415);
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null && Number(lengthHeader) > MAX_PLAN_BYTES) {
    return failure("The request exceeds the 2 MiB limit.", 413);
  }
  if (!request.body) return failure("A JSON plan is required.", 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PLAN_BYTES) {
        await reader.cancel();
        return failure("The request exceeds the 2 MiB limit.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return failure("The JSON request could not be read.", 400);
  } finally {
    reader.releaseLock();
  }
  const parsed = parsePlan(text);
  if (!parsed.ok) return failure(parsed.error, 400);
  return Response.json(
    { valid: true, plan: parsed.value },
    { headers: { "Cache-Control": "no-store" } },
  );
}
