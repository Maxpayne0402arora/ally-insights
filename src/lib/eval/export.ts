import Papa from "papaparse";
import { computeMetrics, humanSummary, sampleEdits, type Metric } from "./metrics";
import { isRulesOnlyRow, type EvalRun, type SkuRecord } from "./types";

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function resultsCsv(run: EvalRun, records: Record<string, SkuRecord>) {
  const { outcomes } = computeMetrics(run, records);
  const rows = outcomes.flatMap((o) =>
    o.results.map((r) => ({
      run_name: run.name, prompt_version: run.promptVersion, sku_id: o.sku.sku_id, scenario: o.scenario,
      assertion: r.label, result: r.pass ? "pass" : "fail", reason: r.reason,
    })),
  );
  return Papa.unparse(rows);
}

const MD_LABELS: Record<string, string> = {
  recall: "Expected flags found (rules engine recall)",
  precision: "False-positive traps avoided (rules engine precision)",
  scenario: "Scenario pass rate",
  compliance: "Compliance rate",
  claims: "Unsupported-claim rate (first attempt)",
  fabrication: "Evidence fabrication rate (first attempt)",
  leaks: "Competitor-name leaks",
  coverage: "Coverage",
  autoAdded: "Auto-added to open issues",
};

function metricRows(run: EvalRun, records: Record<string, SkuRecord>) {
  const { metrics } = computeMetrics(run, records);
  const by = (k: string) => metrics.find((m) => m.key === k)!;
  const sample = sampleEdits(run, records);
  const h = humanSummary(run, sample);
  const f = (n: number | null) => (n == null ? "—" : n.toFixed(2));
  const rows: [string, string, Metric | null][] = Object.keys(MD_LABELS).map((k) => [MD_LABELS[k]!, by(k).display, by(k)]);
  rows.push(["Guardrail pass: first attempt / after retry", `${by("pass1").display} / ${by("pass2").display}`, null]);
  rows.push(["Avg / p95 duration per SKU", by("dur").display, null]);
  rows.push([`Human scores (n=${h.n}): Compliant / Faithful / Better / Usable`, `${f(h.avgs.compliant)} / ${f(h.avgs.faithful)} / ${f(h.avgs.better)} / ${f(h.avgs.usable)}`, null]);
  rows.push(["Human-verified hallucination rate", `${h.halluc}/${h.n}`, null]);
  return rows;
}

function header(run: EvalRun) {
  const clients = run.set.rows.filter((r) => r.sku.is_client).length;
  const scen = run.set.rows.filter((r) => r.scenario).length;
  const rulesOnly = run.set.rows.filter(isRulesOnlyRow).length;
  const ai = run.set.rows.filter((r) => r.sku.is_client && !isRulesOnlyRow(r)).length;
  return `Prompt ${run.promptVersion} · Model ${run.model ?? "—"} · ${new Date(run.createdAt).toLocaleString()} · ${ai} AI rows · ${rulesOnly} rules-only rows · ${clients} client SKUs · ${scen} scenarios`;
}

function failedScenarios(run: EvalRun, records: Record<string, SkuRecord>) {
  const { outcomes } = computeMetrics(run, records);
  const lines = outcomes.filter((o) => o.scenario).flatMap((o) => o.results.filter((r) => !r.pass).map((r) => `- ${o.scenario}: ${r.label} — ${r.reason}`));
  return lines.length ? lines : ["- None"];
}

export function metricsMarkdown(a: EvalRun, ra: Record<string, SkuRecord>, b?: EvalRun, rb?: Record<string, SkuRecord>) {
  const L: string[] = [];
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  if (!b || !rb) {
    L.push(`## Eval run: ${a.name}`, header(a), "", "| Metric | Result |", "|---|---|");
    metricRows(a, ra).forEach(([l, v]) => L.push(`| ${esc(l)} | ${esc(v)} |`));
    L.push("", "### Failed scenarios", ...failedScenarios(a, ra));
    return L.join("\n");
  }
  L.push(`## Eval comparison: ${a.name} vs ${b.name}`, `A: ${header(a)}`, `B: ${header(b)}`, "", `| Metric | ${esc(a.name)} | ${esc(b.name)} | Change |`, "|---|---|---|---|");
  const A = metricRows(a, ra), B = metricRows(b, rb);
  A.forEach(([l, v, m], i) => {
    const [, vb, mb] = B[i]!;
    let change = "";
    if (m && mb && m.value != null && mb.value != null) {
      const d = mb.value - m.value;
      const good = d === 0 ? "=" : (d > 0) === (m.better === "higher") ? "better" : "worse";
      change = `${d > 0 ? "+" : ""}${Math.round(d * 10) / 10} (${good})`;
    }
    L.push(`| ${esc(l)} | ${esc(v)} | ${esc(vb)} | ${change} |`);
  });
  L.push("", `### Failed scenarios (${b.name})`, ...failedScenarios(b, rb));
  return L.join("\n");
}
