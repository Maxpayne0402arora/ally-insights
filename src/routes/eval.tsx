import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROMPTS, CURRENT_PROMPT_VERSION } from "@/prompts";
import { parseEvalCsv, setSummary } from "@/lib/eval/parse";
import { runSkuPipeline, seededShuffle } from "@/lib/eval/pipeline";
import { evaluateRow } from "@/lib/eval/assertions";
import { computeMetrics, type RowOutcome } from "@/lib/eval/metrics";
import { deleteRun, loadRecords, loadRuns, saveRecord, saveRun } from "@/lib/eval/store";
import { download, metricsMarkdown, resultsCsv } from "@/lib/eval/export";
import type { EvalRow, EvalRun, EvalSet, RunMode, SkuRecord } from "@/lib/eval/types";
import { CompareRuns, ConsistencyPanel, HumanScoring, MetricCards, OutcomeTables, RecordDetail } from "@/components/eval/EvalParts";

export const Route = createFileRoute("/eval")({
  head: () => ({
    meta: [
      { title: "Eval · Ally Competitor Content Intelligence" },
      { name: "description", content: "Measure rules-engine and AI quality on a fixed test set, score samples by hand and compare prompt versions." },
      { property: "og:title", content: "Eval · Ally Competitor Content Intelligence" },
      { property: "og:description", content: "Internal evaluation dashboard for rules-engine and AI recommendation quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EvalPage,
});

const CONCURRENCY = 5;

type Task = { key: string; row: EvalRow; repeatOf?: string };

/** Rebuild the full task list for a run from its stored settings. */
function buildTasks(run: EvalRun): Task[] {
  const clients = run.set.rows.filter((r) => r.sku.is_client);
  const aiRows = run.mode === "scenarios" ? run.set.rows.filter((r) => r.scenario) : run.mode === "firstN" ? clients.slice(0, run.firstN ?? 10) : clients;
  const tasks: Task[] = aiRows.map((row) => ({ key: row.sku.sku_id, row }));
  if (run.consistency) {
    seededShuffle(clients, run.sampleSeed).slice(0, 5).forEach((row) => {
      for (let i = 1; i <= 3; i++) tasks.push({ key: `${row.sku.sku_id}#c${i}`, row, repeatOf: row.sku.sku_id });
    });
  }
  return tasks;
}

function EvalPage() {
  const [set, setSet] = useState<EvalSet | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [version, setVersion] = useState(CURRENT_PROMPT_VERSION);
  const [mode, setMode] = useState<RunMode>("all");
  const [firstN, setFirstN] = useState(10);
  const [consistencyOn, setConsistencyOn] = useState(false);

  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [records, setRecords] = useState<Record<string, Record<string, SkuRecord>>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string>("none");
  const [detail, setDetail] = useState<SkuRecord | null>(null);

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef<EvalRun | null>(null);

  useEffect(() => {
    // Runs left "running"/"paused" by a closed tab or sleeping computer are interrupted: mark them resumable.
    loadRuns().then(async (loaded) => {
      const stale = loaded.filter((r) => r.status === "running" || r.status === "paused");
      if (stale.length) {
        await Promise.all(stale.map((r) => saveRun({ ...r, status: "paused" })));
        loaded = loaded.map((r) => (r.status === "running" ? { ...r, status: "paused" as const } : r));
      }
      setRuns(loaded);
    });
  }, []);

  // If the tab closes or the computer sleeps mid-run, persist the run as paused so it can be resumed.
  useEffect(() => {
    const onHide = () => {
      const r = activeRunRef.current;
      if (r && ctrlRef.current) void saveRun({ ...r, status: "paused" });
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, []);

  const ensureRecords = useCallback(async (id: string) => {
    if (records[id]) return;
    const r = await loadRecords(id);
    setRecords((p) => ({ ...p, [id]: r }));
  }, [records]);
  useEffect(() => { if (activeId) void ensureRecords(activeId); }, [activeId, ensureRecords]);
  useEffect(() => { if (compareId !== "none") void ensureRecords(compareId); }, [compareId, ensureRecords]);

  const run = runs.find((r) => r.id === activeId) ?? null;
  const recs = (activeId && records[activeId]) || {};
  const cmp = runs.find((r) => r.id === compareId) ?? null;
  const cmpRecs = (compareId !== "none" && records[compareId]) || {};

  const updateRun = (r: EvalRun) => {
    setRuns((p) => p.map((x) => (x.id === r.id ? r : x)));
    if (activeRunRef.current?.id === r.id) activeRunRef.current = r;
    void saveRun(r);
  };

  const onFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) return setParseErrors(["Please upload a .csv file."]);
    const { set: s, errors, rowErrors: re } = parseEvalCsv(await file.text(), file.name);
    setParseErrors(errors);
    setRowErrors(re);
    setSet(s);
  };

  /** Run (or resume) a run: tasks with a saved record are skipped, so progress is never redone. */
  const executeRun = async (baseRun: EvalRun) => {
    const id = baseRun.id;
    const allTasks = buildTasks(baseRun);
    const existing = await loadRecords(id);
    setRecords((p) => ({ ...p, [id]: existing }));
    const tasks = allTasks.filter((t) => !existing[t.key]);
    const skipped = allTasks.length - tasks.length;

    const running: EvalRun = { ...baseRun, status: "running" };
    activeRunRef.current = running;
    setRuns((p) => p.map((x) => (x.id === id ? running : x)));
    await saveRun(running);

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    pausedRef.current = false;
    setPaused(false);
    setProgress({ done: skipped, total: allTasks.length });
    const system = PROMPTS[baseRun.promptVersion]!.system;
    let model: string | null = baseRun.model;
    let next = 0, done = skipped;
    const worker = async () => {
      while (!ctrl.signal.aborted) {
        while (pausedRef.current && !ctrl.signal.aborted) await new Promise((r) => setTimeout(r, 300));
        if (ctrl.signal.aborted) return;
        const t = tasks[next++];
        if (!t) return;
        try {
          const out = await runSkuPipeline(t.row.sku, baseRun.set.skus, system, ctrl.signal);
          const rec: SkuRecord = { ...out, key: t.key, scenario: t.row.scenario, consistencyOf: t.repeatOf, assertions: [] };
          if (!t.repeatOf) rec.assertions = evaluateRow(t.row, baseRun.set.skus, rec);
          model ??= rec.attempts.find((a) => a.model)?.model ?? null;
          await saveRecord(id, rec);
          setRecords((p) => ({ ...p, [id]: { ...(p[id] ?? {}), [t.key]: rec } }));
        } catch {
          if (ctrl.signal.aborted) return;
        }
        done++;
        setProgress({ done, total: allTasks.length });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const status: EvalRun["status"] = ctrl.signal.aborted ? "cancelled" : pausedRef.current ? "paused" : "done";
    const final: EvalRun = { ...activeRunRef.current!, model, status };
    activeRunRef.current = null;
    setRuns((p) => p.map((x) => (x.id === id ? final : x)));
    await saveRun(final);
    setProgress(null);
    ctrlRef.current = null;
    toast(status === "done" ? "Eval run finished" : status === "paused" ? "Eval run paused — resume anytime" : "Eval run cancelled — resume anytime");
  };

  const start = async () => {
    if (!set) return;
    const clients = set.rows.filter((r) => r.sku.is_client);
    const aiRows = mode === "scenarios" ? set.rows.filter((r) => r.scenario) : mode === "firstN" ? clients.slice(0, firstN) : clients;
    const id = crypto.randomUUID();
    const now = new Date();
    const newRun: EvalRun = {
      id, name: `${version} · ${now.toLocaleString()}`, promptVersion: version, model: null, createdAt: now.toISOString(),
      status: "running", mode, firstN, consistency: consistencyOn, set, queue: aiRows.map((r) => r.sku.sku_id),
      sampleSeed: Math.floor(Math.random() * 1e9), scores: {},
    };
    setRuns((p) => [newRun, ...p]);
    setActiveId(id);
    await saveRun(newRun);
    await executeRun(newRun);
  };

  const resume = async (r: EvalRun) => {
    setActiveId(r.id);
    await executeRun(r);
  };

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (run) updateRun({ ...run, status: pausedRef.current ? "paused" : "running" });
  };

  const metrics = useMemo(() => (run ? computeMetrics(run, recs) : null), [run, recs]);
  const openOutcome = (o: RowOutcome) => o.record && setDetail(o.record);
  const resumable = (r: EvalRun) => {
    if (progress || (r.status !== "paused" && r.status !== "cancelled")) return false;
    const done = records[r.id] ? Object.keys(records[r.id]).length : 0;
    return done < buildTasks(r).length;
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Internal · product team</p>
        <h1 className="text-2xl font-semibold text-foreground">Eval</h1>
        <p className="text-sm text-muted-foreground">Measure the rules engine and AI on a fixed test set. Progress is saved after every SKU — if the tab closes or the computer sleeps, resume the run and it continues where it stopped.</p>
      </header>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold">1 · Eval set</h2>
        <Input type="file" accept=".csv" aria-label="Upload eval CSV" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <p className="text-xs text-muted-foreground">Same columns as the main upload, plus optional <code>scenario</code> and <code>expectations</code> (JSON array of assertions).</p>
        {parseErrors.map((e) => <p key={e} className="text-sm text-danger">{e}</p>)}
        {set && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{set.fileName}: {setSummary(set)}</p>
            {rowErrors.length > 0 && (
              <details open><summary className="cursor-pointer text-danger">{rowErrors.length} row error(s)</summary>
                <ul className="list-disc pl-5 text-xs">{rowErrors.map((e) => <li key={e} className="break-words">{e}</li>)}</ul></details>
            )}
            {(set.skipped.length > 0 || set.warnings.length > 0) && (
              <details><summary className="cursor-pointer text-muted-foreground">{set.skipped.length} skipped · {set.warnings.length} warnings</summary>
                <ul className="list-disc pl-5 text-xs">{[...set.skipped, ...set.warnings].map((e) => <li key={e} className="break-words">{e}</li>)}</ul></details>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold">2 · Run</h2>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">Prompt version
            <Select value={version} onValueChange={setVersion}>
              <SelectTrigger className="mt-1 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.values(PROMPTS).map((p) => <SelectItem key={p.version} value={p.version}>{p.version} — {p.notes}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="text-sm">Rows to run
            <Select value={mode} onValueChange={(v) => setMode(v as RunMode)}>
              <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All client rows</SelectItem>
                <SelectItem value="scenarios">Scenarios only</SelectItem>
                <SelectItem value="firstN">First N</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {mode === "firstN" && (
            <label className="text-sm">N<Input type="number" min={1} className="mt-1 w-24" value={firstN} onChange={(e) => setFirstN(Math.max(1, Number(e.target.value) || 1))} /></label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={consistencyOn} onChange={(e) => setConsistencyOn(e.target.checked)} />
            Consistency check: run 5 random client SKUs 3 times each
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={start} disabled={!set || !!progress}>Start eval run</Button>
          {progress && (
            <>
              <Button variant="outline" onClick={togglePause}>{paused ? "Resume" : "Pause"}</Button>
              <Button variant="outline" onClick={() => ctrlRef.current?.abort()}>Cancel</Button>
              <span className="text-sm text-muted-foreground">{paused ? "Paused · " : ""}{progress.done}/{progress.total} SKUs</span>
            </>
          )}
        </div>
        {progress && <Progress value={(progress.done / Math.max(1, progress.total)) * 100} aria-label="Run progress" />}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Run
            <Select value={activeId ?? ""} onValueChange={setActiveId}>
              <SelectTrigger className="mt-1 w-72"><SelectValue placeholder={runs.length ? "Select a run" : "No runs yet"} /></SelectTrigger>
              <SelectContent>{runs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} ({r.status})</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="text-sm">Compare with
            <Select value={compareId} onValueChange={setCompareId}>
              <SelectTrigger className="mt-1 w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No comparison</SelectItem>
                {runs.filter((r) => r.id !== activeId).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        </div>

        {run && metrics && (
          <div className="space-y-6 rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input aria-label="Run name" className="max-w-md font-semibold" value={run.name} onChange={(e) => updateRun({ ...run, name: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                {resumable(run) && (
                  <Button size="sm" onClick={() => resume(run)}>Resume run ({Object.keys(recs).length}/{buildTasks(run).length} done)</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => download(`${run.name}-results.csv`, resultsCsv(run, recs), "text/csv")}>Export results (CSV)</Button>
                <Button size="sm" variant="outline" onClick={() => download(`${run.name}-metrics.md`, cmp ? metricsMarkdown(cmp, cmpRecs, run, recs) : metricsMarkdown(run, recs), "text/markdown")}>Export metrics (Markdown)</Button>
                <Button size="sm" variant="ghost" disabled={!!progress && run.status === "running"} onClick={async () => {
                  if (!confirm(`Delete run "${run.name}"?`)) return;
                  await deleteRun(run.id);
                  setRuns((p) => p.filter((r) => r.id !== run.id));
                  setActiveId(null);
                }}>Delete</Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Prompt {run.promptVersion} · Model {run.model ?? "—"} · {new Date(run.createdAt).toLocaleString()} · {run.queue.length} SKUs run with AI · {run.status}</p>
            <Tabs defaultValue="results">
              <TabsList className="flex-wrap">
                <TabsTrigger value="results">Results</TabsTrigger>
                <TabsTrigger value="score">Score a sample</TabsTrigger>
                <TabsTrigger value="compare" disabled={!cmp}>Compare</TabsTrigger>
              </TabsList>
              <TabsContent value="results" className="space-y-6 pt-4">
                <MetricCards metrics={metrics.metrics} />
                <ConsistencyPanel run={run} records={recs} />
                <OutcomeTables outcomes={metrics.outcomes} onOpen={openOutcome} />
              </TabsContent>
              <TabsContent value="score" className="pt-4">
                <HumanScoring run={run} records={recs} onChange={updateRun} />
              </TabsContent>
              <TabsContent value="compare" className="pt-4">
                {cmp && <CompareRuns a={cmp} ra={cmpRecs} b={run} rb={recs} />}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </section>

      <RecordDetail rec={detail} sku={run?.set.skus.find((s) => s.sku_id === detail?.sku_id)} onClose={() => setDetail(null)} />
    </div>
  );
}
