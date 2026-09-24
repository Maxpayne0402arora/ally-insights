import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { rules, ruleById, ruleSections } from "@/data/rules";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type DrawerState = { mode: "all" } | { mode: "rule"; ruleId: string } | null;

type RuleDrawerValue = {
  openRule: (ruleId: string) => void;
  openAllRules: () => void;
};

const RuleDrawerContext = createContext<RuleDrawerValue | null>(null);

export function RuleDrawerProvider({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [query, setQuery] = useState("");
  const openRule = useCallback((ruleId: string) => setDrawer({ mode: "rule", ruleId }), []);
  const openAllRules = useCallback(() => {
    setQuery("");
    setDrawer({ mode: "all" });
  }, []);
  const value = useMemo(() => ({ openRule, openAllRules }), [openRule, openAllRules]);
  const selected = drawer?.mode === "rule" ? ruleById(drawer.ruleId) : undefined;
  const filteredRules = rules.filter((rule) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${rule.id} ${rule.section} ${rule.name} ${rule.text}`.toLowerCase().includes(needle);
  });

  return (
    <RuleDrawerContext.Provider value={value}>
      {children}
      <Sheet open={drawer !== null} onOpenChange={(open) => !open && setDrawer(null)}>
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="sticky top-0 z-10 border-b border-border bg-background px-5 py-5 pr-14 text-left sm:px-6">
            <SheetTitle>{selected ? selected.id : "Content guidelines"}</SheetTitle>
            <SheetDescription>
              {selected ? selected.section : "Search every rule Ally uses to assess listing content."}
            </SheetDescription>
          </SheetHeader>

          {selected ? (
            <div className="p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase text-muted-foreground">{selected.section}</p>
              <h2 className="mt-2 text-xl font-semibold text-foreground">{selected.name}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{selected.text}</p>

              <Collapsible className="mt-8 border-t border-border pt-4">
                <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between text-left text-sm font-medium text-foreground">
                  Other rules in this section
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2">
                  {rules
                    .filter((rule) => rule.section === selected.section && rule.id !== selected.id)
                    .map((rule) => (
                      <button
                        key={rule.id}
                        type="button"
                        onClick={() => setDrawer({ mode: "rule", ruleId: rule.id })}
                        className="w-full rounded-md border border-border p-3 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="font-mono text-xs text-primary">{rule.id}</span>
                        <span className="mt-1 block text-sm font-medium text-foreground">{rule.name}</span>
                      </button>
                    ))}
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : (
            <div className="p-5 sm:p-6">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search rules"
                  aria-label="Search guidelines"
                  className="pl-9"
                />
              </div>
              <div className="mt-6 space-y-8">
                {ruleSections.map((section) => {
                  const sectionRules = filteredRules.filter((rule) => rule.section === section);
                  if (!sectionRules.length) return null;
                  return (
                    <section key={section}>
                      <h2 className="text-sm font-semibold text-foreground">{section}</h2>
                      <div className="mt-2 divide-y divide-border border-y border-border">
                        {sectionRules.map((rule) => (
                          <button
                            key={rule.id}
                            type="button"
                            onClick={() => setDrawer({ mode: "rule", ruleId: rule.id })}
                            className="flex min-h-11 w-full items-center gap-3 py-3 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="shrink-0 font-mono text-xs text-primary">{rule.id}</span>
                            <span className="text-sm text-foreground">{rule.name}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
                {!filteredRules.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">No matching rules</p>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </RuleDrawerContext.Provider>
  );
}

export function useRuleDrawer() {
  const value = useContext(RuleDrawerContext);
  if (!value) throw new Error("useRuleDrawer must be used inside RuleDrawerProvider");
  return value;
}