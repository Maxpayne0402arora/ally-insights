import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useSkuData } from "@/context/SkuDataContext";
import { TOP3_EDITS_PROMPT_VERSION, TOP3_EDITS_SYSTEM_PROMPT } from "@/prompts/top3Edits";
import {
  buildPayload,
  extractJson,
  formatFailuresForRetry,
  INVALID_JSON_MSG,
  normalize,
  runGuardrail,
  type AiResult,
  type GuardFailure,
} from "@/lib/top3";
import type { Sku } from "@/types/sku";

const STORAGE_KEY = "ally.top3.v1";
const TIMEOUT_MS = 90_000;

export type ErrorCode = "timeout" | "rate_limit" | "credits" | "too_large" | "network" | "other";

export type AttemptLog = {
  attempt: number;
  userMessage: string;
  raw: string | null;
  model: string | null;
  finish_reason: string | null;
  usage: unknown;
  httpError?: string;
  parseError?: string;
  failures: GuardFailure[];
};

export type StoredResult = {
  cacheKey: string;
  datasetId: string;
  sku_id: string;
  promptVersion: string;
  generatedAt: string;
  durationMs: number;
  model: string | null;
  system: string;
  userPayload: string;
  attempts: AttemptLog[];
  keptAttempt: number;
  result: AiResult;
  failures: GuardFailure[];
};

export type JobState =
  | { status: "running"; startedAt: number }
  | { status: "error"; code: ErrorCode; detail: string; log?: Partial<StoredResult> };

type Ctx = {
  cacheKeyFor: (skuId: string) => string;
  results: Record<string, StoredResult>;
  jobs: Record<string, JobState>;
  generate: (sku: Sku) => void;
  cancel: (skuId: string) => void;
};

const GenerationContext = createContext<Ctx | null>(null);

class GenError extends Error {
  constructor(public code: ErrorCode, public detail: string) {
    super(detail);
  }
}

type CallResult = { text: string; model: string; finish_reason: string; usage: unknown };

async function callOnce(system: string, user: string, signal: AbortSignal): Promise<CallResult> {
  let res: Response;
  try {
    res = await fetch("/api/generate-edits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system, user }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new GenError("network", e instanceof Error ? e.message : "Network error");
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const b = (await res.json()) as { error?: string; message?: string };
      detail = `HTTP ${res.status} · ${b.error ?? ""} · ${b.message ?? ""}`;
    } catch {
      /* ignore */
    }
    const code: ErrorCode =
      res.status === 429 ? "rate_limit" : res.status === 402 ? "credits" : res.status === 413 ? "too_large" : "other";
    throw new GenError(code, detail);
  }
  return (await res.json()) as CallResult;
}

function readStorage(): Record<string, StoredResult> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, StoredResult>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function GenerationProvider({ children }: { children: ReactNode }) {
  const { skus, datasetId, isDismissed } = useSkuData();
  const router = useRouter();
  const [results, setResults] = useState<Record<string, StoredResult>>({});
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const controllers = useRef<Record<string, AbortController>>({});
  const latest = useRef({ skus, datasetId, isDismissed });
  latest.current = { skus, datasetId, isDismissed };

  useEffect(() => setResults(readStorage()), []);

  const cacheKeyFor = useCallback(
    (skuId: string) => `${datasetId}:${skuId}:${TOP3_EDITS_PROMPT_VERSION}`,
    [datasetId],
  );

  const setJob = (key: string, job: JobState | null) =>
    setJobs((prev) => {
      const next = { ...prev };
      if (job) next[key] = job;
      else delete next[key];
      return next;
    });

  const generate = useCallback(
    (sku: Sku) => {
      const { skus: allSkus, datasetId: startDataset, isDismissed: dismissed } = latest.current;
      const key = `${startDataset}:${sku.sku_id}:${TOP3_EDITS_PROMPT_VERSION}`;
      if (controllers.current[key]) return;

      const ctrl = new AbortController();
      controllers.current[key] = ctrl;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, TIMEOUT_MS);
      const startedAt = Date.now();
      setJob(key, { status: "running", startedAt });

      const built = buildPayload(sku, allSkus, (id) => dismissed(sku.sku_id, id));
      const system = TOP3_EDITS_SYSTEM_PROMPT;
      const user = JSON.stringify(built.payload);
      const attempts: AttemptLog[] = [];
      const outcomes: ({ result: AiResult; failures: GuardFailure[] } | null)[] = [];

      const evaluate = (n: number, userMessage: string, call: CallResult) => {
        const log: AttemptLog = {
          attempt: n, userMessage, raw: call.text, model: call.model, finish_reason: call.finish_reason, usage: call.usage, failures: [],
        };
        let outcome: { result: AiResult; failures: GuardFailure[] } | null = null;
        if (call.finish_reason !== "stop") {
          log.parseError = `Output was cut off (finish_reason: ${call.finish_reason}).`;
        } else {
          try {
            const norm = normalize(extractJson(call.text));
            outcome = runGuardrail(norm.result, norm.failures, { sku, allSkus, built });
          } catch (e) {
            log.parseError = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        log.failures = outcome ? outcome.failures : [{ edit_rank: null, check: "parse", detail: log.parseError ?? "Invalid output" }];
        attempts.push(log);
        outcomes.push(outcome);
        return { log, outcome };
      };

      (async () => {
        try {
          const a1 = evaluate(1, user, await callOnce(system, user, ctrl.signal));
          if (a1.log.failures.length) {
            const retryMsg = a1.outcome ? formatFailuresForRetry(a1.outcome.failures) : INVALID_JSON_MSG;
            const user2 = `${user}\n\n${retryMsg}`;
            try {
              evaluate(2, user2, await callOnce(system, user2, ctrl.signal));
            } catch (e) {
              if (ctrl.signal.aborted || !a1.outcome) throw e;
              attempts.push({
                attempt: 2, userMessage: user2, raw: null, model: null, finish_reason: null, usage: null,
                httpError: e instanceof GenError ? e.detail : String(e), failures: [],
              });
            }
          }

          // Keep the attempt with fewer failures; tie → attempt 2. Unparseable attempts lose.
          let kept = 0;
          if (outcomes.length === 2) {
            const [o1, o2] = outcomes;
            if (o1 && o2) kept = o2.failures.length <= o1.failures.length ? 1 : 0;
            else if (o2) kept = 1;
          }
          const chosen = outcomes[kept];
          if (!chosen) throw new GenError("other", attempts.map((a) => a.parseError ?? a.httpError).filter(Boolean).join(" | ") || "No valid output.");

          if (latest.current.datasetId !== startDataset) return; // dataset replaced — discard silently

          const stored: StoredResult = {
            cacheKey: key, datasetId: startDataset, sku_id: sku.sku_id, promptVersion: TOP3_EDITS_PROMPT_VERSION,
            generatedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
            model: attempts[kept]?.model ?? null, system, userPayload: user, attempts, keptAttempt: kept + 1,
            result: chosen.result, failures: chosen.failures,
          };
          setResults((prev) => {
            const next = { ...prev, [key]: stored };
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
              /* storage full — keep in memory */
            }
            return next;
          });
          setJob(key, null);

          const path = router.state.location.pathname;
          if (path !== `/skus/${encodeURIComponent(sku.sku_id)}` && path !== `/skus/${sku.sku_id}`) {
            toast(`Recommendations ready for ${sku.brand}`, {
              action: { label: "View", onClick: () => router.navigate({ to: "/skus/$skuId", params: { skuId: sku.sku_id } }) },
            });
          }
        } catch (e) {
          if (ctrl.signal.aborted && !timedOut) {
            setJob(key, null); // cancelled — cache nothing
            return;
          }
          if (latest.current.datasetId !== startDataset) {
            setJob(key, null);
            return;
          }
          const code: ErrorCode = timedOut ? "timeout" : e instanceof GenError ? e.code : "other";
          const detail = timedOut ? "Aborted after 90 seconds." : e instanceof Error ? e.message : String(e);
          setJob(key, {
            status: "error", code, detail,
            log: { system, userPayload: user, attempts, promptVersion: TOP3_EDITS_PROMPT_VERSION, durationMs: Date.now() - startedAt },
          });
        } finally {
          clearTimeout(timer);
          delete controllers.current[key];
        }
      })();
    },
    [router],
  );

  const cancel = useCallback(
    (skuId: string) => controllers.current[cacheKeyFor(skuId)]?.abort(),
    [cacheKeyFor],
  );

  const value = useMemo(() => ({ cacheKeyFor, results, jobs, generate, cancel }), [cacheKeyFor, results, jobs, generate, cancel]);
  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}

export function useGeneration() {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration must be used inside GenerationProvider");
  return ctx;
}
