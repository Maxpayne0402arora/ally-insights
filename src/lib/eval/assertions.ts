import { auditSku, maskPlaceholders } from "@/lib/rules";
import { joined, type AiResult, type Edit } from "@/lib/top3";
import type { Sku } from "@/types/sku";
import { isRuleAssertion, type Assertion, type AssertionResult, type EvalField, type EvalRow, type SkuRecord } from "./types";

export function assertionLabel(a: Assertion): string {
  const { type, ...rest } = a as Assertion & Record<string, unknown>;
  const args = Object.entries(rest).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return args.length ? `${type}(${args.join(", ")})` : type;
}

const lc = (s: string) => s.toLowerCase();
const editsFor = (r: AiResult, f: EvalField) => r.top_edits.filter((e) => f === "any" || e.field === f);
const proposed = (e: Edit) => joined(e.proposed_full);

export function assertionsFor(row: EvalRow): Assertion[] {
  const out = [...row.assertions];
  if (row.sku.is_client) out.push({ type: "guardrail_pass" }, { type: "brand_preserved" });
  return out;
}

export function evalRuleAssertion(a: Assertion, sku: Sku, allSkus: Sku[]): AssertionResult {
  const findings = auditSku(sku, allSkus);
  const label = assertionLabel(a);
  if (a.type !== "finding_flagged" && a.type !== "finding_not_flagged") throw new Error("not a rule assertion");
  const matches = findings.filter((f) => f.rule_id === a.rule_id && (!a.text || lc(f.evidence).includes(lc(a.text))));
  if (a.type === "finding_flagged") {
    return matches.length
      ? { label, type: a.type, kind: "rules", pass: true, reason: `Flagged: "${matches[0]!.evidence}"` }
      : { label, type: a.type, kind: "rules", pass: false, reason: `No ${a.rule_id} finding${a.text ? ` with evidence containing "${a.text}"` : ""}.` };
  }
  return matches.length
    ? { label, type: a.type, kind: "rules", pass: false, reason: `Wrongly flagged: "${matches[0]!.evidence}"` }
    : { label, type: a.type, kind: "rules", pass: true, reason: "Not flagged." };
}

export function evalAiAssertion(a: Assertion, rec: SkuRecord, sku: Sku): AssertionResult {
  const label = assertionLabel(a);
  const base = { label, type: a.type, kind: "ai" as const };
  const r = rec.result;
  if (rec.status !== "ok" || !r) return { ...base, pass: false, reason: "Generation failed" };
  const ok = (pass: boolean, reason: string) => ({ ...base, pass, reason });
  switch (a.type) {
    case "not_contains": {
      const hit = editsFor(r, a.field).find((e) => lc(maskPlaceholders(proposed(e))).includes(lc(a.value)));
      return hit ? ok(false, `The ${hit.field} edit contains "${a.value}".`) : ok(true, `"${a.value}" not found.`);
    }
    case "contains_placeholder": {
      const hit = editsFor(r, a.field).find((e) => /\[confirm:[^\]]*\]/i.test(proposed(e)));
      return hit ? ok(true, `Placeholder in ${hit.field}.`) : ok(false, `No [confirm: …] placeholder in ${a.field}.`);
    }
    case "edit_field_present":
      return editsFor(r, a.field).length ? ok(true, `Edit for ${a.field} present.`) : ok(false, `No edit for ${a.field}.`);
    case "max_edits":
      return ok(r.top_edits.length <= a.value, `${r.top_edits.length} edit(s); max ${a.value}.`);
    case "min_edits":
      return ok(r.top_edits.length >= a.value, `${r.top_edits.length} edit(s); min ${a.value}.`);
    case "max_length": {
      const over = editsFor(r, a.field).find((e) => proposed(e).length > a.value);
      return over ? ok(false, `${over.field} is ${proposed(over).length} characters (max ${a.value}).`) : ok(true, `Within ${a.value} characters.`);
    }
    case "no_competitive_changes": {
      const hit = r.top_edits.find((e) => e.changes.some((c) => c.type === "competitive" || c.competitor_refs.length));
      return hit ? ok(false, `The ${hit.field} edit has a competitive change.`) : ok(true, "No competitive changes.");
    }
    case "no_new_claims": {
      const f = rec.failures.filter((x) => x.check === "unsupported_claim");
      return f.length ? ok(false, f.map((x) => x.detail).join(" ")) : ok(true, "No unsupported claims.");
    }
    case "suspected_fp": {
      const byId = new Map(rec.findings.map((f) => [f.id, f]));
      const hit = r.suspected_false_positives.find((s) => lc(byId.get(s.finding_id)?.evidence ?? "").includes(lc(a.text)));
      return hit ? ok(true, `Suspected: ${hit.finding_id}.`) : ok(false, `No suspected false positive with evidence containing "${a.text}".`);
    }
    case "guardrail_pass":
      return rec.failures.length ? ok(false, `${rec.failures.length} guardrail failure(s): ${rec.failures[0]!.detail}`) : ok(true, "Passed.");
    case "brand_preserved": {
      const t = r.top_edits.find((e) => e.field === "title");
      if (!t) return ok(true, "No title edit.");
      return proposed(t).includes(sku.brand) ? ok(true, `"${sku.brand}" kept.`) : ok(false, `Title doesn't contain "${sku.brand}" exactly.`);
    }
    default:
      return ok(false, "Unsupported assertion.");
  }
}

/** Evaluate every assertion for a row; AI assertions are included only if the row was run with AI. */
export function evaluateRow(row: EvalRow, allSkus: Sku[], rec: SkuRecord | null): AssertionResult[] {
  return assertionsFor(row).flatMap((a) => {
    if (isRuleAssertion(a)) return [evalRuleAssertion(a, row.sku, allSkus)];
    return rec ? [evalAiAssertion(a, rec, row.sku)] : [];
  });
}
