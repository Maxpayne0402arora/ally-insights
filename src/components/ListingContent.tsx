import { useMemo, type ReactNode } from "react";
import { auditSku } from "@/lib/rules";
import type { Finding, Severity, Sku } from "@/types/sku";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const severityClass: Record<Severity, string> = {
  high: "bg-danger-soft text-danger ring-danger/30",
  medium: "bg-warning-soft text-warning ring-warning/30",
  low: "bg-secondary text-muted-foreground ring-border",
};

function highlightedText(text: string, findings: Finding[]): ReactNode {
  const matches = findings
    .filter((finding) => finding.evidence && finding.evidence.length < text.length)
    .flatMap((finding) => {
      const ranges: { start: number; end: number; finding: Finding }[] = [];
      const source = text.toLowerCase();
      const evidence = finding.evidence.toLowerCase();
      let start = source.indexOf(evidence);
      while (start >= 0) {
        ranges.push({ start, end: start + evidence.length, finding });
        start = source.indexOf(evidence, start + Math.max(1, evidence.length));
      }
      return ranges;
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const accepted: typeof matches = [];
  matches.forEach((match) => {
    if (!accepted.some((current) => match.start < current.end && match.end > current.start)) accepted.push(match);
  });
  if (!accepted.length) return text || <span className="italic text-muted-foreground">Not provided</span>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  accepted.forEach((match) => {
    if (match.start > cursor) nodes.push(text.slice(cursor, match.start));
    nodes.push(
      <Tooltip key={`${match.finding.id}-${match.start}`}>
        <TooltipTrigger asChild>
          <mark
            id={`evidence-${match.finding.id}`}
            tabIndex={0}
            className={cn("rounded-sm px-0.5 ring-1 transition", severityClass[match.finding.severity])}
          >
            {text.slice(match.start, match.end)}
          </mark>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <span className="font-mono">{match.finding.rule_id}</span> · {match.finding.message}
        </TooltipContent>
      </Tooltip>,
    );
    cursor = match.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function ListingContent({ sku, allSkus, showHeading = true }: { sku: Sku; allSkus: Sku[]; showHeading?: boolean }) {
  const findings = useMemo(() => auditSku(sku, allSkus), [sku, allSkus]);
  const fieldFindings = (field: string) => findings.filter((finding) => finding.field === field);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="space-y-6">
        {showHeading && <h2 className="text-lg font-semibold text-foreground">Current listing</h2>}
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Title</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{highlightedText(sku.title, fieldFindings("title"))}</p>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Bullets</h3>
          {sku.bullets.length ? (
            <ol className="mt-2 space-y-3">
              {sku.bullets.map((bullet, index) => (
                <li key={`${sku.sku_id}-bullet-${index}`} className="flex gap-3 text-sm leading-6 text-foreground">
                  <span className="text-muted-foreground">{index + 1}.</span>
                  <span>{highlightedText(bullet, fieldFindings(`bullet_${index + 1}`))}</span>
                </li>
              ))}
            </ol>
          ) : <p className="mt-2 text-sm italic text-muted-foreground">No bullets provided</p>}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Description</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{highlightedText(sku.description, fieldFindings("description"))}</p>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Images</h3>
          <p className="mt-2 text-sm text-foreground">{sku.image_urls.length} image{sku.image_urls.length === 1 ? "" : "s"}</p>
        </div>
      </div>
    </TooltipProvider>
  );
}