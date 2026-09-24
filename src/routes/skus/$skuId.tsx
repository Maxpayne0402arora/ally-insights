import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import { RecommendedEdits, findingStatuses } from "@/components/RecommendedEdits";
import { useGeneration } from "@/context/GenerationContext";
import { useSkuReview } from "@/context/ReviewContext";
import { StepIndicator } from "@/components/StepIndicator";
import { RoleBadge, ScoreBadge } from "@/components/ScoreBadge";
import { Button } from "@/components/ui/button";
import { useSkuData } from "@/context/SkuDataContext";
import {
  auditSku,
  complianceScore,
  hasBulletHeader,
  bulletClarity,
  BULLET_CLARITY_TIP,
  hasIdentifier,
  severityCounts,
} from "@/lib/rules";
import { isAccepted } from "@/lib/review";
import type { Finding, Sku } from "@/types/sku";
import { cn } from "@/lib/utils";
import { ListingContent } from "@/components/ListingContent";
import { CompetitorDrawer } from "@/components/CompetitorDrawer";
import { useRuleDrawer } from "@/context/RuleDrawerContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

type Tab = "recommendations" | "findings" | "comparison";
type Search = { tab?: Tab | undefined; fix?: number | undefined };

export const Route = createFileRoute("/skus/$skuId")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const t = s["tab"];
    const f = s["fix"];
    const tab = t === "findings" || t === "comparison" ? t : undefined;
    const raw = typeof f === "number" ? f : typeof f === "string" && /^\d+$/.test(f) ? Number(f) : undefined;
    return { ...(tab ? { tab } : {}), ...(tab === "findings" && raw ? { fix: raw } : {}) };
  },
  head: () => ({
    meta: [
      { title: "Review & approve listing edits · Ally" },
      {
        name: "description",
        content:
          "Review AI-recommended, guideline-checked edits for this listing, compare competitors and approve changes.",
      },
      { property: "og:title", content: "Review & approve listing edits · Ally" },
      {
        property: "og:description",
        content:
          "Review AI-recommended, guideline-checked edits for this listing, compare competitors and approve changes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportPage,
});

type Tone = "good" | "warn" | "bad" | "neutral";

const toneCls: Record<Tone, string> = {
  good: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  bad: "bg-danger-soft text-danger",
  neutral: "",
};

const avg = (ns: number[]) =>
  ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0;

function ReportPage() {
  const { skuId } = Route.useParams();
  const search = Route.useSearch();
  const tab: Tab = search.tab ?? "recommendations";
  const { skus, hasData, hydrated, isDismissed, dismissFinding, restoreFinding } = useSkuData();
  const { cacheKeyFor, jobs, generate, cancelled } = useGeneration();
  const navigate = useNavigate();
  const { openRule } = useRuleDrawer();
  const [peek, setPeek] = useState<{ sku: Sku; evidence?: string } | null>(null);
  const setPeekSku = (s: Sku | null) => setPeek(s ? { sku: s } : null);

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

  const sku = skus.find((s) => s.sku_id === skuId);
  const { stored, items } = useSkuReview(sku?.sku_id);
  const key = sku ? cacheKeyFor(sku.sku_id) : "";
  const job = key ? jobs[key] : undefined;

  // Auto-generate after the user stays on this SKU for 2 seconds (never after a cancel in this session).
  const skuRef = sku;
  useEffect(() => {
    if (!hydrated || !skuRef || stored || job || cancelled.has(key)) return;
    const t = setTimeout(() => generate(skuRef), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, key, !!stored, !!job, cancelled]);

  const findings = useMemo(
    () => (sku ? auditSku(sku, skus) : []),
    [sku, skus],
  );

  const peers = useMemo(
    () =>
      sku
        ? skus.filter(
            (s) =>
              s.competitor_group === sku.competitor_group &&
              s.sku_id !== sku.sku_id,
          )
        : [],
    [sku, skus],
  );

  const groupedSkus = useMemo(() => {
    const map = new Map<string, Sku[]>();
    skus.forEach((item) => map.set(item.competitor_group, [...(map.get(item.competitor_group) ?? []), item]));
    return Array.from(map.entries());
  }, [skus]);

  if (!hydrated) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;

  if (!sku) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="font-medium text-foreground">SKU not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          "{skuId}" isn't in the loaded dataset.
        </p>
        <Link
          to="/skus"
          className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
        >
          ← Back to SKUs
        </Link>
      </div>
    );
  }

  const score = complianceScore(findings);
  const statuses = findingStatuses(stored, items);
  const currentGroup = skus.filter((item) => item.competitor_group === sku.competitor_group);
  const currentIndex = currentGroup.findIndex((item) => item.sku_id === sku.sku_id);
  const previous = currentIndex > 0 ? currentGroup[currentIndex - 1] : undefined;
  const next = currentIndex < currentGroup.length - 1 ? currentGroup[currentIndex + 1] : undefined;
  const goToSku = (nextSkuId: string) =>
    navigate({ to: "/skus/$skuId", params: { skuId: nextSkuId }, search: tab === "recommendations" ? {} : { tab } });
  const setTab = (t: string) =>
    navigate({ to: "/skus/$skuId", params: { skuId: sku.sku_id }, search: t === "recommendations" ? {} : { tab: t as Tab } });
  const showFixes = (rank: number) =>
    navigate({ to: "/skus/$skuId", params: { skuId: sku.sku_id }, search: { tab: "findings", fix: rank } });
  const columns: Sku[] = [sku, ...peers];

  const highCount = findings.filter((f) => f.severity === "high").length;
  const acceptedCount = items.filter((i) => isAccepted(i.decision?.state)).length;
  const summaryLine = [
    `${highCount} high-risk issue${highCount === 1 ? "" : "s"}`,
    job?.status === "running"
      ? "generating recommendations…"
      : stored
        ? `${items.length} edit${items.length === 1 ? "" : "s"} recommended · ${acceptedCount} accepted`
        : "recommendations not generated yet",
  ].join(" · ");

  const fixItem = search.fix ? items.find((i) => i.edit.rank === search.fix) : undefined;
  const fixIds = fixItem ? new Set(fixItem.edit.resolves_finding_ids) : null;
  const shownFindings = fixIds ? findings.filter((f) => fixIds.has(f.id)) : findings;

  const metrics = columns.map((s) => {
    const f = auditSku(s, skus);
    const counts = severityCounts(f);
    const bulletLens = s.bullets.map((b) => b.length);
    return {
      sku: s,
      titleLen: s.title.length,
      identifier: hasIdentifier(s.title),
      bullets: s.bullets.length,
      avgBullet: avg(bulletLens),
      headers: s.bullets.filter(hasBulletHeader).length,
      clear: s.bullets.filter((b) => bulletClarity(b).label === "Clear").length,
      descLen: s.description.length,
      images: s.image_urls.length,
      counts,
    };
  });

  const best = {
    avgBullet: Math.max(...metrics.map((m) => m.avgBullet)),
    headers: Math.max(...metrics.map((m) => m.headers)),
    descLen: Math.max(...metrics.map((m) => m.descLen)),
    clear: Math.max(...metrics.map((m) => m.clear)),
  };

  type Row = {
    label: string;
    tip?: string;
    cells: { value: string; tone: Tone }[];
  };

  const rows: Row[] = [
    {
      label: "Title length (chars)",
      cells: metrics.map((m) => ({
        value: `${m.titleLen}${m.titleLen >= 80 && m.titleLen <= 150 ? " · in range" : " · outside 80–150"}`,
        tone: m.titleLen >= 80 && m.titleLen <= 150 ? "good" : m.titleLen > 200 ? "bad" : "warn",
      })),
    },
    {
      label: "Size / count / flavor / color identifier",
      cells: metrics.map((m) => ({ value: m.identifier ? "Yes" : "Missing", tone: m.identifier ? "good" : "bad" })),
    },
    {
      label: "Bullets (of 5)",
      cells: metrics.map((m) => ({ value: `${m.bullets} of 5`, tone: m.bullets === 5 ? "good" : m.bullets >= 3 ? "warn" : "bad" })),
    },
    {
      label: "Avg bullet length (chars)",
      cells: metrics.map((m) => ({
        value: `${m.avgBullet}`,
        tone: m.avgBullet >= 90 && m.avgBullet <= 255 ? "good" : m.avgBullet === best.avgBullet ? "warn" : "bad",
      })),
    },
    {
      label: 'Bullets using "HEADER:" format',
      cells: metrics.map((m) => ({
        value: `${m.headers} of ${m.bullets || 0}`,
        tone: m.bullets > 0 && m.headers === m.bullets ? "good" : m.headers > 0 ? "warn" : "bad",
      })),
    },
    {
      label: "Description length (chars)",
      cells: metrics.map((m) => ({
        value: `${m.descLen}`,
        tone: m.descLen === 0 ? "bad" : m.descLen > 2000 ? "warn" : m.descLen >= best.descLen * 0.7 ? "good" : "warn",
      })),
    },
    {
      label: "Images (5–7 is best practice)",
      cells: metrics.map((m) => ({ value: `${m.images}`, tone: m.images >= 5 ? "good" : m.images === 0 ? "bad" : "warn" })),
    },
    {
      label: "Rule findings (high / medium / low)",
      cells: metrics.map((m) => ({
        value: `${m.counts.high} / ${m.counts.medium} / ${m.counts.low}`,
        tone: m.counts.high > 0 ? "bad" : m.counts.medium > 0 ? "warn" : "good",
      })),
    },
  ];

  const byField = new Map<string, Finding[]>();
  shownFindings.forEach((f) => {
    const list = byField.get(f.field) ?? [];
    list.push(f);
    byField.set(f.field, list);
  });

  const sevCls: Record<string, string> = {
    high: "bg-danger-soft text-danger",
    medium: "bg-warning-soft text-warning",
    low: "bg-secondary text-muted-foreground",
  };

  return (
    <TooltipProvider delayDuration={250}>
    <div>
      <StepIndicator current={3} />

      <Tabs value={tab} onValueChange={setTab}>
      <div className="sticky top-16 z-30 -mx-4 border-b border-border bg-background/95 px-4 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/">Load data</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/skus">SKUs</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{sku.brand}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-foreground">{sku.brand}</h1>
              <RoleBadge isClient={sku.is_client} />
              <span className="font-mono text-xs text-muted-foreground">{sku.sku_id}</span>
              <ScoreBadge score={score} />
            </div>
            <p className="mt-0.5 truncate text-sm text-foreground" title={sku.title}>{sku.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{summaryLine}</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Select value={sku.sku_id} onValueChange={goToSku}>
              <SelectTrigger className="min-w-0 flex-1 sm:w-64" aria-label="Switch SKU"><SelectValue /></SelectTrigger>
              <SelectContent>
                {groupedSkus.map(([group, list]) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {list.map((item) => <SelectItem key={item.sku_id} value={item.sku_id}>{item.brand} · {item.sku_id}</SelectItem>)}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" disabled={!previous} onClick={() => previous && goToSku(previous.sku_id)} aria-label="Previous SKU in group"><ChevronLeft /></Button>
            <Button variant="outline" size="icon" disabled={!next} onClick={() => next && goToSku(next.sku_id)} aria-label="Next SKU in group"><ChevronRight /></Button>
          </div>
        </div>

        <TabsList className="mt-3 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
          <TabsTrigger value="findings">Findings ({findings.length})</TabsTrigger>
          <TabsTrigger value="comparison">Comparison</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="recommendations" className="mt-6">
        <RecommendedEdits
          sku={sku}
          allSkus={skus}
          findings={findings}
          items={items}
          isDismissed={(id) => isDismissed(sku.sku_id, id)}
          onDismiss={(id) => dismissFinding(sku.sku_id, id)}
          onOpenRule={openRule}
          onPeek={(s, evidence) => setPeek({ sku: s, evidence })}
          onShowFixes={showFixes}
        />
      </TabsContent>

      <TabsContent value="findings" className="mt-6">
      <section className="border-b border-border pb-8">
        <ListingContent sku={sku} allSkus={skus} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">
          Findings ({findings.length})
        </h2>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Info className="h-4 w-4" /> Images are checked by count only; image
          content isn't analysed.
        </p>
        {fixItem && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
            Showing {shownFindings.length} finding{shownFindings.length === 1 ? "" : "s"} fixed by edit #{fixItem.edit.rank}
            <span aria-hidden>·</span>
            <button type="button" onClick={() => setTab("findings")} className="inline-flex items-center gap-1 font-medium hover:underline">
              Clear <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {shownFindings.length === 0 ? (
          <div className="mt-4 rounded-lg border border-success/30 bg-success-soft p-6 text-sm font-medium text-success">
            No guideline issues found
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {Array.from(byField.entries()).map(([field, list]) => (
              <div key={field}>
                <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  {field}
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {list.map((f) => (
                    <li key={f.id} className={cn("flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap", isDismissed(sku.sku_id, f.id) && "opacity-60")}>
                      <button
                        type="button"
                        onClick={() => {
                          const target = document.querySelector<HTMLElement>(`[data-finding-ids~="${f.id}"]`)
                            ?? document.getElementById(`listing-field-${f.field}`)
                            ?? (f.field.startsWith("bullet_") ? document.getElementById("listing-field-bullets") : null);
                          target?.scrollIntoView({ behavior: "smooth", block: "center" });
                          target?.animate([{ outline: "3px solid currentColor" }, { outline: "0 solid transparent" }], { duration: 1400 });
                          target?.focus({ preventScroll: true });
                        }}
                        className="flex min-w-0 flex-1 gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                      <span
                        className={cn(
                          "mt-0.5 h-fit rounded-md px-2 py-0.5 text-xs font-semibold uppercase",
                          sevCls[f.severity],
                        )}
                      >
                        {f.severity}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{f.message}</p>
                        {(isDismissed(sku.sku_id, f.id) || statuses.get(f.id)) && (
                          <span className={cn("mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium",
                            isDismissed(sku.sku_id, f.id) ? "bg-secondary text-muted-foreground"
                              : statuses.get(f.id)?.startsWith("Fixed") ? "bg-success-soft text-success"
                              : statuses.get(f.id)?.startsWith("AI") ? "bg-primary/10 text-primary" : "bg-warning-soft text-warning")}>
                            {isDismissed(sku.sku_id, f.id) ? "Dismissed as not an issue" : statuses.get(f.id)}
                          </span>
                        )}
                        {f.evidence && (
                          <p className="mt-1 break-words rounded bg-secondary px-2 py-1 font-mono text-xs text-muted-foreground">
                            {f.evidence}
                          </p>
                        )}
                      </div>
                      </button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openRule(f.rule_id)}
                        className="h-auto shrink-0 px-2 py-1 font-mono text-xs text-primary"
                      >
                        {f.rule_id}
                      </Button>
                      {isDismissed(sku.sku_id, f.id) && (
                        <Button type="button" variant="ghost" size="sm" className="h-auto shrink-0 px-2 py-1 text-xs" onClick={() => restoreFinding(sku.sku_id, f.id)}>Undo</Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      </TabsContent>

      <TabsContent value="comparison" className="mt-6">
      {peers.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          No competitors in this group. Showing a guidelines-only audit.
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">
                  Metric
                </th>
                {columns.map((c, i) => (
                  <th key={c.sku_id} className={cn("px-4 py-3 font-medium", i === 0 ? "bg-primary/10 text-primary" : "text-foreground")}> 
                    {i === 0 ? (
                      <><span>{c.brand}</span><span className="block font-mono text-xs font-normal opacity-70">{c.sku_id}</span></>
                    ) : (
                      <button type="button" onClick={() => setPeekSku(c)} className="min-h-11 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`View ${c.brand} listing`}>
                        {c.brand}<span className="block font-mono text-xs font-normal opacity-70">{c.sku_id}</span>
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-muted-foreground">{row.label}</td>
                  {row.cells.map((cell, i) => (
                    <td
                      key={`${row.label}-${columns[i]?.sku_id}`}
                      className={cn("px-4 py-3", i === 0 && "bg-primary/5")}
                    >
                      <span
                        className={cn(
                          "inline-block rounded-md px-2 py-1 text-xs font-medium",
                          toneCls[cell.tone],
                        )}
                      >
                        {cell.value}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      </TabsContent>
      </Tabs>

      <CompetitorDrawer sku={peek?.sku ?? null} evidence={peek?.evidence} allSkus={skus} onClose={() => setPeek(null)} />
    </div>
    </TooltipProvider>
  );
}
