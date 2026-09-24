import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { StepIndicator } from "@/components/StepIndicator";
import { RoleBadge, ScoreBadge } from "@/components/ScoreBadge";
import { Button } from "@/components/ui/button";
import { useSkuData } from "@/context/SkuDataContext";
import { useReview, useReviewStatuses } from "@/context/ReviewContext";
import { csvTemplate, MAX_BYTES, parseCsv, type ParseResult } from "@/lib/csv";
import { auditSku, complianceScore } from "@/lib/rules";
import { sampleSkus } from "@/data/sampleSkus";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Load product data · Ally" },
      {
        name: "description",
        content:
          "Upload a CSV of Amazon SKUs, or start with sample data, to audit listing content against Amazon guidelines.",
      },
      { property: "og:title", content: "Load product data · Ally" },
      {
        property: "og:description",
        content:
          "Upload a CSV of Amazon SKUs, or start with sample data, to audit listing content against Amazon guidelines.",
      },
    ],
  }),
  component: LoadDataPage,
});

const truncate = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

function Section({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "danger" | "warning" | "muted";
}) {
  const [open, setOpen] = useState(tone === "danger");
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
      >
        <span
          className={cn(
            tone === "danger" && "text-danger",
            tone === "warning" && "text-warning",
            tone === "muted" && "text-muted-foreground",
          )}
        >
          {title} ({items.length})
        </span>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <ul className="space-y-1 border-t border-border px-4 py-3 text-sm text-muted-foreground">
          {items.map((it) => (
            <li key={it}>• {it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoadDataPage() {
  const navigate = useNavigate();
  const { skus, fileName, hasData, setDataset } = useSkuData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ParseResult | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const { clearAll } = useReview();
  const { atRisk } = useReviewStatuses(skus);

  /** Confirm replacing the loaded dataset; warns when approved/pending edits would be cleared. */
  function confirmReplace() {
    if (!hasData) return true;
    const extra = atRisk > 0 ? `\n\nApproved edits for ${atRisk} SKU${atRisk === 1 ? "" : "s"} will be cleared. Download their summaries first.` : "";
    if (!window.confirm(`Replace ${fileName ?? "the loaded data"} with the new data?${extra}`)) return false;
    clearAll();
    return true;
  }

  useEffect(() => {
    try {
      if (sessionStorage.getItem("ally.notice")) {
        setNotice(true);
        sessionStorage.removeItem("ally.notice");
      }
    } catch {
      /* ignore */
    }
  }, []);

  async function handleFile(file: File) {
    setFileError(null);
    setPending(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileError("That file isn't a CSV. Please upload a .csv file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setFileError("File is larger than 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      setPending(parseCsv(text));
      setPendingName(file.name);
    } catch {
      setFileError("The file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([csvTemplate()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ally-sku-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function loadSample() {
    if (!confirmReplace()) return;
    setDataset(sampleSkus, "sample", "Sample data");
    toast.success("8 SKUs loaded from Sample data");
    navigate({ to: "/skus" });
  }

  function commit() {
    if (!pending || pending.errors.length || !pending.skus.length) return;
    if (!confirmReplace()) return;
    setDataset(pending.skus, "upload", pendingName);
    toast.success(`${pending.skus.length} SKUs loaded from ${pendingName}`);
    navigate({ to: "/skus" });
  }

  const blocked = !!pending && (pending.errors.length > 0 || !pending.skus.length);

  return (
    <div>
      <StepIndicator current={1} />

      {notice && (
        <div className="mb-6 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Load product data to get started.
        </div>
      )}

      {hasData && (
        <div className="mb-8 flex flex-col gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-foreground">
              Continue with {fileName} · {skus.length} SKUs
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              or upload a new file below to replace it
            </p>
          </div>
          <Button onClick={() => navigate({ to: "/skus" })}>Continue</Button>
        </div>
      )}

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Load product data
      </h1>
      <p className="mt-2 text-muted-foreground">
        Upload a CSV of SKUs to compare. Each row is one listing.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={cn(
          "mt-6 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border bg-card",
        )}
      >
        {busy ? (
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        ) : (
          <Upload className="h-8 w-8 text-muted-foreground" />
        )}
        <p className="mt-4 font-medium text-foreground">
          Drag and drop your CSV here
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          .csv only · up to 5 MB · up to 500 rows
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={() => inputRef.current?.click()}>Choose file</Button>
          <Button variant="outline" onClick={loadSample}>
            Use sample data (8 SKUs)
          </Button>
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            <Download className="h-4 w-4" /> Download CSV template
          </button>
        </div>
      </div>

      {fileError && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <XCircle className="h-4 w-4" /> {fileError}
        </div>
      )}

      {pending && (
        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            {pendingName}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {pending.rowsRead} rows read · {pending.skus.length} valid ·{" "}
            {pending.skipped.length} skipped · {pending.warnings.length} warnings
          </p>

          <div className="mt-4 space-y-2">
            <Section title="Errors" items={pending.errors} tone="danger" />
            <Section title="Skipped rows" items={pending.skipped} tone="muted" />
            <Section title="Warnings" items={pending.warnings} tone="warning" />
          </div>

          {pending.skus.length > 0 && (
            <div className="mt-6 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Brand</th>
                    <th className="px-3 py-2 font-medium">Group</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Bullets</th>
                    <th className="px-3 py-2 font-medium">Images</th>
                    <th className="px-3 py-2 font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.skus.map((s) => (
                    <tr key={s.sku_id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{s.sku_id}</td>
                      <td className="px-3 py-2">{s.brand}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {s.competitor_group}
                      </td>
                      <td className="px-3 py-2">
                        <RoleBadge isClient={s.is_client} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {truncate(s.title)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{s.bullets.length}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {s.image_urls.length}
                      </td>
                      <td className="px-3 py-2">
                        <ScoreBadge
                          score={complianceScore(auditSku(s, pending.skus))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={commit} disabled={blocked}>
              Load data
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            {blocked ? (
              <span className="flex items-center gap-1.5 text-sm text-danger">
                <AlertTriangle className="h-4 w-4" /> Fix the errors above to load
                this file
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" /> Ready to load
              </span>
            )}
          </div>
        </div>
      )}

      <p className="mt-10 text-sm text-muted-foreground">
        Not sure what good looks like?{" "}
        <Link to="/guidelines" className="text-primary hover:underline">
          Read the content guidelines
        </Link>
        .
      </p>
    </div>
  );
}
