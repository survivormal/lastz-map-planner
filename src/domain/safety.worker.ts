import { terrainLookup } from "../data/terrain";
import { auditPlacementSafety, findTighteningSuggestions } from "./edge-safety";
import type {
  SafetyWorkerRequest,
  SafetyWorkerResponse,
} from "./safety-worker";

// The worker uses only the shared message APIs, so this file needs no global WebWorker lib.
self.onmessage = (event: MessageEvent<SafetyWorkerRequest>) => {
  const request = event.data;
  try {
    const { plan } = request;
    const options = {
      terrainAt: terrainLookup(plan).rules,
      allowUnknown: plan.settings.allowUnknown,
    };
    const response: SafetyWorkerResponse =
      request.type === "audit"
        ? {
            id: request.id,
            type: "audit",
            result: auditPlacementSafety(plan.placements, options),
          }
        : {
            id: request.id,
            type: "tighten",
            result: findTighteningSuggestions(
              request.selectedId,
              plan.placements,
              options,
            ),
          };
    self.postMessage(response);
  } catch (error) {
    const response: SafetyWorkerResponse = {
      id: request.id,
      type: "error",
      message:
        error instanceof Error ? error.message : "Safety analysis failed.",
    };
    self.postMessage(response);
  }
};
