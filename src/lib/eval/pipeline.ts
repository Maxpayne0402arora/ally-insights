import { callOnce, GenError } from "@/context/GenerationContext";
import {
  buildPayload, extractJson, formatFailuresForRetry, INVALID_JSON_MSG, normalize, rankEdits, runGuardrail,
  type AiResult, type GuardFailure,
} from "@/lib/top3";
import type { Sku } from "@/types/sku";
import type { AttemptRecord, SkuRecord } from "./types";

const TIMEOUT_MS = 90_000;

/** Same pipeline as the review flow: payload → call → parse → guardrail → one retry → ranking in code. */
export async function runSkuPipeline(
  sku: Sku, allSkus: Sku[], system: string, outer: AbortSignal,
): Promise<Omit<SkuRecord, "key" | "scenario" | "assertions" | "consistencyOf">> {
  const started = Date.now();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  outer.addEventListener("abort", onAbort);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
  const built = buildPayload(sku, allSkus, () => false);
  const user = JSON.stringify(built.payload);
  const attempts: AttemptRecord[] = [];
  const outcomes: ({ result: AiResult; failures: GuardFailure[] } | null)[] = [];

  const attempt = async (n: number, msg: string) => {
    const call = await callOnce(system, msg, ctrl.signal);
    const rec: AttemptRecord = { attempt: n, raw: call.text, parsed: null, failures: [], finish_reason: call.finish_reason, usage: call.usage, model: call.model };
    let outcome: { result: AiResult; failures: GuardFailure[] } | null = null;
    if (call.finish_reason !== "stop") rec.error = `Output was cut off (finish_reason: ${call.finish_reason}).`;
    else {
      try {
        const norm = normalize(extractJson(call.text));
        outcome = runGuardrail(norm.result, norm.failures, { sku, allSkus, built });
      } catch (e) {
        rec.error = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    rec.parsed = outcome?.result ?? null;
    rec.failures = outcome ? outcome.failures : [{ edit_rank: null, check: "parse", detail: rec.error ?? "Invalid output" }];
    attempts.push(rec);
    outcomes.push(outcome);
    return { rec, outcome };
  };

  try {
    const a1 = await attempt(1, user);
    if (a1.rec.failures.length) {
      const msg = `${user}\n\n${a1.outcome ? formatFailuresForRetry(a1.outcome.failures) : INVALID_JSON_MSG}`;
      try {
        await attempt(2, msg);
      } catch (e) {
        if (ctrl.signal.aborted || !a1.outcome) throw e;
        attempts.push({ attempt: 2, raw: null, parsed: null, failures: [], finish_reason: null, usage: null, model: null, error: e instanceof GenError ? e.detail : String(e) });
      }
    }
    let kept = 0;
    if (outcomes.length === 2) {
      const [o1, o2] = outcomes;
      if (o1 && o2) kept = o2.failures.length <= o1.failures.length ? 1 : 0;
      else if (o2) kept = 1;
    }
    const chosen = outcomes[kept];
    if (!chosen) throw new Error(attempts.map((a) => a.error).filter(Boolean).join(" | ") || "No valid output.");
    const ranked = rankEdits(chosen.result, chosen.failures, built.findings);
    return {
      sku_id: sku.sku_id, status: "ok", attempts, kept: kept + 1, result: ranked.result, failures: ranked.failures,
      findings: built.findings, durationMs: Date.now() - started,
    };
  } catch (e) {
    if (outer.aborted) throw e;
    const error = timedOut ? "Timed out after 90 seconds." : e instanceof GenError ? `${e.code}: ${e.detail}` : e instanceof Error ? e.message : String(e);
    return { sku_id: sku.sku_id, status: "failed", error, attempts, kept: null, result: null, failures: [], findings: built.findings, durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
    outer.removeEventListener("abort", onAbort);
  }
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const r = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
