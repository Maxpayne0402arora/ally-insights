import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { StepIndicator } from "@/components/StepIndicator";
import { RoleBadge, ScoreBadge } from "@/components/ScoreBadge";
import { useSkuData } from "@/context/SkuDataContext";
import { auditSku, complianceScore } from "@/lib/rules";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

export const Route = createFileRoute("/skus/")({
  head: () => ({
    meta: [
      { title: "Select a SKU · Ally" },
      {
        name: "description",
        content:
          "Pick a listing from your loaded dataset to audit against its competitor group.",
      },
      { property: "og:title", content: "Select a SKU · Ally" },
      {
        property: "og:description",
        content:
          "Pick a listing from your loaded dataset to audit against its competitor group.",
      },
    ],
  }),
  component: SelectSkuPage,
});

const truncate = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);

function SelectSkuPage() {
  const { skus, fileName, hasData, hydrated } = useSkuData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [clientsOnly, setClientsOnly] = useState(false);
  const [sort, setSort] = useState<"score" | "brand">("score");

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

  const groups = useMemo(() => {
    const map = new Map<string, typeof skus>();
    const needle = query.trim().toLowerCase();
    const filtered = skus
      .filter((s) => !clientsOnly || s.is_client)
      .filter((s) => !needle || `${s.brand} ${s.sku_id} ${s.title}`.toLowerCase().includes(needle))
      .map((s) => ({ sku: s, score: complianceScore(auditSku(s, skus)) }))
      .sort((a, b) => sort === "brand"
        ? a.sku.brand.localeCompare(b.sku.brand)
        : a.score - b.score || a.sku.brand.localeCompare(b.sku.brand));
    filtered.forEach(({ sku: s }) => {
      const list = map.get(s.competitor_group) ?? [];
      list.push(s);
      map.set(s.competitor_group, list);
    });
    return Array.from(map.entries());
  }, [clientsOnly, query, skus, sort]);

  if (!hydrated) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  }

  if (!hasData) {
    return (
      <p className="text-sm text-muted-foreground">
        Load product data to get started.{" "}
        <Link to="/" className="text-primary hover:underline">
          Go to Load data
        </Link>
      </p>
    );
  }

  return (
    <div>
      <StepIndicator current={2} />

      <Breadcrumb className="mb-5">
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/">Load data</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>SKUs</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mb-8 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-3 text-sm text-muted-foreground">
        <span>
          Showing data from{" "}
          <span className="font-medium text-foreground">{fileName}</span> ·{" "}
          {skus.length} SKUs
        </span>
        <span>·</span>
        <Link to="/" className="font-medium text-primary hover:underline">
          Change data
        </Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Select a SKU
      </h1>
      <p className="mt-2 text-muted-foreground">
        Pick any listing — yours or a competitor's — to see its gaps and
        violations.
      </p>

      <div className="mt-6 grid gap-3 border-y border-border py-4 md:grid-cols-[minmax(0,1fr)_auto_220px] md:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search brand, SKU or title" aria-label="Search SKUs" className="pl-9" />
        </div>
        <Button
          type="button"
          variant={clientsOnly ? "default" : "outline"}
          aria-pressed={clientsOnly}
          onClick={() => setClientsOnly((value) => !value)}
          className="min-h-11"
        >
          Clients only
        </Button>
        <Select value={sort} onValueChange={(value) => setSort(value as "score" | "brand")}>
          <SelectTrigger aria-label="Sort SKUs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Compliance: low to high</SelectItem>
            <SelectItem value="brand">Brand: A to Z</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-8 space-y-8">
        {groups.map(([group, list]) => (
          <section key={group}>
            <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
              <span className="text-xs font-normal normal-case">
                {list.length} SKU{list.length === 1 ? "" : "s"}
              </span>
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {list.map((s) => {
                const score = complianceScore(auditSku(s, skus));
                return (
                  <Link
                    key={s.sku_id}
                    to="/skus/$skuId"
                    params={{ skuId: s.sku_id }}
                    className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-secondary"
                  >
                    <ScoreBadge score={score} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">
                          {s.brand}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {s.sku_id}
                        </span>
                        <RoleBadge isClient={s.is_client} />
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {truncate(s.title)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <div className="border-y border-border py-12 text-center">
            <p className="font-medium text-foreground">No matching SKUs</p>
            <p className="mt-1 text-sm text-muted-foreground">Try another search or turn off Clients only.</p>
          </div>
        )}
      </div>
    </div>
  );
}
