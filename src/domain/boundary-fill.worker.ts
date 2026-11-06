import { terrainLookup } from "../data/terrain";
import { optimizeBoundaryFill } from "./boundary-optimizer";
import type {
  BoundaryFillJob,
  BoundaryFillResponse,
} from "./boundary-fill-worker";

self.onmessage = (event: MessageEvent<BoundaryFillJob>) => {
  const { plan, options } = event.data;
  let response: BoundaryFillResponse;
  try {
    response = {
      ok: true,
      result: optimizeBoundaryFill({
        ...options,
        placements: plan.placements,
        terrainAt: terrainLookup(plan).rules,
      }),
    };
  } catch (error) {
    response = {
      ok: false,
      message:
        error instanceof Error ? error.message : "Automatic fill failed.",
    };
  }
  self.postMessage(response);
};
