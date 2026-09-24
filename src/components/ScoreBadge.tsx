import { cn } from "@/lib/utils";

export function ScoreBadge({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const tone =
    score >= 80
      ? "bg-success-soft text-success"
      : score >= 55
        ? "bg-warning-soft text-warning"
        : "bg-danger-soft text-danger";
  return (
    <span
      className={cn(
        "inline-flex min-w-11 items-center justify-center rounded-md px-2 py-1 text-xs font-semibold tabular-nums",
        tone,
        className,
      )}
    >
      {score}
    </span>
  );
}

export function RoleBadge({ isClient }: { isClient: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        isClient
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground",
      )}
    >
      {isClient ? "Client" : "Competitor"}
    </span>
  );
}
