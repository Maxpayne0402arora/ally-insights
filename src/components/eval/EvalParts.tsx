import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { joined, asList } from "@/lib/top3";
import { consistency, computeMetrics, humanSummary, RATINGS, sampleEdits, type Metric, type RowOutcome } from "@/lib/eval/metrics";
import type { EvalRun, HumanScore, SkuRecord } from "@/lib/eval/types";
import type { Sku } from "@/types/sku";
import { cn } from "@/lib/utils";

export function PassFail({ pass }: { pass: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium", pass ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
      {pass ? "Pass" : "Fail"}
    </span>
  );
}

export function MetricCards({ metrics }: { metrics: Metric[] }) {
  const groups = ["Rules engine", "AI output quality", "Performance"] as const;
  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{g}</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {metrics.filter((m) => m.group === g).map((m) => (
                <div key={m.key} className="min-w-0 rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
                    <span>{m.label}</span>
                    <Tooltip>
                      <TooltipTrigger aria-label={`About ${m.label}`}><Info className="h-3.5 w-3.5" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">{m.tip}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="mt-1 break-words text-lg font-semibold text-foreground">{m.display}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </TooltipProvider>
  );
}

function FieldBlock({ label, text }: { label: string; text: string | string[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {Array.isArray(text) ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm">{text.map((t, i) => <li key={i} className="break-words">{t}</li>)}</ol>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">{text || "—"}</p>
      )}
    </div>
  );
}

export function RecordDetail({ rec, sku, onClose }: { rec: SkuRecord | null; sku: Sku | undefined; onClose: () => void }) {
  return (
    <Dialog open={!!rec} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        {rec && (
          <>
            <DialogHeader><DialogTitle className="break-words">{sku?.brand} · {rec.sku_id}{rec.consistencyOf ? ` (repeat)` : ""}</DialogTitle></DialogHeader>
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                {rec.status === "ok" ? `Kept attempt ${rec.kept} of ${rec.attempts.length}` : `Failed: ${rec.error}`} · {(rec.durationMs / 1000).toFixed(1)}s
              </p>
              {rec.assertions.length > 0 && (
                <section>
                  <h4 className="mb-1 font-semibold">Assertions</h4>
                  <ul className="space-y-1">{rec.assertions.map((a, i) => <li key={i} className="flex gap-2 break-words"><PassFail pass={a.pass} /><span><code className="text-xs">{a.label}</code> — {a.reason}</span></li>)}</ul>
                </section>
              )}
              {rec.result?.top_edits.map((e) => (
                <section key={e.rank} className="rounded-md border border-border p-3">
                  <h4 className="mb-2 font-semibold">#{e.rank} · {e.field}</h4>
                  <div className="grid gap-3 md:grid-cols-2">
                    <FieldBlock label="Before" text={e.current} />
                    <FieldBlock label="After (full)" text={e.proposed_full} />
                  </div>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
                    {e.changes.map((c, i) => <li key={i} className="break-words"><strong>{c.type === "compliance" ? "Compliance" : "Competitive"}:</strong> {c.what} {c.rule_ids.join(", ")} {c.competitor_refs.map((r) => `${r.brand} (${r.sku_id}): "${r.evidence}"`).join("; ")}</li>)}
                  </ul>
                </section>
              ))}
              {rec.attempts.map((a) => (
                <details key={a.attempt} className="rounded-md border border-border p-2">
                  <summary className="cursor-pointer font-medium">Attempt {a.attempt} · {a.failures.length} guardrail failure(s){a.error ? ` · ${a.error}` : ""}</summary>
                  <ul className="my-2 list-disc pl-5 text-xs">{a.failures.map((f, i) => <li key={i} className="break-words">{f.edit_rank != null ? `Edit #${f.edit_rank}: ` : ""}[{f.check}] {f.detail}</li>)}</ul>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{a.raw ?? "(no output)"}</pre>
                </details>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OutcomeTables({ outcomes, onOpen }: { outcomes: RowOutcome[]; onOpen: (o: RowOutcome) => void }) {
  const [sortFail, setSortFail] = useState(true);
  const scen = outcomes.filter((o) => o.scenario);
  const all = useMemo(() => {
    const withF = outcomes.filter((o) => o.results.length || o.record).map((o) => ({ o, f: o.results.filter((r) => !r.pass).length }));
    return sortFail ? withF.sort((a, b) => b.f - a.f) : withF.sort((a, b) => a.o.sku.sku_id.localeCompare(b.o.sku.sku_id));
  }, [outcomes, sortFail]);
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-semibold">Scenarios ({scen.length})</h3>
        <div className="space-y-2">
          {scen.map((o) => (
            <div key={o.key} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 break-words text-sm"><span className="font-mono text-xs">{o.sku.sku_id}</span> — {o.scenario}</div>
                <Button size="sm" variant="outline" onClick={() => onOpen(o)} disabled={!o.record}>Open output</Button>
              </div>
              <ul className="mt-2 space-y-1 text-xs">{o.results.map((r, i) => <li key={i} className="flex gap-2 break-words"><PassFail pass={r.pass} /><span><code>{r.label}</code> — {r.reason}</span></li>)}</ul>
            </div>
          ))}
          {!scen.length && <p className="text-sm text-muted-foreground">No scenario rows in this eval set.</p>}
        </div>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-semibold">All SKUs</h3>
          <Button size="sm" variant="ghost" onClick={() => setSortFail((s) => !s)}>Sort: {sortFail ? "most failures" : "SKU id"}</Button>
        </div>
        <div className="max-w-full overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="p-2">SKU</th><th className="p-2">Brand</th><th className="p-2">Status</th><th className="p-2">Failures</th><th className="p-2">Assertions</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {all.map(({ o, f }) => (
                <tr key={o.key} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{o.sku.sku_id}</td>
                  <td className="p-2">{o.sku.brand}</td>
                  <td className="p-2">{o.record ? o.record.status === "ok" ? "Generated" : "Failed" : o.results.some((r) => r.kind === "ai") ? "Pending" : "Rules only"}</td>
                  <td className="p-2">{f}</td>
                  <td className="p-2">{o.results.length}</td>
                  <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => onOpen(o)} disabled={!o.record}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ConsistencyPanel({ run, records }: { run: EvalRun; records: Record<string, SkuRecord> }) {
  const c = consistency(run, records);
  if (!c.enabled) return null;
  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="font-semibold">Consistency</h3>
      <p className="text-sm text-muted-foreground">Same fields chosen: {c.same}/{c.rows.length} SKUs · All 3 passed guardrail: {c.passed}/{c.rows.length} SKUs</p>
      <ul className="mt-2 space-y-1 text-sm">
        {c.rows.map((r) => (
          <li key={r.sku_id} className="break-words"><span className="font-mono text-xs">{r.sku_id}</span> — {r.runs}/3 runs · fields: {r.fields.map((f) => `[${f || "none"}]`).join(" ")} · {r.sameFields ? "same fields" : "fields differ"} · {r.allPassed ? "all passed" : "not all passed"}</li>
        ))}
      </ul>
    </section>
  );
}

export function HumanScoring({ run, records, onChange }: { run: EvalRun; records: Record<string, SkuRecord>; onChange: (r: EvalRun) => void }) {
  const sample = useMemo(() => sampleEdits(run, records), [run, records]);
  const h = humanSummary(run, sample);
  const skuById = new Map(run.set.skus.map((s) => [s.sku_id, s]));
  const setScore = (id: string, patch: Partial<HumanScore>) =>
    onChange({ ...run, scores: { ...run.scores, [id]: { ...run.scores[id], ...patch } } });
  if (!sample.length) return <p className="text-sm text-muted-foreground">No edits in this run yet.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{h.n} of {h.total} scored · Averages: {RATINGS.map((r) => `${r.label} ${h.avgs[r.key]?.toFixed(2) ?? "—"}`).join(" · ")} · Hallucinations {h.halluc}/{h.n}</span>
        <Button size="sm" variant="outline" onClick={() => onChange({ ...run, sampleSeed: Math.floor(Math.random() * 1e9) })}>Resample</Button>
      </div>
      {sample.map((s, i) => {
        const rec = records[s.sku_id];
        const e = rec?.result?.top_edits.find((x) => x.rank === s.rank);
        const sku = skuById.get(s.sku_id);
        if (!e || !sku) return null;
        const sc = run.scores[s.id] ?? {};
        const needNote = sc.hallucination && !sc.hallucinationNote?.trim();
        return (
          <article key={s.id} className="rounded-lg border border-border p-4">
            <h4 className="mb-2 font-semibold break-words">{i + 1}. {sku.brand} · {sku.sku_id} · {e.field}</h4>
            <div className="grid gap-3 md:grid-cols-2">
              <FieldBlock label="Before" text={e.current} />
              <FieldBlock label="After" text={e.proposed_full} />
            </div>
            <ul className="mt-2 list-disc pl-5 text-xs">{e.changes.map((c, j) => <li key={j} className="break-words"><strong>{c.type}:</strong> {c.what}</li>)}</ul>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer">Source listing</summary>
              <div className="mt-2 space-y-2">
                <FieldBlock label="Title" text={sku.title} />
                <FieldBlock label="Bullets" text={asList(sku.bullets)} />
                <FieldBlock label="Description" text={sku.description} />
              </div>
            </details>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {RATINGS.map((r) => (
                <fieldset key={r.key} className="text-sm">
                  <legend className="font-medium">{r.label}</legend>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {[1, 2, 3].map((n) => (
                      <Button key={n} size="sm" variant={sc[r.key] === n ? "default" : "outline"} aria-pressed={sc[r.key] === n} onClick={() => setScore(s.id, { [r.key]: n })} title={r.rubric[n - 1]}>{n}</Button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.rubric.map((t, k) => `${k + 1} = ${t}`).join(" · ")}</p>
                </fieldset>
              ))}
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Hallucination spotted?</span>
                <Button size="sm" variant={sc.hallucination === true ? "default" : "outline"} aria-pressed={sc.hallucination === true} onClick={() => setScore(s.id, { hallucination: true })}>Yes</Button>
                <Button size="sm" variant={sc.hallucination === false ? "default" : "outline"} aria-pressed={sc.hallucination === false} onClick={() => setScore(s.id, { hallucination: false })}>No</Button>
              </div>
              {sc.hallucination && (
                <div>
                  <Textarea aria-label="Quote the invented text" placeholder="Quote the invented text (required)" value={sc.hallucinationNote ?? ""} onChange={(ev) => setScore(s.id, { hallucinationNote: ev.target.value })} />
                  {needNote && <p className="mt-1 text-xs text-danger">A note quoting the invented text is required.</p>}
                </div>
              )}
              <Textarea aria-label="Note" placeholder="Note (optional)" value={sc.note ?? ""} onChange={(ev) => setScore(s.id, { note: ev.target.value })} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function CompareRuns({ a, ra, b, rb }: { a: EvalRun; ra: Record<string, SkuRecord>; b: EvalRun; rb: Record<string, SkuRecord> }) {
  const ma = computeMetrics(a, ra), mb = computeMetrics(b, rb);
  const scenKey = (o: RowOutcome) => `${o.sku.sku_id}|${o.scenario}`;
  const passA = new Map(ma.outcomes.filter((o) => o.scenario).map((o) => [scenKey(o), o.results.every((r) => r.pass)]));
  const diff = { fixed: [] as string[], broke: [] as string[], still: [] as string[] };
  mb.outcomes.filter((o) => o.scenario).forEach((o) => {
    const before = passA.get(scenKey(o));
    const now = o.results.every((r) => r.pass);
    const label = `${o.sku.sku_id} — ${o.scenario}`;
    if (before === false && now) diff.fixed.push(label);
    else if (before === true && !now) diff.broke.push(label);
    else if (before === false && !now) diff.still.push(label);
  });
  const ha = humanSummary(a, sampleEdits(a, ra)), hb = humanSummary(b, sampleEdits(b, rb));
  return (
    <div className="space-y-5">
      <div className="max-w-full overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="p-2">Metric</th><th className="p-2 break-words">{a.name}</th><th className="p-2 break-words">{b.name}</th><th className="p-2">Change</th></tr>
          </thead>
          <tbody>
            {ma.metrics.map((m, i) => {
              const n = mb.metrics[i]!;
              const d = m.value != null && n.value != null ? n.value - m.value : null;
              const good = d == null || d === 0 ? null : (d > 0) === (m.better === "higher");
              return (
                <tr key={m.key} className="border-t border-border">
                  <td className="p-2">{m.label} <span className="text-xs text-muted-foreground">({m.better} is better)</span></td>
                  <td className="p-2">{m.display}</td>
                  <td className="p-2">{n.display}</td>
                  <td className={cn("p-2 font-medium", good === true && "text-success", good === false && "text-danger")}>
                    {d == null ? "—" : d === 0 ? "No change" : `${d > 0 ? "+" : ""}${Math.round(d * 10) / 10} · ${good ? "better" : "worse"}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {([["Fail → pass", diff.fixed], ["Pass → fail", diff.broke], ["Stayed failed", diff.still]] as const).map(([t, l]) => (
          <section key={t} className="rounded-md border border-border p-3">
            <h4 className="mb-1 text-sm font-semibold">{t} <Badge variant="secondary">{l.length}</Badge></h4>
            <ul className="space-y-0.5 text-xs">{l.map((x) => <li key={x} className="break-words">{x}</li>)}{!l.length && <li className="text-muted-foreground">None</li>}</ul>
          </section>
        ))}
      </div>
      {ha.n > 0 && hb.n > 0 && (
        <section className="text-sm">
          <h4 className="mb-1 font-semibold">Human scores</h4>
          {RATINGS.map((r) => <p key={r.key}>{r.label}: {ha.avgs[r.key]?.toFixed(2)} → {hb.avgs[r.key]?.toFixed(2)}</p>)}
          <p>Hallucinations: {ha.halluc}/{ha.n} → {hb.halluc}/{hb.n}</p>
        </section>
      )}
    </div>
  );
}

export { joined };
