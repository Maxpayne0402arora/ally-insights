import { validateText } from "@/lib/rules";
import type { Sku } from "@/types/sku";
import { evaluateRow } from "./assertions";
import { seededShuffle } from "./pipeline";
import type { AssertionResult, EvalRun, HumanScore, SkuRecord } from "./types";

export type Ratio = { x: number; y: number };
export type Metric = {
  key: string;
  label: string;
  group: "Rules engine" | "AI output quality" | "Performance";
  tip: string;
  value: number | null; // numeric for comparison
  display: string;
  better: "higher" | "lower";
};

const pct = (r: Ratio) => (r.y ? Math.round((r.x / r.y) * 1000) / 10 : null);
const fmtPct = (r: Ratio) => (r.y ? `${pct(r)}%` : "—");
const usageNum = (u: unknown, ...ks: string[]) => {
  if (!u || typeof u !== "object") return null;
  for (const k of ks) {
    const v = (u as Record<string, unknown>)[k];
    if (typeof v === "number") return v;
  }
  return null;
};

export type RowOutcome = { key: string; sku: Sku; scenario: string; record: SkuRecord | null; results: AssertionResult[] };

export function rowOutcomes(run: EvalRun, records: Record<string, SkuRecord>): RowOutcome[] {
  const all = run.set.skus;
  return run.set.rows.map((row) => {
    const rec = records[row.sku.sku_id] ?? null;
    const ran = run.queue.includes(row.sku.sku_id);
    return { key: row.sku.sku_id, sku: row.sku, scenario: row.scenario, record: rec, results: evaluateRow(row, all, ran ? (rec ?? { status: "failed" } as SkuRecord) : null) };
  });
}

export function computeMetrics(run: EvalRun, records: Record<string, SkuRecord>) {
  const outcomes = rowOutcomes(run, records);
  const res = outcomes.flatMap((o) => o.results);
  const count = (f: (r: AssertionResult) => boolean) => ({ x: res.filter((r) => f(r) && r.pass).length, y: res.filter(f).length });
  const recall = count((r) => r.type === "finding_flagged");
  const precision = count((r) => r.type === "finding_not_flagged");
  const scenario = count((r) => r.kind === "ai");

  const main = run.queue.map((k) => records[k]).filter((r): r is SkuRecord => !!r);
  const ok = main.filter((r) => r.status === "ok" && r.result);
  const skuById = new Map(run.set.skus.map((s) => [s.sku_id, s]));

  let edits = 0, compliant = 0, leaks = 0;
  let a1Edits = 0, a1Claims = 0, claimFixed = 0, refs = 0, badRefs = 0;
  let findingsTotal = 0, accounted = 0;
  let autoAdded = 0;
  ok.forEach((r) => {
    const sku = skuById.get(r.sku_id)!;
    r.result!.top_edits.forEach((e) => {
      edits++;
      const bad = validateText(e.field, e.proposed_full, sku, run.set.skus).filter((f) => (f.severity === "high" || f.severity === "medium") && !f.rule_id.startsWith("AMZ-IMG"));
      if (!bad.length) compliant++;
    });
    leaks += r.failures.filter((f) => f.check === "other_brand").length;
    const a1 = r.attempts[0];
    if (a1?.parsed) {
      a1.parsed.top_edits.forEach((e) => {
        a1Edits++;
        const claimed = a1.failures.some((f) => f.check === "unsupported_claim" && f.edit_rank === e.rank);
        if (claimed) {
          a1Claims++;
          if (r.kept === 2) {
            const k = r.result!.top_edits.find((x) => x.field === e.field);
            const rank = k?.rank;
            if (!k || !r.failures.some((f) => f.check === "unsupported_claim" && f.edit_rank === rank)) claimFixed++;
          }
        }
        e.changes.forEach((c) => (refs += c.competitor_refs.length));
      });
      badRefs += a1.failures.filter((f) => f.check === "competitor_ref" || f.check === "competitor_evidence").length;
    }
    findingsTotal += r.findings.length;
    const ids = new Set(r.findings.map((f) => f.id));
    const covered = new Set<string>([
      ...r.result!.top_edits.flatMap((e) => e.resolves_finding_ids),
      ...r.result!.open_issues.filter((o) => !o.auto).map((o) => o.finding_id),
      ...r.result!.suspected_false_positives.map((s) => s.finding_id),
    ]);
    accounted += Array.from(covered).filter((id) => ids.has(id)).length;
    autoAdded += r.result!.open_issues.filter((o) => o.auto).length;
  });
  // Findings of failed rows count as unaccounted.
  main.filter((r) => r.status !== "ok").forEach((r) => (findingsTotal += r.findings.length));

  const firstPass = { x: main.filter((r) => r.attempts[0] && r.attempts[0].failures.length === 0).length, y: main.length };
  const finalPass = { x: ok.filter((r) => r.failures.length === 0).length, y: main.length };
  const retried = { x: main.filter((r) => r.attempts.length > 1).length, y: main.length };
  const failed = { x: main.filter((r) => r.status === "failed").length, y: main.length };
  const durs = main.map((r) => r.durationMs / 1000).sort((a, b) => a - b);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const p95 = durs.length ? durs[Math.min(durs.length - 1, Math.ceil(durs.length * 0.95) - 1)]! : null;
  const tokIn: number[] = [], tokOut: number[] = [];
  main.forEach((r) => {
    let i = 0, o = 0, has = false;
    r.attempts.forEach((a) => {
      const ii = usageNum(a.usage, "input_tokens", "prompt_tokens");
      const oo = usageNum(a.usage, "output_tokens", "completion_tokens");
      if (ii != null) { i += ii; has = true; }
      if (oo != null) o += oo;
    });
    if (has) { tokIn.push(i); tokOut.push(o); }
  });

  const r = (x: number, y: number): Ratio => ({ x, y });
  const m: Metric[] = [
    { key: "recall", group: "Rules engine", label: "Expected flags found", tip: "finding_flagged assertions passed / total — rules-engine recall on test cases.", value: pct(recall), display: `${recall.x}/${recall.y}`, better: "higher" },
    { key: "precision", group: "Rules engine", label: "False-positive traps avoided", tip: "finding_not_flagged assertions passed / total — rules-engine precision on test cases.", value: pct(precision), display: `${precision.x}/${precision.y}`, better: "higher" },
    { key: "scenario", group: "AI output quality", label: "Scenario pass rate", tip: "AI output assertions passed / total.", value: pct(scenario), display: fmtPct(scenario), better: "higher" },
    { key: "compliance", group: "AI output quality", label: "Compliance rate", tip: "Edits whose kept proposed text has no high/medium validateText findings / total edits.", value: pct(r(compliant, edits)), display: fmtPct(r(compliant, edits)), better: "higher" },
    { key: "claims", group: "AI output quality", label: "Unsupported-claim rate", tip: "First-attempt edits flagged by the unsupported-claims check / first-attempt edits.", value: pct(r(a1Claims, a1Edits)), display: `${fmtPct(r(a1Claims, a1Edits))} (${claimFixed} fixed by retry)`, better: "lower" },
    { key: "fabrication", group: "AI output quality", label: "Evidence fabrication rate", tip: "Invalid competitor_refs in the first attempt / total refs.", value: pct(r(badRefs, refs)), display: fmtPct(r(badRefs, refs)), better: "lower" },
    { key: "leaks", group: "AI output quality", label: "Competitor-name leaks", tip: "Competitor brand mentions in final proposed text (should be 0).", value: leaks, display: String(leaks), better: "lower" },
    { key: "coverage", group: "AI output quality", label: "Coverage", tip: "Unique findings the AI itself placed in resolves_finding_ids, open_issues or suspected_false_positives / total findings. Auto-added open issues are excluded.", value: pct(r(accounted, findingsTotal)), display: fmtPct(r(accounted, findingsTotal)), better: "higher" },
    { key: "autoAdded", group: "AI output quality", label: "Auto-added to open issues", tip: "Findings the AI ignored, which the app added to open issues automatically (not counted as covered).", value: autoAdded, display: String(autoAdded), better: "lower" },
    { key: "pass1", group: "AI output quality", label: "Guardrail pass (first attempt)", tip: "SKUs whose first attempt had no guardrail failures.", value: pct(firstPass), display: fmtPct(firstPass), better: "higher" },
    { key: "pass2", group: "AI output quality", label: "Guardrail pass (after retry)", tip: "SKUs whose kept attempt had no guardrail failures.", value: pct(finalPass), display: fmtPct(finalPass), better: "higher" },
    { key: "retry", group: "Performance", label: "Retry rate", tip: "SKUs that needed the one retry.", value: pct(retried), display: fmtPct(retried), better: "lower" },
    { key: "failure", group: "Performance", label: "Failure rate", tip: "SKUs whose generation failed entirely.", value: pct(failed), display: fmtPct(failed), better: "lower" },
    { key: "dur", group: "Performance", label: "Duration avg / p95", tip: "Seconds per SKU, including retries.", value: avg(durs), display: durs.length ? `${avg(durs)!.toFixed(1)}s / ${p95!.toFixed(1)}s` : "—", better: "lower" },
    { key: "tokens", group: "Performance", label: "Tokens avg in / out", tip: "Average input and output tokens per SKU, when returned.", value: avg(tokOut), display: tokIn.length ? `${Math.round(avg(tokIn)!)} / ${Math.round(avg(tokOut)!)}` : "—", better: "lower" },
  ];
  return { metrics: m, outcomes, durAvg: avg(durs), p95, claimFixed };
}

export function consistency(run: EvalRun, records: Record<string, SkuRecord>) {
  const groups = new Map<string, SkuRecord[]>();
  Object.values(records).forEach((r) => {
    if (r.consistencyOf) groups.set(r.consistencyOf, [...(groups.get(r.consistencyOf) ?? []), r]);
  });
  const rows = Array.from(groups.entries()).map(([sku_id, recs]) => {
    const sets = recs.map((r) => (r.result ? r.result.top_edits.map((e) => e.field).sort().join(",") : "failed"));
    return {
      sku_id, runs: recs.length, fields: sets,
      sameFields: recs.length >= 3 && new Set(sets).size === 1 && sets[0] !== "failed",
      allPassed: recs.length >= 3 && recs.every((r) => r.status === "ok" && r.failures.length === 0),
    };
  });
  return { rows, same: rows.filter((r) => r.sameFields).length, passed: rows.filter((r) => r.allPassed).length, enabled: run.consistency };
}

export type SampleItem = { id: string; sku_id: string; rank: number };

export function sampleEdits(run: EvalRun, records: Record<string, SkuRecord>): SampleItem[] {
  const all: (SampleItem & { field: string })[] = [];
  run.queue.forEach((k) => {
    const r = records[k];
    r?.result?.top_edits.forEach((e) => all.push({ id: `${r.sku_id}:${e.rank}`, sku_id: r.sku_id, rank: e.rank, field: e.field }));
  });
  const shuffled = seededShuffle(all, run.sampleSeed);
  const pick: typeof all = [];
  (["title", "bullets", "description"] as const).forEach((f) => {
    const x = shuffled.find((e) => e.field === f);
    if (x) pick.push(x);
  });
  shuffled.forEach((e) => { if (pick.length < 10 && !pick.includes(e)) pick.push(e); });
  return pick.map(({ id, sku_id, rank }) => ({ id, sku_id, rank }));
}

export const RATINGS = [
  { key: "compliant", label: "Compliant", rubric: ["breaks a guideline", "borderline", "fully compliant"] },
  { key: "faithful", label: "Faithful", rubric: ["invents facts", "small overreach or wording that implies more than the source", "only facts from the source or placeholders"] },
  { key: "better", label: "Better", rubric: ["worse or no clearer than the original", "somewhat better", "clearly better"] },
  { key: "usable", label: "Usable", rubric: ["needs a rewrite", "needs light edits", "publish as is"] },
] as const;

export function humanSummary(run: EvalRun, sample: SampleItem[]) {
  const scored = sample.map((s) => run.scores[s.id]).filter((s): s is HumanScore => !!s && RATINGS.every((r) => s[r.key] != null) && s.hallucination != null);
  const avg = (k: (typeof RATINGS)[number]["key"]) => (scored.length ? scored.reduce((n, s) => n + (s[k] ?? 0), 0) / scored.length : null);
  return {
    n: scored.length,
    total: sample.length,
    avgs: Object.fromEntries(RATINGS.map((r) => [r.key, avg(r.key)])) as Record<(typeof RATINGS)[number]["key"], number | null>,
    halluc: scored.filter((s) => s.hallucination).length,
  };
}
