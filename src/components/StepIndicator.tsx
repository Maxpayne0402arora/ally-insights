import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const steps = ["Load data", "Select SKU", "Review & approve"];

export function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-3 text-sm">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : done
                    ? "border-border bg-secondary text-foreground"
                    : "border-border text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : n}
              </span>
              <span className="font-medium">{label}</span>
            </span>
            {n < steps.length && (
              <span className="h-px w-6 bg-border sm:w-10" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
