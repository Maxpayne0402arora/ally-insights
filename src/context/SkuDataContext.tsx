import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DataSource, Sku } from "@/types/sku";

const STORAGE_KEY = "ally.skuDataset.v1";
const DISMISSED_KEY = "ally.dismissed.v1";

type Dataset = {
  skus: Sku[];
  source: DataSource;
  fileName: string | null;
  loadedAt: string | null;
};

type SkuDataValue = Dataset & {
  hydrated: boolean;
  hasData: boolean;
  /** Hash of the loaded file's contents. Empty string when no data. */
  datasetId: string;
  /** Dismissed finding keys, formatted `${sku_id}|${finding_id}`, for the current dataset. */
  dismissedFindings: string[];
  isDismissed: (skuId: string, findingId: string) => boolean;
  dismissFinding: (skuId: string, findingId: string) => void;
  restoreFinding: (skuId: string, findingId: string) => void;
  setDataset: (skus: Sku[], source: Exclude<DataSource, null>, fileName: string) => void;
  clearDataset: () => void;
};

const empty: Dataset = { skus: [], source: null, fileName: null, loadedAt: null };

const SkuDataContext = createContext<SkuDataValue | null>(null);

function hashString(input: string): string {
  // FNV-1a 32-bit, twice with different seeds for fewer collisions.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

function readStorage(): Dataset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Dataset;
    if (!parsed || !Array.isArray(parsed.skus) || parsed.skus.length === 0) return empty;
    return {
      skus: parsed.skus,
      source: parsed.source ?? null,
      fileName: parsed.fileName ?? null,
      loadedAt: parsed.loadedAt ?? null,
    };
  } catch {
    return empty;
  }
}

function readDismissed(datasetId: string): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { datasetId?: string; keys?: unknown };
    if (parsed?.datasetId !== datasetId || !Array.isArray(parsed.keys)) return [];
    return parsed.keys.filter((k): k is string => typeof k === "string");
  } catch {
    return [];
  }
}

export function SkuDataProvider({ children }: { children: ReactNode }) {
  const [dataset, setState] = useState<Dataset>(empty);
  const [hydrated, setHydrated] = useState(false);
  const [dismissedFindings, setDismissed] = useState<string[]>([]);

  const datasetId = useMemo(
    () => (dataset.skus.length ? hashString(JSON.stringify({ f: dataset.fileName, s: dataset.skus })) : ""),
    [dataset.skus, dataset.fileName],
  );

  useEffect(() => {
    setState(readStorage());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) setDismissed(datasetId ? readDismissed(datasetId) : []);
  }, [datasetId, hydrated]);

  const persistDismissed = useCallback(
    (keys: string[]) => {
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify({ datasetId, keys }));
      } catch {
        /* ignore */
      }
    },
    [datasetId],
  );

  const dismissFinding = useCallback(
    (skuId: string, findingId: string) => {
      setDismissed((prev) => {
        const key = `${skuId}|${findingId}`;
        if (prev.includes(key)) return prev;
        const next = [...prev, key];
        persistDismissed(next);
        return next;
      });
    },
    [persistDismissed],
  );

  const restoreFinding = useCallback(
    (skuId: string, findingId: string) => {
      setDismissed((prev) => {
        const next = prev.filter((k) => k !== `${skuId}|${findingId}`);
        persistDismissed(next);
        return next;
      });
    },
    [persistDismissed],
  );

  const isDismissed = useCallback(
    (skuId: string, findingId: string) => dismissedFindings.includes(`${skuId}|${findingId}`),
    [dismissedFindings],
  );

  const setDataset = useCallback(
    (skus: Sku[], source: Exclude<DataSource, null>, fileName: string) => {
      const next: Dataset = { skus, source, fileName, loadedAt: new Date().toISOString() };
      setState(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — keep in memory only */
      }
    },
    [],
  );

  const clearDataset = useCallback(() => {
    setState(empty);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<SkuDataValue>(
    () => ({
      ...dataset,
      hydrated,
      hasData: dataset.skus.length > 0,
      datasetId,
      dismissedFindings,
      isDismissed,
      dismissFinding,
      restoreFinding,
      setDataset,
      clearDataset,
    }),
    [dataset, hydrated, datasetId, dismissedFindings, isDismissed, dismissFinding, restoreFinding, setDataset, clearDataset],
  );

  return <SkuDataContext.Provider value={value}>{children}</SkuDataContext.Provider>;
}

export function useSkuData() {
  const ctx = useContext(SkuDataContext);
  if (!ctx) throw new Error("useSkuData must be used inside SkuDataProvider");
  return ctx;
}
