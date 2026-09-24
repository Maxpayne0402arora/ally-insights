import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSkuData } from "@/context/SkuDataContext";
import { useGeneration } from "@/context/GenerationContext";
import { buildItems, isAccepted, reviewStatus, type Decision, type SkuReview } from "@/lib/review";
import type { EditField } from "@/lib/top3";
import type { Sku } from "@/types/sku";

const STORAGE_KEY = "ally.review.v1";

type Ctx = {
  reviews: Record<string, SkuReview>;
  reviewFor: (skuId: string) => SkuReview | undefined;
  setDecision: (skuId: string, field: EditField, d: Decision | null) => void;
  markFinished: (skuId: string) => void;
  clearAll: () => void;
};

const ReviewContext = createContext<Ctx | null>(null);

function read(): Record<string, SkuReview> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, SkuReview>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function write(v: Record<string, SkuReview>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export function ReviewProvider({ children }: { children: ReactNode }) {
  const { datasetId } = useSkuData();
  const [reviews, setReviews] = useState<Record<string, SkuReview>>({});
  useEffect(() => setReviews(read()), []);

  const keyFor = useCallback((skuId: string) => `${datasetId}:${skuId}`, [datasetId]);
  const reviewFor = useCallback((skuId: string) => reviews[keyFor(skuId)], [reviews, keyFor]);

  const update = useCallback(
    (skuId: string, fn: (r: SkuReview) => SkuReview) =>
      setReviews((prev) => {
        const k = keyFor(skuId);
        const next = { ...prev, [k]: fn(prev[k] ?? { decisions: {} }) };
        write(next);
        return next;
      }),
    [keyFor],
  );

  const setDecision = useCallback(
    (skuId: string, field: EditField, d: Decision | null) =>
      update(skuId, (r) => {
        const decisions = { ...r.decisions };
        if (d) decisions[field] = d;
        else delete decisions[field];
        return { decisions, finishedAt: undefined };
      }),
    [update],
  );

  const markFinished = useCallback(
    (skuId: string) => update(skuId, (r) => ({ ...r, finishedAt: new Date().toISOString() })),
    [update],
  );

  const clearAll = useCallback(() => {
    setReviews({});
    write({});
  }, []);

  const value = useMemo(
    () => ({ reviews, reviewFor, setDecision, markFinished, clearAll }),
    [reviews, reviewFor, setDecision, markFinished, clearAll],
  );
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

export function useReview() {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error("useReview must be used inside ReviewProvider");
  return ctx;
}

/** Current result + review items for one SKU. */
export function useSkuReview(skuId: string | undefined) {
  const { cacheKeyFor, results } = useGeneration();
  const { reviewFor } = useReview();
  const stored = skuId ? results[cacheKeyFor(skuId)] : undefined;
  const review = skuId ? reviewFor(skuId) : undefined;
  const items = useMemo(() => buildItems(stored, review), [stored, review]);
  return { stored, review, items };
}

/** Status per SKU for the picker, and how many SKUs have work that a data replace would clear. */
export function useReviewStatuses(skus: Sku[]) {
  const { cacheKeyFor, results } = useGeneration();
  const { reviewFor } = useReview();
  return useMemo(() => {
    const statuses = new Map(skus.map((s) => [s.sku_id, reviewStatus(results[cacheKeyFor(s.sku_id)], reviewFor(s.sku_id))]));
    const atRisk = skus.filter((s) => {
      const items = buildItems(results[cacheKeyFor(s.sku_id)], reviewFor(s.sku_id));
      return items.some((i) => isAccepted(i.decision?.state) || !i.decision || i.decision.state === "pending");
    }).length;
    return { statuses, atRisk };
  }, [skus, results, cacheKeyFor, reviewFor]);
}
