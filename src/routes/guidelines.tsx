import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { rules, ruleSections } from "@/data/rules";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/guidelines")({
  head: () => ({
    meta: [
      { title: "Content guidelines · Ally" },
      {
        name: "description",
        content:
          "The Amazon listing content rules Ally checks: titles, bullets, descriptions, images and restricted content.",
      },
      { property: "og:title", content: "Content guidelines · Ally" },
      {
        property: "og:description",
        content:
          "The Amazon listing content rules Ally checks: titles, bullets, descriptions, images and restricted content.",
      },
    ],
  }),
  component: GuidelinesPage,
});

function GuidelinesPage() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    const apply = () => {
      const id = window.location.hash.replace("#", "");
      if (!id) return;
      setTarget(id);
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = setTimeout(() => setTarget(null), 2500);
      return () => clearTimeout(t);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Content guidelines
      </h1>
      <p className="mt-2 text-muted-foreground">
        Ally checks every listing against these Amazon content rules.
      </p>

      <div className="mt-10 space-y-12">
        {ruleSections.map((section) => (
          <section key={section}>
            <h2 className="text-lg font-semibold text-foreground">{section}</h2>
            <div className="mt-4 space-y-3">
              {rules
                .filter((r) => r.section === section)
                .map((r) => (
                  <article
                    key={r.id}
                    id={r.id}
                    className={cn(
                      "scroll-mt-24 rounded-xl border p-4 transition-colors",
                      target === r.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        {r.id}
                      </span>
                      <h3 className="font-medium text-foreground">{r.name}</h3>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {r.text}
                    </p>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
