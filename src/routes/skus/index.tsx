import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { StepIndicator } from "@/components/StepIndicator";
import { RoleBadge, ScoreBadge } from "@/components/ScoreBadge";
import { useSkuData } from "@/context/SkuDataContext";
import { auditSku, complianceScore } from "@/lib/rules";

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
    skus.forEach((s) => {
      const list = map.get(s.competitor_group) ?? [];
      list.push(s);
      map.set(s.competitor_group, list);
    });
    return Array.from(map.entries());
  }, [skus]);

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
      </div>
    </div>
  );
}
