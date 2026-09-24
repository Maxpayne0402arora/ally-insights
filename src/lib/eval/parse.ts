import Papa from "papaparse";
import { parseCsv } from "@/lib/csv";
import { AI_ASSERTIONS, RULE_ASSERTIONS, isRulesOnlyRow, type Assertion, type EvalRow, type EvalSet } from "./types";

const TYPES = new Set<string>([...RULE_ASSERTIONS, ...AI_ASSERTIONS]);
const FIELDS = new Set(["title", "bullets", "description", "any"]);

function validate(a: unknown): Assertion {
  if (!a || typeof a !== "object") throw new Error("each assertion must be an object");
  const o = a as Record<string, unknown>;
  const t = String(o["type"] ?? "");
  if (!TYPES.has(t)) throw new Error(`unknown assertion type "${t}"`);
  const str = (k: string) => (o[k] == null ? "" : String(o[k]));
  const field = () => {
    const f = str("field") || "any";
    if (!FIELDS.has(f)) throw new Error(`invalid field "${f}" in ${t}`);
    return f as "any";
  };
  const num = () => {
    const n = Number(o["value"]);
    if (!Number.isFinite(n)) throw new Error(`${t} needs a numeric value`);
    return n;
  };
  // "rule_ids" (array) or "rule_id" (string); empty = any rule.
  const ruleIds = () => {
    const v = o["rule_ids"] ?? o["rule_id"];
    if (v == null || v === "") return [];
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === "string") return [v.trim()];
    throw new Error(`rule_ids in ${t} must be an array of strings`);
  };
  switch (t) {
    case "finding_flagged":
    case "finding_not_flagged":
      return { type: t, rule_ids: ruleIds(), text: str("text") };
    case "no_findings":
      return { type: t, rule_ids: ruleIds() };
    case "not_contains":
      return { type: t, field: field(), value: str("value") };
    case "contains_placeholder":
    case "edit_field_present":
      return { type: t, field: field() };
    case "max_edits":
    case "min_edits":
      return { type: t, value: num() };
    case "max_length":
      return { type: t, field: field(), value: num() };
    case "suspected_fp":
      return { type: t, text: str("text") };
    default:
      return { type: t } as Assertion;
  }
}

export function parseEvalCsv(text: string, fileName: string): { set: EvalSet | null; errors: string[]; rowErrors: string[] } {
  const base = parseCsv(text);
  if (base.errors.length) return { set: null, errors: base.errors, rowErrors: [] };
  const raw = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const extra = new Map<string, { scenario: string; expectations: string; rowNo: number }>();
  raw.data.forEach((r, i) => {
    const id = (r["sku_id"] ?? "").trim().toLowerCase();
    if (id && !extra.has(id)) extra.set(id, { scenario: (r["scenario"] ?? "").trim(), expectations: (r["expectations"] ?? "").trim(), rowNo: i + 2 });
  });
  const rowErrors: string[] = [];
  const rows: EvalRow[] = base.skus.map((sku) => {
    const x = extra.get(sku.sku_id.toLowerCase());
    const row: EvalRow = { sku, scenario: x?.scenario ?? "", assertions: [], rowNo: x?.rowNo ?? 0 };
    if (x?.expectations) {
      try {
        const arr = JSON.parse(x.expectations) as unknown;
        if (!Array.isArray(arr)) throw new Error("expectations must be a JSON array");
        row.assertions = arr.map(validate);
      } catch (e) {
        row.assertionError = e instanceof SyntaxError ? `invalid JSON (${e.message})` : e instanceof Error ? e.message : String(e);
        rowErrors.push(`Row ${row.rowNo} (${sku.sku_id}): ${row.assertionError} — assertions skipped`);
      }
    }
    return row;
  });
  const warnings = base.warnings.map((w) => w.replace(/,?\s*\b(scenario|expectations|eval_type)\b/g, "")).filter((w) => !/ignored:\s*$/.test(w));
  return { set: { fileName, skus: base.skus, rows, warnings, skipped: base.skipped }, errors: [], rowErrors };
}

export function setSummary(set: EvalSet) {
  const clients = set.rows.filter((r) => r.sku.is_client).length;
  const scenarios = set.rows.filter((r) => r["scenario"]).length;
  const rulesOnly = set.rows.filter(isRulesOnlyRow).length;
  const aiRows = set.rows.filter((r) => r.sku.is_client && !isRulesOnlyRow(r)).length;
  const assertions = set.rows.reduce((n, r) => n + r.assertions.length + (r.sku.is_client && !isRulesOnlyRow(r) ? 2 : 0), 0);
  return `${set.rows.length} rows · ${aiRows} AI rows · ${rulesOnly} rules-only rows · ${clients} client SKUs · ${scenarios} scenarios · ${assertions} assertions`;
}
