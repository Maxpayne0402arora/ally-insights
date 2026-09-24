import { del, get, keys, set } from "idb-keyval";
import type { EvalRun, SkuRecord } from "./types";

const RUN = (id: string) => `evalrun:${id}`;
export const REC = (runId: string, key: string) => `eval:${runId}:${key}`;

export async function saveRun(run: EvalRun) {
  try { await set(RUN(run.id), run); } catch (e) { console.error("eval saveRun", e); }
}
export async function saveRecord(runId: string, rec: SkuRecord) {
  try { await set(REC(runId, rec.key), rec); } catch (e) { console.error("eval saveRecord", e); }
}
export async function loadRuns(): Promise<EvalRun[]> {
  try {
    const ks = (await keys()).filter((k) => typeof k === "string" && k.startsWith("evalrun:"));
    const runs = (await Promise.all(ks.map((k) => get<EvalRun>(k)))).filter(Boolean) as EvalRun[];
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
export async function loadRecords(runId: string): Promise<Record<string, SkuRecord>> {
  try {
    const prefix = `eval:${runId}:`;
    const ks = (await keys()).filter((k) => typeof k === "string" && k.startsWith(prefix)) as string[];
    const recs = await Promise.all(ks.map((k) => get<SkuRecord>(k)));
    return Object.fromEntries(recs.filter(Boolean).map((r) => [r!.key, r!]));
  } catch {
    return {};
  }
}
export async function deleteRun(runId: string) {
  try {
    const prefix = `eval:${runId}:`;
    const ks = (await keys()).filter((k) => typeof k === "string" && k.startsWith(prefix));
    await Promise.all([...ks.map((k) => del(k)), del(RUN(runId))]);
  } catch { /* ignore */ }
}
