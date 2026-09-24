import { auditSku, complianceScore } from "@/lib/rules";
import { asList, FIELD_LABEL, isAccepted, STATE_LABEL, type Item } from "@/lib/review";
import type { AiResult, FieldText } from "@/lib/top3";
import type { Finding, Sku } from "@/types/sku";

export const today = () => new Date().toISOString().slice(0, 10);

export function applyAccepted(sku: Sku, items: Item[]): Sku {
  const next: Sku = { ...sku, bullets: [...sku.bullets] };
  items.forEach((it) => {
    const d = it.decision;
    if (!d || !isAccepted(d.state) || d.finalText == null) return;
    const t: FieldText = d.finalText;
    if (it.edit.field === "title") next.title = asList(t).join(" ");
    else if (it.edit.field === "description") next.description = asList(t).join("\n");
    else next.bullets = asList(t).map((b) => b.trim()).filter(Boolean);
  });
  return next;
}

export type SummaryInput = {
  sku: Sku;
  allSkus: Sku[];
  fileName: string | null;
  model: string | null;
  promptVersion: string;
  result: AiResult | undefined;
  items: Item[];
  findings: Finding[];
  dismissed: Finding[];
  date: string;
};

const quote = (t: FieldText, bullets: boolean) =>
  bullets
    ? asList(t).filter((b) => b.trim()).map((b) => `> - ${b}`).join("\n") || "> (none)"
    : asList(t).join("\n").split("\n").map((l) => `> ${l}`).join("\n");

export function buildSummary(input: SummaryInput) {
  const { sku, allSkus, fileName, model, promptVersion, result, items, findings, dismissed, date } = input;
  const finalSku = applyAccepted(sku, items);
  const before = complianceScore(auditSku(sku, allSkus));
  const afterFindings = auditSku(finalSku, allSkus);
  const after = complianceScore(afterFindings);
  const accepted = items.filter((i) => isAccepted(i.decision?.state));
  const rejected = items.filter((i) => i.decision?.state === "rejected");
  const pending = items.filter((i) => !i.decision || i.decision.state === "pending");
  const byId = new Map(findings.map((f) => [f.id, f]));
  const L: string[] = [];

  L.push(`# Listing update summary: ${sku.brand} (${sku.sku_id})`, "");
  L.push(`**Date:** ${date} · **Data:** ${fileName ?? "—"} · **Prompt:** ${promptVersion} · **Model:** ${model ?? "—"}`);
  L.push(
    `**Compliance score:** ${before} → ${after} · **Edits:** ${accepted.length} accepted, ${rejected.length} rejected, ${pending.length} not reviewed`,
    "",
  );

  L.push("## Approved changes", "");
  if (!items.length) L.push("No changes recommended", "");
  else if (!accepted.length) L.push("No changes approved", "");
  accepted.forEach((it, idx) => {
    const d = it.decision!;
    const bullets = it.edit.field === "bullets";
    L.push(`### ${idx + 1}. ${FIELD_LABEL[it.edit.field]} — ${STATE_LABEL[d.state]}`);
    L.push(`**Version:** ${d.version === "compliance" ? "Compliance-only" : "Full recommendation"}`, "");
    L.push("**Before**", quote(it.edit.current, bullets), "");
    L.push("**After**", quote(d.finalText ?? it.edit.proposed_full, bullets), "");
    L.push("**Why**");
    it.edit.changes.forEach((c) => {
      if (c.type === "compliance") L.push(`- Compliance: ${c.what}${c.rule_ids.length ? ` (${c.rule_ids.join(", ")})` : ""}`);
      else {
        const ev = c.competitor_refs.map((r) => `${r.brand} (${r.sku_id}): "${r.evidence}"`).join("; ");
        L.push(`- Competitive: ${c.what}${ev ? ` — evidence: ${ev}` : ""}`);
      }
    });
    if (!it.edit.changes.length) L.push("- (no reasons given)");
    L.push("");
    const facts = d.facts.filter((f) => !f.removed);
    if (facts.length) L.push(`**User-confirmed facts:** ${facts.map((f) => `${f.label}: ${f.value}`).join("; ")}`, "");
    if (d.state === "override")
      L.push(`**Override:** ${d.overrideReason ?? ""} — remaining issues: ${(d.overrideIssues ?? []).join("; ") || "none"}`, "");
  });

  if (rejected.length) {
    L.push("## Rejected changes", "");
    rejected.forEach((it) => L.push(`- ${FIELD_LABEL[it.edit.field]}: ${it.decision?.rejectReason || "No reason given"}`));
    L.push("");
  }
  if (pending.length) {
    L.push("## Not reviewed", "");
    pending.forEach((it) => L.push(`- ${FIELD_LABEL[it.edit.field]}`));
    L.push("");
  }

  L.push("## Still open", "");
  const open = result?.open_issues ?? [];
  if (!open.length) L.push("- None");
  open.forEach((o) => {
    const f = byId.get(o.finding_id);
    L.push(f ? `- ${f.severity} · ${f.message} (${f.rule_id}) — ${o.reason}` : `- ${o.finding_id} — ${o.reason}`);
  });
  L.push("");

  L.push("## Action items", "");
  const actions = result?.action_items ?? [];
  if (!actions.length) L.push("- None");
  actions.forEach((a) => L.push(`- ${a.what}${a.rule_ids.length ? ` (${a.rule_ids.join(", ")})` : ""}`));
  L.push("");

  if (dismissed.length) {
    L.push("## Findings dismissed as not an issue", "");
    dismissed.forEach((f) => L.push(`- ${f.message} (${f.rule_id}) — "${f.evidence}"`));
    L.push("");
  }

  L.push("## Final listing", "");
  L.push(`**Title:** ${finalSku.title}`, "");
  L.push("**Bullets**");
  if (!finalSku.bullets.length) L.push("- (none)");
  finalSku.bullets.forEach((b) => L.push(`- ${b}`));
  L.push("", "**Description**", finalSku.description || "(none)", "");
  L.push("---");
  L.push(
    "*Generated by Ally · Competitor Content Intelligence (prototype). Review before publishing. Recommendations follow the provided Amazon content guidelines; approved overrides are listed above.*",
  );

  const remaining = afterFindings.filter((f) => f.severity === "high" || f.severity === "medium");
  return { markdown: L.join("\n"), before, after, remaining };
}
