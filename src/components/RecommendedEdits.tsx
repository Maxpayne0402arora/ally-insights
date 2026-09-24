import { useEffect, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useGeneration, type JobState, type StoredResult, type AttemptLog } from "@/context/GenerationContext";
import { TOP3_EDITS_PROMPT_VERSION } from "@/prompts/top3Edits";
import type { Edit, FieldText, GuardFailure } from "@/lib/top3";
import type { Finding, Sku } from "@/types/sku";
import { cn } from "@/lib/utils";

/* ---------------------------- diff ---------------------------- */

type Op = { t: "same" | "add" | "del"; s: string };
const tokenize = (s: string) => s.match(/\[confirm:[^\]]*\]\s*|\S+\s*/gi) ?? [];

function diffWords(a: string, b: string): Op[] {
  const x = tokenize(a);
  const y = tokenize(b);
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const ops: Op[] = [];
  const push = (t: Op["t"], s: string) => {
    const last = ops[ops.length - 1];
    if (last && last.t === t) last.s += s;
    else ops.push({ t, s });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push("same", x[i]!); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { push("del", x[i]!); i++; }
    else { push("add", y[j]!); j++; }
  }
  while (i < n) push("del", x[i++]!);
  while (j < m) push("add", y[j++]!);
  return ops;
}

/** Plain text with [confirm: …] placeholders highlighted amber. Never renders HTML. */
function withPlaceholders(s: string): ReactNode {
  const parts = s.split(/(\[confirm:[^\]]*\])/gi);
  return parts.map((p, i) =>
    /^\[confirm:/i.test(p) ? (
      <span key={i} className="rounded-sm bg-warning-soft px-0.5 font-medium text-warning ring-1 ring-warning/30">{p}</span>
    ) : (
      p
    ),
  );
}

function Diff({ from, to }: { from: string; to: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-6">
      {diffWords(from, to).map((op, i) =>
        op.t === "same" ? (
          <span key={i}>{withPlaceholders(op.s)}</span>
        ) : op.t === "del" ? (
          <del key={i} className="bg-danger-soft text-danger line-through decoration-danger/70">{op.s}</del>
        ) : (
          <ins key={i} className="bg-success-soft text-success no-underline">{withPlaceholders(op.s)}</ins>
        ),
      )}
    </p>
  );
}

function FieldDiff({ current, proposed }: { current: FieldText; proposed: FieldText }) {
  if (!Array.isArray(current) && !Array.isArray(proposed)) return <Diff from={current} to={proposed} />;
  const a = Array.isArray(current) ? current : [current];
  const b = Array.isArray(proposed) ? proposed : [proposed];
  const len = Math.max(a.length, b.length);
  return (
    <ol className="space-y-2">
      {Array.from({ length: len }, (_, i) => {
        const cur = a[i];
        const next = b[i];
        return (
          <li key={i} className="flex gap-2">
            <span className="pt-0.5 text-xs text-muted-foreground">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              {cur === undefined ? (
                <><span className="mr-1 text-xs font-medium text-success">Added</span><Diff from="" to={next ?? ""} /></>
              ) : next === undefined ? (
                <><span className="mr-1 text-xs font-medium text-danger">Removed</span><Diff from={cur} to="" /></>
              ) : (
                <Diff from={cur} to={next} />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------- helpers ---------------------------- */

const ERROR_TEXT: Record<string, string> = {
  timeout: "This took too long. Try again.",
  rate_limit: "Too many requests. Wait a minute and try again.",
  credits: "AI credits have run out for this workspace.",
  too_large: "This listing is too large to analyse.",
  network: "Couldn't reach the AI service. Check your connection and try again.",
  other: "Something went wrong generating recommendations.",
};
const STAGES = ["Reading findings…", "Benchmarking competitors…", "Drafting compliant edits…", "Checking against guidelines…"];
const FIELD_LABEL: Record<string, string> = { title: "Title", bullets: "Bullets", description: "Description" };

function RuleChip({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => onOpen(id)} className="h-auto px-2 py-0.5 font-mono text-xs text-primary">
      {id}
    </Button>
  );
}

function FailureList({ failures }: { failures: GuardFailure[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">
      {failures.map((f, i) => <li key={i} className="break-words">{f.detail}</li>)}
    </ul>
  );
}

/** Finding status derived from a stored result (display only — never changes findings). */
export function findingStatuses(stored: StoredResult | undefined) {
  const map = new Map<string, string>();
  if (!stored) return map;
  stored.result.top_edits.forEach((e) => e.resolves_finding_ids.forEach((id) => map.set(id, `Fixed by edit #${e.rank}`)));
  stored.result.open_issues.forEach((o) => map.set(o.finding_id, "Still open"));
  stored.result.suspected_false_positives.forEach((o) => map.set(o.finding_id, "AI: possibly not an issue"));
  return map;
}

/* ---------------------------- component ---------------------------- */

type Props = {
  sku: Sku;
  allSkus: Sku[];
  findings: Finding[];
  isDismissed: (id: string) => boolean;
  onDismiss: (id: string) => void;
  onOpenRule: (id: string) => void;
  onPeek: (sku: Sku, evidence: string) => void;
};

export function RecommendedEdits({ sku, allSkus, findings, isDismissed, onDismiss, onOpenRule, onPeek }: Props) {
  const { cacheKeyFor, results, jobs, generate, cancel } = useGeneration();
  const key = cacheKeyFor(sku.sku_id);
  const stored = results[key];
  const job = jobs[key];
  const [hoodOpen, setHoodOpen] = useState(false);
  const running = job?.status === "running";

  return (
    <section className="mt-12 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Top 3 recommended edits</h2>
        </div>
        {(stored || job?.status === "error") && (
          <Button variant="ghost" size="sm" onClick={() => setHoodOpen(true)}>Under the hood</Button>
        )}
      </div>

      {running ? (
        <Running job={job} onCancel={() => cancel(sku.sku_id)} />
      ) : job?.status === "error" ? (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-danger"><XCircle className="h-4 w-4" />{ERROR_TEXT[job.code]}</p>
          {job.code === "other" && <p className="mt-1 text-xs text-muted-foreground">Details are in "Under the hood".</p>}
          <Button className="mt-4" onClick={() => generate(sku)}>Try again</Button>
        </div>
      ) : stored ? (
        <Results stored={stored} sku={sku} allSkus={allSkus} findings={findings} isDismissed={isDismissed} onDismiss={onDismiss} onOpenRule={onOpenRule} onPeek={onPeek} onRegenerate={() => generate(sku)} />
      ) : (
        <div className="mt-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Ally drafts up to three rewrites (title, bullets or description), ranked by compliance impact and competitive value. Every
            draft is checked against the same guideline rules before you see it.
          </p>
          <Button className="mt-4" onClick={() => generate(sku)}>Generate recommendations</Button>
        </div>
      )}

      <UnderTheHood open={hoodOpen} onOpenChange={setHoodOpen} stored={stored} job={job} />
    </section>
  );
}

function Running({ job, onCancel }: { job: Extract<JobState, { status: "running" }>; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - job.startedAt) / 1000));
  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(elapsed / 5))];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-secondary/50 p-5" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{stage}</p>
        <p className="text-xs text-muted-foreground">{elapsed}s elapsed · you can leave this page, it keeps running</p>
      </div>
      <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
      <Button size="sm" disabled>Generate recommendations</Button>
    </div>
  );
}

function Results({
  stored, sku, allSkus, findings, isDismissed, onDismiss, onOpenRule, onPeek, onRegenerate,
}: Omit<Props, never> & { stored: StoredResult; onRegenerate: () => void }) {
  const { result, failures } = stored;
  const byId = new Map(findings.map((f) => [f.id, f]));
  const skuById = new Map(allSkus.map((s) => [s.sku_id, s]));
  const banner = failures.filter((f) => f.edit_rank == null || !result.top_edits.some((e) => e.rank === f.edit_rank));

  return (
    <div className="mt-3 space-y-6">
      <p className="text-xs text-muted-foreground">
        Generated {formatDistanceToNow(new Date(stored.generatedAt), { addSuffix: true })} · prompt {stored.promptVersion} ·{" "}
        <button type="button" onClick={onRegenerate} className="font-medium text-primary hover:underline">Regenerate</button>
      </p>

      {result.summary && <p className="max-w-3xl break-words text-sm text-foreground">{result.summary}</p>}
      {result.strengths.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {result.strengths.map((s, i) => (
            <span key={i} className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">{s}</span>
          ))}
        </div>
      )}

      {banner.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-danger"><AlertTriangle className="h-4 w-4" />Some checks failed on the overall response</p>
          <FailureList failures={banner} />
        </div>
      )}

      {result.top_edits.length === 0 ? (
        <div className="rounded-lg border border-success/30 bg-success-soft p-5 text-sm font-medium text-success">
          No changes recommended. This listing meets the guidelines and compares well with its competitors.
        </div>
      ) : (
        <ol className="space-y-5">
          {result.top_edits.map((e) => (
            <EditCard key={e.rank} edit={e} failures={failures.filter((f) => f.edit_rank === e.rank)} skuById={skuById} onOpenRule={onOpenRule} onPeek={onPeek} />
          ))}
        </ol>
      )}

      {result.suspected_false_positives.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground">The AI thinks these may not be issues</h3>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {result.suspected_false_positives.map((s) => {
              const f = byId.get(s.finding_id);
              const done = isDismissed(s.finding_id);
              return (
                <li key={s.finding_id} className="flex flex-wrap items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm text-foreground">{f?.message ?? s.finding_id}</p>
                    {f?.evidence && <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{f.evidence}</p>}
                    <p className="mt-1 break-words text-sm text-muted-foreground">AI: {s.reason}</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={done} onClick={() => onDismiss(s.finding_id)}>
                    {done ? "Dismissed" : "Not an issue"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {result.open_issues.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground">Still open</h3>
          <ul className="mt-2 space-y-2">
            {result.open_issues.map((o) => {
              const f = byId.get(o.finding_id);
              return (
                <li key={o.finding_id} className="rounded-md bg-secondary p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {f && <RuleChip id={f.rule_id} onOpen={onOpenRule} />}
                    <span className="break-words text-foreground">{f?.message ?? o.finding_id}</span>
                  </div>
                  <p className="mt-1 break-words text-muted-foreground">{o.reason}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {result.action_items.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground">Action items</h3>
          <ul className="mt-2 space-y-2">
            {result.action_items.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-secondary p-3 text-sm">
                <span className="break-words text-foreground">{a.what}</span>
                {a.rule_ids.map((id) => <RuleChip key={id} id={id} onOpen={onOpenRule} />)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <span className="sr-only">{sku.sku_id}</span>
    </div>
  );
}

function EditCard({
  edit, failures, skuById, onOpenRule, onPeek,
}: {
  edit: Edit;
  failures: GuardFailure[];
  skuById: Map<string, Sku>;
  onOpenRule: (id: string) => void;
  onPeek: (sku: Sku, evidence: string) => void;
}) {
  const passed = failures.length === 0;
  return (
    <li className="min-w-0 rounded-lg border border-border p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{edit.rank}</span>
        <h3 className="font-semibold text-foreground">{FIELD_LABEL[edit.field]}</h3>
        <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", passed ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
          {passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {passed ? "Passed guideline checks" : "Failed checks"}
        </span>
      </div>
      {edit.why_ranked && <p className="mt-2 break-words text-sm text-muted-foreground">{edit.why_ranked}</p>}

      <div className="mt-4 rounded-md border border-border bg-background p-3">
        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Current → proposed</p>
        <FieldDiff current={edit.current} proposed={edit.proposed_full} />
      </div>

      {edit.changes.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">What changed</p>
          <ul className="mt-2 space-y-2">
            {edit.changes.map((c, i) => (
              <li key={i} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", c.type === "compliance" ? "bg-danger-soft text-danger" : "bg-primary/10 text-primary")}>
                    {c.type === "compliance" ? "Compliance" : "Competitive"}
                  </span>
                  <span className="min-w-0 break-words text-foreground">{c.what}</span>
                  {c.rule_ids.map((id) => <RuleChip key={id} id={id} onOpen={onOpenRule} />)}
                </div>
                {c.competitor_refs.map((r, j) => {
                  const comp = skuById.get(r.sku_id);
                  return (
                    <button
                      key={j}
                      type="button"
                      disabled={!comp}
                      onClick={() => comp && onPeek(comp, r.evidence)}
                      className="mt-1 block max-w-full break-words text-left text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                    >
                      {r.brand || comp?.brand} ({r.sku_id}): '{r.evidence}'
                    </button>
                  );
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {edit.placeholders.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Needs confirmation</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {edit.placeholders.map((p, i) => (
              <li key={i} className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">[{p}]</li>
            ))}
          </ul>
        </div>
      )}

      {!passed && <FailureList failures={failures} />}
    </li>
  );
}

/* ---------------------------- under the hood ---------------------------- */

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">{title}</summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}
const Pre = ({ children }: { children: string }) => (
  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-secondary p-3 font-mono text-xs text-foreground">{children}</pre>
);
const pretty = (s: string) => {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
};

function UnderTheHood({ open, onOpenChange, stored, job }: { open: boolean; onOpenChange: (o: boolean) => void; stored: StoredResult | undefined; job: JobState | undefined }) {
  const errLog = job?.status === "error" ? job.log : undefined;
  const src: Partial<StoredResult> | undefined = errLog ?? stored;
  const attempts: AttemptLog[] = src?.attempts ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pr-10 text-left">
          <SheetTitle>Under the hood</SheetTitle>
          <SheetDescription>Exactly what was sent to the AI and how its output was checked.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3 text-sm">
          {job?.status === "error" && (
            <p className="break-words rounded-md bg-danger-soft p-3 text-danger">Error: {job.code} · {job.detail}</p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Prompt version</dt><dd>{src?.promptVersion ?? TOP3_EDITS_PROMPT_VERSION}</dd>
            <dt className="text-muted-foreground">Model</dt><dd>{stored && !errLog ? stored.model : attempts.find((a) => a.model)?.model ?? "—"}</dd>
            <dt className="text-muted-foreground">Attempts</dt><dd>{attempts.length}</dd>
            <dt className="text-muted-foreground">Kept attempt</dt><dd>{stored && !errLog ? stored.keptAttempt : "—"}</dd>
            <dt className="text-muted-foreground">Duration</dt><dd>{src?.durationMs != null ? `${(src.durationMs / 1000).toFixed(1)}s` : "—"}</dd>
          </dl>
          {src?.system && <Block title="System prompt"><Pre>{src.system}</Pre></Block>}
          {src?.userPayload && <Block title="User payload"><Pre>{pretty(src.userPayload)}</Pre></Block>}
          {attempts.map((a) => (
            <Block key={a.attempt} title={`Attempt ${a.attempt} · ${a.failures.length} guardrail failure${a.failures.length === 1 ? "" : "s"}`}>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  finish_reason: {a.finish_reason ?? "—"} · tokens: {a.usage ? JSON.stringify(a.usage) : "unknown"}
                </p>
                {a.httpError && <p className="break-words text-danger">Request failed: {a.httpError}</p>}
                {a.parseError && <p className="break-words text-danger">{a.parseError}</p>}
                {a.attempt > 1 && <Block title="Retry instruction appended"><Pre>{a.userMessage.slice((src?.userPayload ?? "").length).trim()}</Pre></Block>}
                <Block title="Raw response"><Pre>{a.raw ?? "(none)"}</Pre></Block>
                <Block title="Guardrail results">
                  {a.failures.length ? <FailureList failures={a.failures} /> : <p className="text-success">All checks passed.</p>}
                </Block>
              </div>
            </Block>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
