import { useEffect, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCheck, Flag, Loader2, Sparkles, XCircle } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EditCard, type SavePatch } from "@/components/EditCard";
import { useReview } from "@/context/ReviewContext";
import { evaluateItem, isDecided, TIER_LABEL, type Decision, type Item } from "@/lib/review";
import { rankReason } from "@/lib/top3";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useGeneration, type JobState, type StoredResult, type AttemptLog } from "@/context/GenerationContext";
import { TOP3_EDITS_PROMPT_VERSION } from "@/prompts/top3Edits";
import type { GuardFailure } from "@/lib/top3";
import type { Finding, Sku } from "@/types/sku";

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

/** Finding status derived from the review items (display only — never changes findings). */
export function findingStatuses(stored: StoredResult | undefined, items: Item[]) {
  const map = new Map<string, string>();
  if (!stored) return map;
  stored.result.open_issues.forEach((o) => map.set(o.finding_id, "Still open"));
  stored.result.suspected_false_positives.forEach((o) => map.set(o.finding_id, "AI: possibly not an issue"));
  items.forEach((it) => it.edit.resolves_finding_ids.forEach((id) => map.set(id, `Fixed by edit #${it.edit.rank}`)));
  return map;
}

/* ---------------------------- component ---------------------------- */

type Props = {
  sku: Sku;
  allSkus: Sku[];
  findings: Finding[];
  items: Item[];
  isDismissed: (id: string) => boolean;
  onDismiss: (id: string) => void;
  onOpenRule: (id: string) => void;
  onPeek: (sku: Sku, evidence: string) => void;
  onShowFixes: (rank: number) => void;
};

export function RecommendedEdits(props: Props) {
  const { sku, items } = props;
  const { cacheKeyFor, results, jobs, generate, cancel } = useGeneration();
  const key = cacheKeyFor(sku.sku_id);
  const stored = results[key];
  const job = jobs[key];
  const [hoodOpen, setHoodOpen] = useState(false);
  const running = job?.status === "running";

  const regenerate = () => {
    const decided = items.some((i) => isDecided(i.decision?.state));
    if (decided && !window.confirm("Pending recommendations will be replaced. Accepted and rejected edits are kept.")) return;
    generate(sku);
  };

  return (
    <section>
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Top 3 recommended edits</h2>
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
        <Results {...props} stored={stored} onRegenerate={regenerate} />
      ) : (
        <div className="mt-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Ally drafts up to three rewrites (title, bullets or description), ranked by compliance impact and competitive value. Every
            draft is checked against the same guideline rules before you see it.
          </p>
          <Button className="mt-4" onClick={() => generate(sku)}>Generate recommendations</Button>
        </div>
      )}

      {(stored || job?.status === "error") && (
        <div className="mt-8 border-t border-border pt-3">
          <button type="button" onClick={() => setHoodOpen(true)} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
            Under the hood
          </button>
        </div>
      )}
      <UnderTheHood open={hoodOpen} onOpenChange={setHoodOpen} stored={stored} job={job} items={items} />
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
  stored, sku, allSkus, findings, items, isDismissed, onDismiss, onOpenRule, onPeek, onShowFixes, onRegenerate,
}: Props & { stored: StoredResult; onRegenerate: () => void }) {
  const { result, failures } = stored;
  const { setDecision, markFinished } = useReview();
  const navigate = useNavigate();
  const [approveOpen, setApproveOpen] = useState(false);
  const byId = new Map(findings.map((f) => [f.id, f]));
  const skuById = new Map(allSkus.map((s) => [s.sku_id, s]));
  const banner = failures.filter((f) => f.edit_rank == null || !result.top_edits.some((e) => e.rank === f.edit_rank));

  const active = findings.filter((f) => !isDismissed(f.id)).map((f) => f.id).sort();
  const findingsChanged = !!stored.activeFindingIds && JSON.stringify(active) !== JSON.stringify(stored.activeFindingIds);

  const evaluated = items.map((it) => ({ it, ev: evaluateItem(it, sku, allSkus) }));
  const pending = evaluated.filter(({ it }) => !isDecided(it.decision?.state));
  const approvable = pending.filter(({ ev }) => ev.tier !== "blocked");

  const save = (it: Item, patch: SavePatch | "undo") => {
    const base: Decision = it.decision ?? {
      state: "pending", version: "full", resultAt: it.resultAt, facts: [], edit: it.edit, score: it.score, failures: it.failures,
    };
    const next: Decision =
      patch === "undo"
        ? { ...base, state: "pending", finalText: undefined, edited: false, facts: [], overrideReason: undefined, overrideIssues: undefined, rejectReason: undefined, decidedAt: undefined }
        : { ...base, ...patch };
    setDecision(sku.sku_id, it.edit.field, next);
  };

  const approveAll = () => {
    approvable.forEach(({ it, ev }) => save(it, { state: "accepted", finalText: ev.text, edited: ev.edited, decidedAt: new Date().toISOString() }));
    const skipped = pending.length - approvable.length;
    toast.success(`${approvable.length} edit${approvable.length === 1 ? "" : "s"} accepted${skipped ? ` · ${skipped} need${skipped === 1 ? "s" : ""} confirmation` : ""}`);
    setApproveOpen(false);
  };

  const finish = () => {
    if (pending.length && !window.confirm(`Finish with ${pending.length} pending? Pending edits will be listed as not reviewed in the summary.`)) return;
    markFinished(sku.sku_id);
    navigate({ to: "/skus/$skuId/summary", params: { skuId: sku.sku_id } });
  };

  return (
    <div className="mt-3 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Generated {formatDistanceToNow(new Date(stored.generatedAt), { addSuffix: true })} · prompt {stored.promptVersion} ·{" "}
          <button type="button" onClick={onRegenerate} className="font-medium text-primary hover:underline">Regenerate</button>
        </p>
        {items.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={approvable.length ? -1 : 0}>
                <Button size="sm" disabled={!approvable.length} onClick={() => setApproveOpen(true)}>
                  <CheckCheck />Approve all {pending.length}
                </Button>
              </span>
            </TooltipTrigger>
            {!approvable.length && (
              <TooltipContent>{pending.length ? "No pending edit is Safe or Review — blocked edits need editing first." : "Every edit already has a decision."}</TooltipContent>
            )}
          </Tooltip>
        )}
      </div>

      {findingsChanged && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <p className="flex-1 text-sm font-medium text-warning">Findings changed since these recommendations were generated.</p>
          <Button size="sm" variant="outline" onClick={onRegenerate}>Regenerate</Button>
        </div>
      )}

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

      {items.length === 0 ? (
        <div className="rounded-lg border border-success/30 bg-success-soft p-5 text-sm font-medium text-success">
          No changes recommended. This listing meets the guidelines and compares well with its competitors.
        </div>
      ) : (
        <ol className="space-y-5">
          {items.map((it) => (
            <EditCard key={`${it.edit.field}-${it.resultAt}`} item={it} sku={sku} allSkus={allSkus} skuById={skuById}
              onSave={(p) => save(it, p)} onOpenRule={onOpenRule} onPeek={onPeek} onShowFixes={onShowFixes} />
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

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button onClick={finish} variant={pending.length && items.length ? "outline" : "default"}>
          <Flag />{pending.length && items.length ? `Finish with ${pending.length} pending` : "Finish review"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {items.length === 0 ? "Nothing to approve — the summary will say no changes were recommended." : `${items.length - pending.length} of ${items.length} edits decided.`}
        </p>
      </div>

      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve all pending edits?</AlertDialogTitle>
            <AlertDialogDescription>Safe and Review edits are accepted exactly as shown, in their selected version. Blocked edits are skipped.</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2 text-sm">
            {pending.map(({ it, ev }) => (
              <li key={it.edit.field} className="rounded-md border border-border p-2">
                <p className="font-medium text-foreground">
                  #{it.edit.rank} {FIELD_LABEL[it.edit.field]} · {TIER_LABEL[ev.tier]}
                </p>
                <p className="break-words text-muted-foreground">
                  {ev.tier === "blocked"
                    ? `Will be skipped: ${ev.reasons.join(" ")}`
                    : `Will be accepted (${ev.version === "compliance" ? "Compliance-only" : "Full"} version).`}
                </p>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={approveAll}>Accept {approvable.length}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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

function UnderTheHood({ open, onOpenChange, stored, job, items }: { open: boolean; onOpenChange: (o: boolean) => void; stored: StoredResult | undefined; job: JobState | undefined; items: Item[] }) {
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
          {items.some((i) => i.score) && (
            <Block title="Edit ranking scores (computed in code)">
              <ul className="space-y-2 text-xs">
                {items.map((i) => i.score && (
                  <li key={i.edit.field} className="break-words">
                    <span className="font-medium">#{i.edit.rank} {FIELD_LABEL[i.edit.field]}</span>: severity {i.score.severity} + visibility {i.score.visibility} + competitive {i.score.competitive} = <span className="font-semibold">{i.score.total}</span>
                    <span className="block text-muted-foreground">{rankReason(i.edit.rank, i.score)}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
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
