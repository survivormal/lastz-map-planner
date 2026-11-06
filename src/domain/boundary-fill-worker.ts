import type { Plan } from "./schema";
import type {
  BoundaryOptimizationOptions,
  BoundaryOptimizationResult,
} from "./boundary-optimizer";

export type BoundaryFillInput = Omit<
  BoundaryOptimizationOptions,
  "placements" | "terrainAt" | "makeId"
>;
export type BoundaryFillJob = { plan: Plan; options: BoundaryFillInput };
export type BoundaryFillResponse =
  | { ok: true; result: BoundaryOptimizationResult }
  | { ok: false; message: string };

/** One dedicated worker per search. Cancellation stops CPU work as well as ignoring its result. */
export function optimizeBoundaryInWorker(
  plan: Plan,
  options: BoundaryFillInput,
): {
  promise: Promise<BoundaryOptimizationResult>;
  cancel: () => void;
} {
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectJob: ((error: Error) => void) | undefined;
  let settled = false;
  const cleanup = () => {
    clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
  };
  const promise = new Promise<BoundaryOptimizationResult>((resolve, reject) => {
    rejectJob = reject;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    try {
      worker = new Worker(
        new URL("./boundary-fill.worker.ts", import.meta.url),
        {
          type: "module",
          name: "lastz-boundary-optimizer",
        },
      );
      worker.onmessage = (event: MessageEvent<BoundaryFillResponse>) => {
        if (settled) return;
        const response = event.data;
        if (!response?.ok) {
          fail(
            new Error(response?.message || "Automatic fill could not finish."),
          );
          return;
        }
        settled = true;
        cleanup();
        resolve(response.result);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail(
          new Error(
            "Automatic fill could not start. Reload the planner and retry.",
          ),
        );
      };
      worker.onmessageerror = () =>
        fail(new Error("The optimizer returned an unreadable result."));
      timer = setTimeout(
        () =>
          fail(
            new Error(
              "The search reached its time limit. Try a smaller boundary.",
            ),
          ),
        45_000,
      );
      worker.postMessage({ plan, options } satisfies BoundaryFillJob);
    } catch (error) {
      fail(
        error instanceof Error
          ? error
          : new Error("This browser could not start automatic fill."),
      );
    }
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
      const error = new Error("Automatic fill canceled.");
      error.name = "AbortError";
      rejectJob?.(error);
    },
  };
}
