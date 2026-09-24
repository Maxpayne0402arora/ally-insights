import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Ban, CheckCircle2, Info, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  asList, FIELD_LABEL, isDecided, LIMITS, liveCheck, placeholderLabel, placeholdersIn, replacePlaceholder, riskTier,
  sameText, STATE_LABEL, textFor, TIER_LABEL, type Decision, type Fact, type Item, type LiveCheck, type Tier, type Version,
} from "@/lib/review";
import { RANK_FORMULA, rankReason, type FieldText, type GuardFailure } from "@/lib/top3";
import type { Sku } from "@/types/sku";
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
export function withPlaceholders(s: string): ReactNode {
  return s.split(/(\[confirm:[^\]]*\])/gi).map((p, i) =>
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
          <del key={i} className="bg-danger-soft text-danger line-through decoration-danger/70" aria-label={`removed: ${op.s}`}>{op.s}</del>
        ) : (
          <ins key={i} className="bg-success-soft text-success no-underline" aria-label={`added: ${op.s}`}>{withPlaceholders(op.s)}</ins>
        ),
      )}
    </p>
  );
}

type RowStatus = "Added" | "Removed" | "Changed" | "Unchanged";
function bulletRows(current: FieldText, proposed: FieldText) {
  const a = asList(current);
  const b = asList(proposed).filter((s, i, arr) => s.trim() || i < arr.length - 1);
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => {
    const cur = a[i];
    const next = b[i];
    const status: RowStatus = cur === undefined ? "Added" : next === undefined ? "Removed" : cur.trim() === next.trim() ? "Unchanged" : "Changed";
    return { cur, next, status };
  });
}
const rowCls: Record<RowStatus, string> = {
  Added: "bg-success-soft text-success",
  Removed: "bg-danger-soft text-danger",
  Changed: "bg-warning-soft text-warning",
  Unchanged: "bg-secondary text-muted-foreground",
};

/* ---------------------------- small bits ---------------------------- */

function CharCount({ len, limit }: { len: number; limit: number }) {
  const over = len > limit;
  const near = !over && len >= limit * 0.9;
  return (
    <span className={cn("text-xs tabular-nums", over ? "font-medium text-danger" : near ? "font-medium text-warning" : "text-muted-foreground")}>
      {len} / {limit}{over ? " · over limit" : near ? " · near limit" : ""}
    </span>
  );
}

function RuleChip({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => onOpen(id)} className="h-auto px-2 py-0.5 font-mono text-xs text-primary">
      {id}
    </Button>
  );
}

const tierCls: Record<Tier, string> = {
  blocked: "bg-danger-soft text-danger",
  safe: "bg-success-soft text-success",
  review: "bg-warning-soft text-warning",
};
const TierIcon = ({ tier }: { tier: Tier }) =>
  tier === "blocked" ? <ShieldAlert className="h-3.5 w-3.5" /> : tier === "safe" ? <ShieldCheck className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />;

export function TierBadge({ tier, reasons }: { tier: Tier; reasons: string[] }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tierCls[tier])}>
          <TierIcon tier={tier} />
          {TIER_LABEL[tier]}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ul className="space-y-1">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </TooltipContent>
    </Tooltip>
  );
}

function IssueList({ live, onOpenRule }: { live: LiveCheck; onOpenRule: (id: string) => void }) {
  if (!live.count) return <p className="flex items-center gap-1.5 text-sm text-success"><CheckCircle2 className="h-4 w-4" />No high or medium issues.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {live.findings.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold uppercase", f.severity === "high" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>{f.severity}</span>
          <RuleChip id={f.rule_id} onOpen={onOpenRule} />
          <span className="min-w-0 break-words text-foreground">{f.message}{f.evidence ? ` — "${f.evidence}"` : ""}</span>
        </li>
      ))}
      {live.claims.map((c) => (
        <li key={c} className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-danger-soft px-1.5 py-0.5 text-xs font-semibold uppercase text-danger">claim</span>
          <span className="break-words text-foreground">Unsupported claim: '{c}' isn't in the source listing or your confirmed facts.</span>
        </li>
      ))}
      {live.brandMissing && <li className="text-foreground">The title must include the brand name exactly as written.</li>}
    </ul>
  );
}

export const issueStrings = (live: LiveCheck, sku: Sku) => [
  ...live.findings.map((f) => `${f.rule_id}: ${f.message}`),
  ...live.claims.map((c) => `Unsupported claim '${c}'`),
  ...(live.brandMissing ? [`Title missing brand "${sku.brand}"`] : []),
];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ---------------------------- card ---------------------------- */

type View = "proposed" | "changes" | "side";
export type SavePatch = Partial<Omit<Decision, "edit" | "resultAt" | "score" | "failures">>;

type Props = {
  item: Item;
  sku: Sku;
  allSkus: Sku[];
  skuById: Map<string, Sku>;
  onSave: (patch: SavePatch | "undo") => void;
  onOpenRule: (id: string) => void;
  onPeek: (sku: Sku, evidence: string) => void;
  onShowFixes: (rank: number) => void;
};

export function EditCard({ item, sku, allSkus, skuById, onSave, onOpenRule, onPeek, onShowFixes }: Props) {
  const { edit, decision, failures, score } = item;
  const state = decision?.state ?? "pending";
  const version: Version = decision?.version ?? "full";
  const decided = isDecided(state);
  const [view, setView] = useState<View>("proposed");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FieldText>("");
  const [facts, setFacts] = useState<Fact[]>([]);
  const [phValues, setPhValues] = useState<Record<string, string>>({});
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);

  const baseText = decision?.finalText ?? textFor(edit, version);
  const shown = editing ? draft : baseText;
  const versionsDiffer = !sameText(edit.proposed_full, edit.proposed_compliance_only);

  const debouncedDraft = useDebounced(draft, 300);
  const checkText = editing ? debouncedDraft : baseText;
  const checkFacts = editing ? facts : decision?.facts ?? [];
  const live = useMemo(() => liveCheck(edit.field, checkText, sku, allSkus, checkFacts), [edit.field, checkText, sku, allSkus, checkFacts]);
  const edited = editing ? !sameText(draft, textFor(edit, version)) : !!decision?.edited;
  const { tier, reasons } = riskTier({ current: edit.current, text: checkText, live, guardFailures: failures, edited });
  const placeholders = placeholdersIn(shown);

  const startEdit = () => {
    const t = baseText;
    setDraft(edit.field === "bullets" ? (() => { const l = [...asList(t)]; while (l.length < 5) l.push(""); return l; })() : asList(t).join("\n"));
    setFacts(decision?.facts ?? []);
    setPhValues({});
    setOverrideOpen(false);
    setOverrideReason("");
    setEditing(true);
  };
  const cancelEdit = () => {
    if (!sameText(draft, baseText) && !window.confirm("Discard your unsaved changes?")) return;
    setEditing(false);
  };
  const switchVersion = (v: Version) => {
    if (v === version) return;
    if (editing) {
      if (!sameText(draft, baseText) && !window.confirm("Edits apply to the currently selected version only. Switching discards your unsaved edits. Continue?")) return;
      const t = textFor(edit, v);
      setDraft(edit.field === "bullets" ? (() => { const l = [...asList(t)]; while (l.length < 5) l.push(""); return l; })() : asList(t).join("\n"));
      setFacts([]);
    }
    onSave({ version: v, finalText: undefined, edited: false, facts: [] });
  };

  const cleaned = (): FieldText => (edit.field === "bullets" ? asList(draft).map((b) => b.trim()).filter(Boolean) : asList(draft).join("\n").trim());
  const now = () => new Date().toISOString();
  const saveAccept = () => {
    const t = cleaned();
    if (sameText(t, edit.current)) onSave({ state: "rejected", rejectReason: "Kept original", decidedAt: now() });
    else onSave({ state: "edited", finalText: t, edited: true, facts, decidedAt: now() });
    setEditing(false);
  };
  const acceptOverride = () => {
    const t = cleaned();
    const current = liveCheck(edit.field, t, sku, allSkus, facts);
    onSave({ state: "override", finalText: t, edited: true, facts, overrideReason: overrideReason.trim(), overrideIssues: issueStrings(current, sku), decidedAt: now() });
    setEditing(false);
  };

  const fillPlaceholder = (inner: string, value: string | null) => {
    setDraft((d) => replacePlaceholder(d, inner, value == null ? null : value.trim()));
    setFacts((f) => [...f.filter((x) => x.placeholder !== inner), { placeholder: inner, label: placeholderLabel(inner), value: value?.trim() ?? "", removed: value == null }]);
  };

  // Live values reflect the debounced draft; buttons use the up-to-date draft to avoid acting on stale checks.
  const draftPlaceholders = editing ? placeholdersIn(draft) : [];
  const stale = editing && draft !== debouncedDraft;
  const canSave = editing && !stale && draftPlaceholders.length === 0 && live.count === 0;
  const canOverride = editing && !stale && draftPlaceholders.length === 0 && live.count > 0;
  const fixes = edit.resolves_finding_ids.length;

  return (
    <li className="min-w-0 rounded-lg border border-border p-4 sm:p-5" aria-label={`Edit ${edit.rank}: ${FIELD_LABEL[edit.field]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{edit.rank}</span>
        <h3 className="font-semibold text-foreground">{FIELD_LABEL[edit.field]}</h3>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium",
          state === "rejected" ? "bg-secondary text-muted-foreground" : decided ? "bg-success-soft text-success" : "border border-border text-muted-foreground")}>
          {STATE_LABEL[state]}
        </span>
        {decided && (
          <button type="button" onClick={() => onSave("undo")} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Undo2 className="h-3 w-3" />Undo
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <TierBadge tier={tier} reasons={reasons} />
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", failures.length ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>
            {failures.length ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {failures.length ? "Failed checks" : "Passed guideline checks"}
          </span>
        </div>
      </div>

      <div className="mt-3">
        {score && (
          <p className="break-words text-sm font-medium text-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Ranked #{edit.rank}</button>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p>{RANK_FORMULA}</p>
                <p className="mt-1 font-medium">This edit: {score.severity} + {score.visibility} + {score.competitive} = {score.total}</p>
              </TooltipContent>
            </Tooltip>
            {rankReason(edit.rank, score).replace(/^Ranked #\d+/, "")}
          </p>
        )}
        {edit.why_ranked && <p className="mt-1 break-words text-xs text-muted-foreground">AI: {edit.why_ranked}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <button type="button" onClick={() => onShowFixes(edit.rank)} disabled={!fixes} className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
            Fixes {fixes} finding{fixes === 1 ? "" : "s"}{fixes ? " →" : ""}
          </button>
          {item.previous && <span className="text-muted-foreground">Kept from an earlier generation</span>}
        </div>
      </div>

      {/* view + version switches */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="View" className="inline-flex rounded-md border border-border p-0.5">
          {(["proposed", "changes", "side"] as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={cn("rounded px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {v === "proposed" ? "Proposed" : v === "changes" ? "Changes" : "Side by side"}
            </button>
          ))}
        </div>
        {versionsDiffer && (
          <div role="group" aria-label="Version" className="inline-flex rounded-md border border-border p-0.5">
            {(["full", "compliance"] as Version[]).map((v) => (
              <button key={v} type="button" aria-pressed={version === v} disabled={decided} onClick={() => switchVersion(v)}
                title={decided ? "Undo the decision to switch version" : undefined}
                className={cn("rounded px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60", version === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {v === "full" ? "Full" : "Compliance-only"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* text display or editor */}
      {editing ? (
        <Editor field={edit.field} draft={draft} setDraft={setDraft} />
      ) : (
        <TextView view={view} field={edit.field} current={edit.current} text={shown} />
      )}

      {editing && (
        <div className="mt-4 space-y-4 rounded-md border border-border bg-secondary/40 p-3">
          {draftPlaceholders.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Needs confirmation</p>
              <div className="mt-2 space-y-2">
                {draftPlaceholders.map((inner) => {
                  const id = `ph-${edit.field}-${inner.replace(/\W+/g, "-")}`;
                  return (
                    <div key={inner} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <Label htmlFor={id} className="text-xs">{placeholderLabel(inner)}</Label>
                        <Input id={id} value={phValues[inner] ?? ""} onChange={(e) => setPhValues((p) => ({ ...p, [inner]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter" && (phValues[inner] ?? "").trim()) fillPlaceholder(inner, phValues[inner]!); }} />
                      </div>
                      <Button size="sm" disabled={!(phValues[inner] ?? "").trim()} onClick={() => fillPlaceholder(inner, phValues[inner]!)}>Fill</Button>
                      <Button size="sm" variant="outline" onClick={() => fillPlaceholder(inner, null)}>Remove this detail</Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {facts.some((f) => !f.removed) && (
            <p className="break-words text-xs text-muted-foreground">
              User-confirmed facts: {facts.filter((f) => !f.removed).map((f) => `${f.label}: ${f.value}`).join("; ")}
            </p>
          )}
          <div aria-live="polite">
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Live check</p>
            <IssueList live={live} onOpenRule={onOpenRule} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!canSave} onClick={saveAccept}>Save & accept</Button>
            {canOverride && !overrideOpen && <Button size="sm" variant="outline" onClick={() => setOverrideOpen(true)}>Accept anyway (override)</Button>}
            <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
          </div>
          {draftPlaceholders.length > 0 && <p className="text-xs text-muted-foreground">Fill or remove every placeholder before accepting. Placeholders can't be overridden.</p>}
          {overrideOpen && canOverride && (
            <div className="space-y-2">
              <Label htmlFor={`ov-${edit.field}`} className="text-xs">Reason for override (required)</Label>
              <Input id={`ov-${edit.field}`} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. Legal approved this wording" />
              <Button size="sm" variant="destructive" disabled={!overrideReason.trim()} onClick={acceptOverride}>Accept with override</Button>
            </div>
          )}
        </div>
      )}

      {!editing && (
        <>
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
                        <button key={j} type="button" disabled={!comp} onClick={() => comp && onPeek(comp, r.evidence)}
                          className="mt-1 block max-w-full break-words text-left text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
                          {r.brand || comp?.brand} ({r.sku_id}): '{r.evidence}'
                        </button>
                      );
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {placeholders.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Needs confirmation</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {placeholders.map((p) => <li key={p} className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">[confirm: {p}]</li>)}
              </ul>
            </div>
          )}
          {failures.length > 0 && <FailureList failures={failures} />}
          {decision?.state === "override" && (
            <p className="mt-3 break-words text-xs text-muted-foreground">Override reason: {decision.overrideReason}</p>
          )}
          {decision?.state === "rejected" && (
            <p className="mt-3 break-words text-xs text-muted-foreground">Reject reason: {decision.rejectReason || "No reason given"}</p>
          )}

          {!decided && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              <Button size="sm" disabled={tier === "blocked"} onClick={() => onSave({ state: "accepted", finalText: baseText, edited: false, decidedAt: now() })}
                title={tier === "blocked" ? "Blocked — use Edit to fix it, or Reject" : undefined}>
                <CheckCircle2 />Accept
              </Button>
              <Button size="sm" variant="outline" onClick={startEdit}><Pencil />Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => setRejectOpen(true)}><Ban />Reject</Button>
            </div>
          )}
        </>
      )}

      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} onReject={(reason) => onSave({ state: "rejected", rejectReason: reason, decidedAt: now() })} />
    </li>
  );
}

function FailureList({ failures }: { failures: GuardFailure[] }) {
  return (
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-danger">
      {failures.map((f, i) => <li key={i} className="break-words">{f.detail}</li>)}
    </ul>
  );
}

/* ---------------------------- text views ---------------------------- */

function TextView({ view, field, current, text }: { view: View; field: Item["edit"]["field"]; current: FieldText; text: FieldText }) {
  const limit = field === "title" ? LIMITS.title : LIMITS.description;
  if (field !== "bullets") {
    const cur = asList(current).join("\n");
    const next = asList(text).join("\n");
    return (
      <div className="mt-3 rounded-md border border-border bg-background p-3">
        {view === "proposed" && <p className="whitespace-pre-wrap break-words text-sm leading-6">{withPlaceholders(next)}</p>}
        {view === "changes" && <Diff from={cur} to={next} />}
        {view === "side" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0"><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Current</p><p className="whitespace-pre-wrap break-words text-sm">{cur}</p><CharCount len={cur.length} limit={limit} /></div>
            <div className="min-w-0"><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Proposed</p><p className="whitespace-pre-wrap break-words text-sm">{withPlaceholders(next)}</p></div>
          </div>
        )}
        <div className="mt-2"><CharCount len={next.length} limit={limit} /></div>
      </div>
    );
  }
  const rows = bulletRows(current, text);
  return (
    <div className="mt-3 rounded-md border border-border bg-background p-3">
      {view === "proposed" ? (
        <ol className="space-y-2">
          {asList(text).filter((b) => b.trim()).map((b, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="pt-0.5 text-xs text-muted-foreground">{i + 1}.</span>
              <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words leading-6">{withPlaceholders(b)}</p><CharCount len={b.length} limit={LIMITS.bullet} /></div>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="space-y-3">
          {rows.map((r, i) => (
            <li key={i} className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Bullet {i + 1}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", rowCls[r.status])}>{r.status}</span>
              </div>
              {view === "changes" ? (
                <Diff from={r.cur ?? ""} to={r.next ?? ""} />
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  <p className={cn("whitespace-pre-wrap break-words rounded bg-secondary/50 p-2 text-sm", !r.cur && "italic text-muted-foreground")}>{r.cur ?? "(none)"}</p>
                  <p className={cn("whitespace-pre-wrap break-words rounded bg-secondary/50 p-2 text-sm", !r.next && "italic text-muted-foreground")}>{r.next ? withPlaceholders(r.next) : "(removed)"}</p>
                </div>
              )}
              {r.next !== undefined && <CharCount len={r.next.length} limit={LIMITS.bullet} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Editor({ field, draft, setDraft }: { field: Item["edit"]["field"]; draft: FieldText; setDraft: (t: FieldText) => void }) {
  if (field !== "bullets") {
    const t = asList(draft).join("\n");
    const limit = field === "title" ? LIMITS.title : LIMITS.description;
    return (
      <div className="mt-3">
        <Label htmlFor={`editor-${field}`} className="text-xs">{FIELD_LABEL[field]}</Label>
        <Textarea id={`editor-${field}`} value={t} onChange={(e) => setDraft(e.target.value)} rows={field === "title" ? 3 : 8} className="mt-1 break-words" />
        <CharCount len={t.length} limit={limit} />
      </div>
    );
  }
  const list = asList(draft);
  return (
    <div className="mt-3 space-y-2">
      {list.map((b, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`editor-bullet-${i}`} className="text-xs">Bullet {i + 1}</Label>
            <Input id={`editor-bullet-${i}`} value={b} onChange={(e) => setDraft(list.map((x, j) => (j === i ? e.target.value : x)))} />
            <CharCount len={b.length} limit={LIMITS.bullet} />
          </div>
          <Button type="button" variant="ghost" size="icon" className="mt-5" aria-label={`Remove bullet ${i + 1}`} onClick={() => setDraft(list.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...list, ""])}><Plus />Add bullet</Button>
    </div>
  );
}

/* ---------------------------- reject ---------------------------- */

const REASONS = ["Not accurate", "Doesn't fit our brand voice", "Not needed now", "Other"];

function RejectDialog({ open, onOpenChange, onReject }: { open: boolean; onOpenChange: (o: boolean) => void; onReject: (reason: string) => void }) {
  const [choice, setChoice] = useState("");
  const [other, setOther] = useState("");
  useEffect(() => {
    if (open) { setChoice(""); setOther(""); }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this edit?</DialogTitle>
          <DialogDescription>Optionally tell us why. The reason appears in the summary.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={choice} onValueChange={setChoice} className="space-y-1">
          {REASONS.map((r) => (
            <div key={r} className="flex items-center gap-2">
              <RadioGroupItem id={`rej-${r}`} value={r} />
              <Label htmlFor={`rej-${r}`}>{r}</Label>
            </div>
          ))}
        </RadioGroup>
        {choice === "Other" && <Input aria-label="Other reason" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Your reason" />}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { onReject(choice === "Other" ? other.trim() || "Other" : choice); onOpenChange(false); }}>Reject</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { TooltipProvider };
