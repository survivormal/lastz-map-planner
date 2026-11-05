/** Readiness probe for the generated Node server. No game connection is needed. */
export function GET() {
  return Response.json(
    { status: "ok", application: "lastz-map-planner" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
