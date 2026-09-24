import { validateText } from "@/lib/rules";
import { inventedClaims, type Edit, type EditField, type EditScore, type FieldText, type GuardFailure } from "@/lib/top3";
import type { StoredResult } from "@/context/GenerationContext";
import type { Finding, Sku } from "@/types/sku";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DecisionState = "pending" | "accepted" | "edited" | "override" | "rejected";
export type Version = "full" | "compliance";
export type Fact = { placeholder: string; label: string; value: string; removed?: boolean | undefined };

export type Decision = {
  state: DecisionState;
  version: Version;
  /** generatedAt of the result this decision was made against. */
  resultAt: string;
  finalText?: FieldText | undefined;
  edited?: boolean | undefined;
  facts: Fact[];
  overrideReason?: string | undefined;
  overrideIssues?: string[] | undefined;
  rejectReason?: string | undefined;
  decidedAt?: string | undefined;
  /** Snapshot so decisions survive regeneration. */
  edit: Edit;
  score?: EditScore | undefined;
  failures: GuardFailure[];
};

export type SkuReview = { decisions: Partial<Record<EditField, Decision>>; finishedAt?: string | undefined };

export type Item = {
  edit: Edit;
  decision: Decision | undefined;
  score: EditScore | undefined;
  failures: GuardFailure[];
  /** True when the edit is carried over from a previous generation. */
  previous: boolean;
  resultAt: string;
};

export const STATE_LABEL: Record<DecisionState, string> = {
  pending: "Pending",
  accepted: "Accepted",
  edited: "Edited & accepted",
  override: "Accepted with override",
  rejected: "Rejected",
};
export const FIELD_LABEL: Record<EditField, string> = { title: "Title", bullets: "Bullets", description: "Description" };
export const LIMITS = { title: 200, bullet: 255, description: 2000 };

export const isDecided = (s: DecisionState | undefined) => !!s && s !== "pending";
export const isAccepted = (s: DecisionState | undefined) => s === "accepted" || s === "edited" || s === "override";

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

export const asList = (t: FieldText) => (Array.isArray(t) ? t : [t]);
export const joinText = (t: FieldText) => asList(t).join("\n");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function textFor(edit: Edit, version: Version): FieldText {
  return version === "compliance" ? edit.proposed_compliance_only : edit.proposed_full;
}

export function sameText(a: FieldText, b: FieldText) {
  const norm = (t: FieldText) => asList(t).map((s) => s.trim()).filter(Boolean);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

export function placeholdersIn(t: FieldText): string[] {
  const out: string[] = [];
  for (const s of asList(t)) {
    for (const m of s.matchAll(/\[\s*confirm\s*:\s*([^\]]*?)\s*\]/gi)) {
      const inner = m[1] ?? "";
      if (!out.includes(inner)) out.push(inner);
    }
  }
  return out;
}

export const placeholderLabel = (inner: string) => (inner ? inner[0]!.toUpperCase() + inner.slice(1) : "Detail");

const cleanup = (s: string) =>
  s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/([,;])(\s*[,;.])+/g, "$1")
    .replace(/,\s*\./g, ".")
    .replace(/^[\s,;\-–]+/, "")
    .replace(/[\s,;\-–]+$/, "")
    .trim();

/** Replace a [confirm: …] placeholder with a value, or remove it (value null) and tidy spacing/punctuation. */
export function replacePlaceholder(t: FieldText, inner: string, value: string | null): FieldText {
  const src = `\\[\\s*confirm\\s*:\\s*${escapeRe(inner)}\\s*\\]`;
  const f = (s: string) => {
    if (!new RegExp(src, "i").test(s)) return s;
    const r = s.replace(new RegExp(src, "gi"), value ?? "");
    return value == null ? cleanup(r) : r;
  };
  return Array.isArray(t) ? t.map(f) : f(t);
}

const wordsOf = (t: FieldText) =>
  joinText(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** True when every word of `proposed` appears in `current` in the same order (and something was removed). */
export function isRemovalOnly(current: FieldText, proposed: FieldText) {
  const c = wordsOf(current);
  const p = wordsOf(proposed);
  if (p.length >= c.length) return false;
  let i = 0;
  for (const w of c) if (w === p[i]) i++;
  return i === p.length;
}

/* ------------------------------------------------------------------ */
/* Live checks + risk tier                                             */
/* ------------------------------------------------------------------ */

export type LiveCheck = { findings: Finding[]; claims: string[]; brandMissing: boolean; count: number };

export function liveCheck(field: EditField, text: FieldText, sku: Sku, allSkus: Sku[], facts: Fact[]): LiveCheck {
  const input = field === "bullets" ? asList(text).map((s) => s.trim()).filter(Boolean) : joinText(text);
  const findings = validateText(field, input, sku, allSkus).filter(
    (f) => (f.severity === "high" || f.severity === "medium") && !f.rule_id.startsWith("AMZ-IMG"),
  );
  const source = [sku.title, ...sku.bullets, sku.description, ...facts.filter((f) => !f.removed).map((f) => f.value)].join("\n");
  const claims = inventedClaims(joinText(text), source);
  const brandMissing = field === "title" && !!sku.brand && !joinText(text).includes(sku.brand);
  return { findings, claims, brandMissing, count: findings.length + claims.length + (brandMissing ? 1 : 0) };
}

export type Tier = "blocked" | "safe" | "review";
export const TIER_LABEL: Record<Tier, string> = {
  blocked: "Blocked: confirm facts",
  safe: "Safe to bulk-approve",
  review: "Review",
};

export function riskTier(opts: {
  current: FieldText;
  text: FieldText;
  live: LiveCheck;
  guardFailures: GuardFailure[];
  edited: boolean;
}): { tier: Tier; reasons: string[] } {
  const { current, text, live, guardFailures, edited } = opts;
  const reasons: string[] = [];
  const ph = placeholdersIn(text);
  if (ph.length) reasons.push(`Contains ${ph.length} [confirm: …] placeholder${ph.length === 1 ? "" : "s"} to fill or remove.`);
  if (live.findings.length)
    reasons.push(`Guideline issues: ${Array.from(new Set(live.findings.map((f) => f.rule_id))).join(", ")}.`);
  if (live.claims.length) reasons.push(`Unsupported claims: ${live.claims.map((c) => `'${c}'`).join(", ")}.`);
  if (live.brandMissing) reasons.push("The title must include the brand name exactly as written.");
  if (!edited && guardFailures.length) reasons.push("The AI draft failed guardrail checks. Fix it in the editor or reject it.");
  if (reasons.length) return { tier: "blocked", reasons };
  if (isRemovalOnly(current, text)) return { tier: "safe", reasons: ["Only removes text, has no placeholders and passed all checks."] };
  return { tier: "review", reasons: ["Rewrites or adds text. It passed all checks, but read it before approving."] };
}

/** Evaluate an item as currently displayed (not in the editor). */
export function evaluateItem(item: Item, sku: Sku, allSkus: Sku[]) {
  const d = item.decision;
  const version: Version = d?.version ?? "full";
  const text = d?.finalText ?? textFor(item.edit, version);
  const edited = !!d?.edited;
  const live = liveCheck(item.edit.field, text, sku, allSkus, d?.facts ?? []);
  const { tier, reasons } = riskTier({ current: item.edit.current, text, live, guardFailures: item.failures, edited });
  return { version, text, edited, live, tier, reasons };
}

/* ------------------------------------------------------------------ */
/* Items: current result + decisions carried over                      */
/* ------------------------------------------------------------------ */

export function buildItems(stored: StoredResult | undefined, review: SkuReview | undefined): Item[] {
  if (!stored) return [];
  const decisions = review?.decisions ?? {};
  const valid = (d: Decision | undefined) => (d && (d.resultAt === stored.generatedAt || isDecided(d.state)) ? d : undefined);
  const items: Item[] = [];
  const used = new Set<EditField>();
  stored.result.top_edits.forEach((e, i) => {
    const d = valid(decisions[e.field]);
    used.add(e.field);
    if (d && d.resultAt !== stored.generatedAt) {
      items.push({ edit: d.edit, decision: d, score: d.score, failures: d.failures, previous: true, resultAt: d.resultAt });
    } else {
      items.push({
        edit: e,
        decision: d,
        score: stored.scores?.[i],
        failures: stored.failures.filter((f) => f.edit_rank === e.rank),
        previous: false,
        resultAt: stored.generatedAt,
      });
    }
  });
  (Object.values(decisions) as Decision[]).forEach((d) => {
    if (!used.has(d.edit.field) && isDecided(d.state))
      items.push({ edit: d.edit, decision: d, score: d.score, failures: d.failures, previous: true, resultAt: d.resultAt });
  });
  return items.map((it, i) => ({ ...it, edit: { ...it.edit, rank: i + 1 } }));
}

export type ReviewStatus = "Not reviewed" | "Recommendations ready" | `In review (${number}/${number})` | "Reviewed";

export function reviewStatus(stored: StoredResult | undefined, review: SkuReview | undefined): ReviewStatus {
  if (!stored) return "Not reviewed";
  const items = buildItems(stored, review);
  const decided = items.filter((i) => isDecided(i.decision?.state)).length;
  if (review?.finishedAt || (items.length > 0 && decided === items.length)) return "Reviewed";
  if (decided > 0) return `In review (${decided}/${items.length})`;
  return "Recommendations ready";
}
