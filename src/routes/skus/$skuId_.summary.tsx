import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { StepIndicator } from "@/components/StepIndicator";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { useSkuData } from "@/context/SkuDataContext";
import { useSkuReview } from "@/context/ReviewContext";
import { auditSku } from "@/lib/rules";
import { buildSummary, today } from "@/lib/summary";
import { TOP3_EDITS_PROMPT_VERSION } from "@/prompts/top3Edits";
import { cn } from "@/lib/utils";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

export const Route = createFileRoute("/skus/$skuId_/summary")({
  head: () => ({
    meta: [
      { title: "Listing update summary · Ally" },
      { name: "description", content: "Before/after compliance score and a Markdown summary of the approved listing changes." },
      { property: "og:title", content: "Listing update summary · Ally" },
      { property: "og:description", content: "Before/after compliance score and a Markdown summary of the approved listing changes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SummaryPage,
});

function SummaryPage() {
  const { skuId } = Route.useParams();
  const { skus, hydrated, hasData, fileName, isDismissed } = useSkuData();
  const navigate = useNavigate();
  const sku = skus.find((s) => s.sku_id === skuId);
  const { stored, items } = useSkuReview(sku?.sku_id);
  const [view, setView] = useState<"preview" | "markdown">("preview");

  useEffect(() => {
    if (hydrated && !hasData) {
      try {
        sessionStorage.setItem("ally.notice", "1");
      } catch {
        /* ignore */
      }
      navigate({ to: "/" });
    }
  }, [hydrated, hasData, navigate]);

  const summary = useMemo(() => {
    if (!sku) return null;
    const findings = auditSku(sku, skus);
    return buildSummary({
      sku,
      allSkus: skus,
      fileName,
      model: stored?.model ?? null,
      promptVersion: stored?.promptVersion ?? TOP3_EDITS_PROMPT_VERSION,
      result: stored?.result,
      items,
      findings,
      dismissed: findings.filter((f) => isDismissed(sku.sku_id, f.id)),
      date: today(),
    });
  }, [sku, skus, fileName, stored, items, isDismissed]);

  if (!hydrated) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (!sku || !summary) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="font-medium text-foreground">SKU not found</p>
        <Link to="/skus" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">← Back to SKUs</Link>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary.markdown);
      toast.success("Markdown copied");
    } catch {
      toast.error("Couldn't copy. Use Download instead.");
    }
  };
  const download = () => {
    const blob = new Blob([summary.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ally-summary-${sku.sku_id}-${today()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-w-0">
      <StepIndicator current={3} />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/">Load data</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/skus">SKUs</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/skus/$skuId" params={{ skuId: sku.sku_id }}>{sku.brand}</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Summary</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Listing update summary</h1>
          <p className="mt-1 text-sm text-muted-foreground">{sku.brand} · {sku.sku_id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/skus/$skuId" params={{ skuId: sku.sku_id }}><ArrowLeft />Back to recommendations</Link>
          </Button>
          <Button variant="outline" onClick={copy}><Copy />Copy Markdown</Button>
          <Button onClick={download}><Download />Download .md</Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Compliance score</p>
          <div className="mt-2 flex items-center gap-2 text-lg font-semibold">
            <ScoreBadge score={summary.before} className="px-3 py-1 text-base" />
            <span aria-label="to">→</span>
            <ScoreBadge score={summary.after} className="px-3 py-1 text-base" />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Compliance score {summary.before} → {summary.after}, after applying accepted edits.</p>
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Remaining high / medium findings ({summary.remaining.length})</p>
          {summary.remaining.length === 0 ? (
            <p className="mt-2 text-sm font-medium text-success">None remaining.</p>
          ) : (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
              {summary.remaining.map((f) => (
                <li key={f.id} className="break-words">
                  <span className={cn("mr-2 rounded px-1.5 py-0.5 text-xs font-semibold uppercase", f.severity === "high" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>{f.severity}</span>
                  {f.message} <span className="font-mono text-xs text-muted-foreground">({f.rule_id})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card">
        <div role="group" aria-label="Summary view" className="flex gap-1 border-b border-border p-2">
          {(["preview", "markdown"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={cn("rounded px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {v === "preview" ? "Preview" : "Markdown"}
            </button>
          ))}
        </div>
        <div className="p-5">
          {view === "preview" ? (
            <MarkdownPreview markdown={summary.markdown} />
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{summary.markdown}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
