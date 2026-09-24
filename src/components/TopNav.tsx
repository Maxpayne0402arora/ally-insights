import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useSkuData } from "@/context/SkuDataContext";
import { cn } from "@/lib/utils";

export function TopNav() {
  const { hasData } = useSkuData();

  const linkCls =
    "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";
  const activeCls = "bg-secondary text-foreground";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
            Ally <span className="text-muted-foreground">·</span> Competitor
            Content Intelligence
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <Link to="/" className={linkCls} activeProps={{ className: cn(linkCls, activeCls) }}>
            1 · Load data
          </Link>
          {hasData ? (
            <Link
              to="/skus"
              className={linkCls}
              activeProps={{ className: cn(linkCls, activeCls) }}
            >
              2 · Select SKU
            </Link>
          ) : (
            <span
              aria-disabled
              title="Load product data first"
              className="cursor-not-allowed rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/40"
            >
              2 · Select SKU
            </span>
          )}
          <Link
            to="/guidelines"
            className={linkCls}
            activeProps={{ className: cn(linkCls, activeCls) }}
          >
            Guidelines
          </Link>
        </nav>
      </div>
    </header>
  );
}
