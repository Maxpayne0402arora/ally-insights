import { useMemo, type ReactNode } from "react";
import { auditSku, bulletClarity, BULLET_CLARITY_TIP } from "@/lib/rules";
import type { Finding, Severity, Sku } from "@/types/sku";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const severityClass: Record<Severity, string> = {
  high: "bg-danger-soft text-danger ring-danger/30",
  medium: "bg-warning-soft text-warning ring-warning/30",
  low: "bg-secondary text-muted-foreground ring-border",
};

const weight: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
type Segment = { start: number; end: number; severity: Severity; findings: Finding[] };

/** Build highlight segments in one pass, always slicing from the original text. */
export function buildSegments(text: string, findings: Finding[]): Segment[] {
  const ranges = findings
    .flatMap((finding) => (finding.ranges ?? []).map((r) => ({ ...r, finding })))
    .filter((r) => r.start >= 0 && r.end <= text.length && r.end > r.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Segment[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && (r.start <= last.end || /^[ \t]+$/.test(text.slice(last.end, r.start)))) {
      last.end = Math.max(last.end, r.end);
      if (weight[r.finding.severity] > weight[last.severity]) last.severity = r.finding.severity;
      if (!last.findings.includes(r.finding)) last.findings.push(r.finding);
    } else {
      merged.push({ start: r.start, end: r.end, severity: r.finding.severity, findings: [r.finding] });
    }
  }
  return merged;
}

function highlightedText(text: string, findings: Finding[]): ReactNode {
  if (!text) return <span className="italic text-muted-foreground">Not provided</span>;
  const segments = buildSegments(text, findings);
  if (!segments.length) return text;

  const plain: string[] = [];
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const seg of segments) {
    if (seg.start > cursor) {
      const chunk = text.slice(cursor, seg.start);
      plain.push(chunk);
      nodes.push(chunk);
    }
    const chunk = text.slice(seg.start, seg.end);
    plain.push(chunk);
    nodes.push(
      <Tooltip key={`seg-${seg.start}`}>
        <TooltipTrigger asChild>
          <mark
            data-finding-ids={seg.findings.map((f) => f.id).join(" ")}
            tabIndex={0}
            data-evidence={seg.findings.some((f) => f.id === EVIDENCE_ID) ? "true" : undefined}
            className={cn(
              "rounded-sm px-0.5 ring-1 transition",
              seg.findings.some((f) => f.id === EVIDENCE_ID) ? "bg-primary/15 text-primary ring-primary/40" : severityClass[seg.severity],
            )}
          >
            {chunk}
          </mark>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1">
          {seg.findings.map((f) => (
            <p key={f.id}>
              <span className="font-mono">{f.rule_id}</span> · {f.message}
            </p>
          ))}
        </TooltipContent>
      </Tooltip>,
    );
    cursor = seg.end;
  }
  if (cursor < text.length) {
    plain.push(text.slice(cursor));
    nodes.push(text.slice(cursor));
  }
  if (plain.join("") !== text) {
    if (import.meta.env.DEV) console.error("[ListingContent] highlight segments do not reproduce the original text; rendering without highlights.");
    return text;
  }
  return nodes;
}

const EVIDENCE_ID = "__evidence__";

function evidenceFinding(text: string, evidence?: string): Finding[] {
  if (!evidence) return [];
  const hay = text.toLowerCase();
  const needle = evidence.toLowerCase();
  const ranges = [];
  for (let i = hay.indexOf(needle); i >= 0 && needle; i = hay.indexOf(needle, i + needle.length)) ranges.push({ start: i, end: i + needle.length });
  return ranges.length
    ? [{ id: EVIDENCE_ID, rule_id: "Evidence", field: "", severity: "low", message: "Quoted by the AI as competitor evidence", evidence, ranges }]
    : [];
}

export function ListingContent({ sku, allSkus, showHeading = true, evidence }: { sku: Sku; allSkus: Sku[]; showHeading?: boolean; evidence?: string | undefined }) {
  const findings = useMemo(() => auditSku(sku, allSkus), [sku, allSkus]);
  const fieldText = (field: string) =>
    field === "title" ? sku.title : field === "description" ? sku.description : (sku.bullets[Number(field.split("_")[1]) - 1] ?? "");
  const fieldFindings = (field: string) => [
    ...findings.filter((finding) => finding.field === field),
    ...evidenceFinding(fieldText(field), evidence),
  ];

  return (
    <TooltipProvider delayDuration={250}>
      <div className="space-y-6">
        {showHeading && <h2 className="text-lg font-semibold text-foreground">Current listing</h2>}
        <div id="listing-field-title" className="scroll-mt-24">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Title</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{highlightedText(sku.title, fieldFindings("title"))}</p>
        </div>
        <div id="listing-field-bullets" className="scroll-mt-24">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Bullets</h3>
          {sku.bullets.length ? (
            <ol className="mt-2 space-y-3">
              {sku.bullets.map((bullet, index) => {
                const clarity = bulletClarity(bullet);
                return (
                <li id={`listing-field-bullet_${index + 1}`} key={`${sku.sku_id}-bullet-${index}`} className="scroll-mt-24 flex gap-3 text-sm leading-6 text-foreground">
                  <span className="text-muted-foreground">{index + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          className={cn(
                            "mb-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                            clarity.label === "Clear" ? "bg-success-soft text-success"
                              : clarity.label === "Feature-only" ? "bg-secondary text-muted-foreground"
                              : "bg-warning-soft text-warning",
                          )}
                        >
                          {clarity.label}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>{clarity.reason}</p>
                        <p className="mt-1 text-muted-foreground">{BULLET_CLARITY_TIP}</p>
                      </TooltipContent>
                    </Tooltip>
                    <span className="block">{highlightedText(bullet, fieldFindings(`bullet_${index + 1}`))}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="mt-2 text-sm italic text-muted-foreground">No bullets provided</p>}
        </div>
        <div id="listing-field-description" className="scroll-mt-24">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Description</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{highlightedText(sku.description, fieldFindings("description"))}</p>
        </div>
        <div id="listing-field-images" className="scroll-mt-24">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Images</h3>
          <p className="mt-2 text-sm text-foreground">{sku.image_urls.length} image{sku.image_urls.length === 1 ? "" : "s"}</p>
        </div>
      </div>
    </TooltipProvider>
  );
}