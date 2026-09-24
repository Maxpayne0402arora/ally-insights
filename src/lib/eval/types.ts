import type { Sku } from "@/types/sku";
import type { AiResult, GuardFailure, PayloadFinding } from "@/lib/top3";

export type EvalField = "title" | "bullets" | "description" | "any";

export type Assertion =
  | { type: "finding_flagged"; rule_id?: string; text?: string }
  | { type: "finding_not_flagged"; rule_id?: string; text?: string }
  | { type: "not_contains"; field: EvalField; value: string }
  | { type: "contains_placeholder"; field: EvalField }
  | { type: "edit_field_present"; field: EvalField }
  | { type: "max_edits"; value: number }
  | { type: "min_edits"; value: number }
  | { type: "max_length"; field: EvalField; value: number }
  | { type: "no_competitive_changes" }
  | { type: "no_new_claims" }
  | { type: "suspected_fp"; text: string }
  | { type: "guardrail_pass" }
  | { type: "brand_preserved" };

export const RULE_ASSERTIONS = ["finding_flagged", "finding_not_flagged"] as const;
export const AI_ASSERTIONS = [
  "not_contains", "contains_placeholder", "edit_field_present", "max_edits", "min_edits", "max_length",
  "no_competitive_changes", "no_new_claims", "suspected_fp", "guardrail_pass", "brand_preserved",
] as const;
export const isRuleAssertion = (a: Assertion) => (RULE_ASSERTIONS as readonly string[]).includes(a.type);

export type EvalRow = {
  sku: Sku;
  scenario: string;
  assertions: Assertion[];
  /** Row-level error from the expectations column; its own assertions were skipped. */
  assertionError?: string;
  rowNo: number;
};

export type EvalSet = { fileName: string; skus: Sku[]; rows: EvalRow[]; warnings: string[]; skipped: string[] };

export type AssertionResult = { label: string; type: string; kind: "rules" | "ai"; pass: boolean; reason: string };

export type AttemptRecord = {
  attempt: number;
  raw: string | null;
  parsed: AiResult | null;
  failures: GuardFailure[];
  finish_reason: string | null;
  usage: unknown;
  model: string | null;
  error?: string;
};

export type SkuRecord = {
  key: string; // sku_id, or sku_id#c<n> for consistency repeats
  sku_id: string;
  scenario: string;
  consistencyOf?: string | undefined;
  status: "ok" | "failed" | "skipped";
  error?: string;
  attempts: AttemptRecord[];
  kept: number | null; // 1-based attempt number
  result: AiResult | null;
  failures: GuardFailure[];
  findings: PayloadFinding[];
  durationMs: number;
  assertions: AssertionResult[];
};

export type HumanScore = {
  compliant?: number; faithful?: number; better?: number; usable?: number;
  hallucination?: boolean; hallucinationNote?: string; note?: string;
};

export type RunMode = "all" | "scenarios" | "firstN";

export type EvalRun = {
  id: string;
  name: string;
  promptVersion: string;
  model: string | null;
  createdAt: string;
  status: "running" | "paused" | "done" | "cancelled";
  mode: RunMode;
  firstN?: number;
  consistency: boolean;
  set: EvalSet;
  /** SKU keys queued for AI (in order). */
  queue: string[];
  sampleSeed: number;
  scores: Record<string, HumanScore>; // key `${sku_id}:${rank}`
};
