import { terrainLookup } from "../data/terrain";
import {
  auditPlacementSafety,
  findTighteningSuggestions,
  type PlacementSafetyAudit,
  type TighteningSearchResult,
} from "./edge-safety";
import type { Plan } from "./schema";

type SafetyJob =
  | { type: "audit"; plan: Plan }
  | { type: "tighten"; selectedId: string; plan: Plan };

export type SafetyWorkerRequest = SafetyJob & { id: number };
export type SafetyWorkerResponse =
  | { id: number; type: "audit"; result: PlacementSafetyAudit }
  | { id: number; type: "tighten"; result: TighteningSearchResult }
  | { id: number; type: "error"; message: string };

type SafetyResult = PlacementSafetyAudit | TighteningSearchResult;
type PendingJob = {
  request: SafetyWorkerRequest;
  resolve: (result: SafetyResult) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  fallback: boolean;
};

export type SafetyWorker = {
  audit: (plan: Plan) => Promise<PlacementSafetyAudit>;
  tighten: (selectedId: string, plan: Plan) => Promise<TighteningSearchResult>;
  dispose: () => void;
};

function disposedError(): Error {
  const error = new Error("Safety worker has been disposed.");
  error.name = "AbortError";
  return error;
}

/** Call on mount. Importing this module does not create a Worker or access browser globals. */
export function createSafetyWorker(): SafetyWorker {
  const pending = new Map<number, PendingJob>();
  let nextId = 0;
  let disposed = false;
  let worker: Worker | undefined;

  function terminateWorker() {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = undefined;
  }

  function finish(job: PendingJob, result: SafetyResult | Error) {
    if (pending.get(job.request.id) !== job) return;
    pending.delete(job.request.id);
    clearTimeout(job.timer);
    if (result instanceof Error) job.reject(result);
    else job.resolve(result);
  }

  function fallback(job: PendingJob) {
    if (disposed || job.fallback || !pending.has(job.request.id)) return;
    job.fallback = true;
    clearTimeout(job.timer);
    // Yield before each fallback so the checking state paints and disposal can cancel queued work.
    job.timer = setTimeout(() => {
      if (disposed || pending.get(job.request.id) !== job) return;
      try {
        const { plan } = job.request;
        const options = {
          terrainAt: terrainLookup(plan).rules,
          allowUnknown: plan.settings.allowUnknown,
        };
        const result =
          job.request.type === "audit"
            ? auditPlacementSafety(plan.placements, options)
            : findTighteningSuggestions(
                job.request.selectedId,
                plan.placements,
                options,
              );
        finish(job, result);
      } catch (error) {
        finish(
          job,
          error instanceof Error ? error : new Error("Safety analysis failed."),
        );
      }
    }, 0);
  }

  function failWorker() {
    terminateWorker();
    for (const job of pending.values()) fallback(job);
  }

  if (typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("./safety.worker.ts", import.meta.url), {
        type: "module",
        name: "lastz-edge-safety",
      });
      worker.onmessage = (event: MessageEvent<SafetyWorkerResponse>) => {
        const response = event.data;
        if (!response || typeof response.id !== "number") return;
        const job = pending.get(response.id);
        if (!job || job.fallback) return;
        if (response.type === "error") {
          fallback(job);
        } else if (response.type === job.request.type && "result" in response) {
          finish(job, response.result);
        } else {
          failWorker();
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        failWorker();
      };
      worker.onmessageerror = failWorker;
    } catch {
      terminateWorker();
    }
  }

  function submit(
    job: Extract<SafetyJob, { type: "audit" }>,
  ): Promise<PlacementSafetyAudit>;
  function submit(
    job: Extract<SafetyJob, { type: "tighten" }>,
  ): Promise<TighteningSearchResult>;
  function submit(job: SafetyJob): Promise<SafetyResult> {
    if (disposed) return Promise.reject(disposedError());
    return new Promise((resolve, reject) => {
      const request = { ...job, id: ++nextId };
      const entry: PendingJob = { request, resolve, reject, fallback: false };
      pending.set(request.id, entry);
      if (!worker) {
        fallback(entry);
        return;
      }
      // Recover from workers that fail to load or stop responding without emitting an error.
      entry.timer = setTimeout(failWorker, 15_000);
      try {
        worker.postMessage(request);
      } catch {
        failWorker();
      }
    });
  }

  return {
    audit: (plan) => submit({ type: "audit", plan }),
    tighten: (selectedId, plan) =>
      submit({ type: "tighten", selectedId, plan }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      terminateWorker();
      for (const job of pending.values()) {
        clearTimeout(job.timer);
        job.reject(disposedError());
      }
      pending.clear();
    },
  };
}
