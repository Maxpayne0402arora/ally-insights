import { auditSku, complianceScore } from "@/lib/rules";
import type { Sku } from "@/types/sku";
import { ListingContent } from "@/components/ListingContent";
import { RoleBadge, ScoreBadge } from "@/components/ScoreBadge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function CompetitorDrawer({ sku, allSkus, onClose }: { sku: Sku | null; allSkus: Sku[]; onClose: () => void }) {
  const findings = sku ? auditSku(sku, allSkus) : [];
  return (
    <Sheet open={sku !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {sku && (
          <>
            <SheetHeader className="border-b border-border px-5 py-5 pr-14 text-left sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{sku.brand}</SheetTitle>
                <RoleBadge isClient={sku.is_client} />
                <ScoreBadge score={complianceScore(findings)} />
              </div>
              <SheetDescription>{sku.sku_id} · {sku.category}</SheetDescription>
            </SheetHeader>
            <div className="p-5 sm:p-6">
              <ListingContent sku={sku} allSkus={allSkus} showHeading={false} />
              <section className="mt-8 border-t border-border pt-6">
                <h2 className="text-base font-semibold text-foreground">Findings ({findings.length})</h2>
                {findings.length ? (
                  <ul className="mt-3 space-y-2">
                    {findings.map((finding) => (
                      <li key={finding.id} className="rounded-md bg-secondary p-3 text-sm">
                        <span className="font-mono text-xs text-primary">{finding.rule_id}</span>
                        <p className="mt-1 text-foreground">{finding.message}</p>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-success">No guideline issues found</p>}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}