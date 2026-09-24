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

type Dataset = {
  skus: Sku[];
  source: DataSource;
  fileName: string | null;
  loadedAt: string | null;
};

type SkuDataValue = Dataset & {
  hydrated: boolean;
  hasData: boolean;
  setDataset: (skus: Sku[], source: Exclude<DataSource, null>, fileName: string) => void;
  clearDataset: () => void;
};

const empty: Dataset = {
  skus: [],
  source: null,
  fileName: null,
  loadedAt: null,
};

const SkuDataContext = createContext<SkuDataValue | null>(null);

function readStorage(): Dataset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Dataset;
    if (!parsed || !Array.isArray(parsed.skus) || parsed.skus.length === 0)
      return empty;
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

export function SkuDataProvider({ children }: { children: ReactNode }) {
  const [dataset, setState] = useState<Dataset>(empty);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(readStorage());
    setHydrated(true);
  }, []);

  const setDataset = useCallback(
    (skus: Sku[], source: Exclude<DataSource, null>, fileName: string) => {
      const next: Dataset = {
        skus,
        source,
        fileName,
        loadedAt: new Date().toISOString(),
      };
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
      setDataset,
      clearDataset,
    }),
    [dataset, hydrated, setDataset, clearDataset],
  );

  return (
    <SkuDataContext.Provider value={value}>{children}</SkuDataContext.Provider>
  );
}

export function useSkuData() {
  const ctx = useContext(SkuDataContext);
  if (!ctx) throw new Error("useSkuData must be used inside SkuDataProvider");
  return ctx;
}
