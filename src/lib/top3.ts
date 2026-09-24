import { rules, ruleById } from "@/data/rules";
import {
  auditSku,
  complianceScore,
  hasBulletHeader,
  hasIdentifier,
  maskPlaceholders,
  severityCounts,
  validateText,
} from "@/lib/rules";
import type { Finding, Sku } from "@/types/sku";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type EditField = "title" | "bullets" | "description";
export type FieldText = string | string[];

export type CompetitorRef = { sku_id: string; brand: string; evidence: string };
export type Change = {
  type: "compliance" | "competitive";
  what: string;
  rule_ids: string[];
  competitor_refs: CompetitorRef[];
};
export type Edit = {
  rank: number;
  field: EditField;
  why_ranked: string;
  current: FieldText;
  proposed_full: FieldText;
  proposed_compliance_only: FieldText;
  changes: Change[];
  placeholders: string[];
  resolves_finding_ids: string[];
};
export type AiResult = {
  summary: string;
  strengths: string[];
  top_edits: Edit[];
  open_issues: { finding_id: string; reason: string; auto?: boolean }[];
  suspected_false_positives: { finding_id: string; reason: string }[];
  action_items: { what: string; rule_ids: string[] }[];
};

export type GuardFailure = { edit_rank: number | null; check: string; detail: string };

export type PayloadFinding = Pick<Finding, "id" | "rule_id" | "field" | "severity" | "match_type" | "message" | "evidence">;

export type BuiltPayload = {
  payload: {
    selected_sku: Sku;
    competitors: Sku[];
    same_brand_skus: string[];
    findings: PayloadFinding[];
    benchmark: Record<string, unknown>;
    rules: typeof rules;
    mode: "benchmark" | "guidelines_only";
  };
  competitors: Sku[]; // untruncated competitors that were sent
  sameBrand: Sku[];
  findings: PayloadFinding[];
};

/* ------------------------------------------------------------------ */
/* Payload                                                             */
/* ------------------------------------------------------------------ */

const LIMITS = { title: 240, bullet: 300, description: 2400 };
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} [truncated]` : s);
const truncateSku = (s: Sku): Sku => ({
  ...s,
  title: cut(s.title, LIMITS.title),
  bullets: s.bullets.map((b) => cut(b, LIMITS.bullet)),
  description: cut(s.description, LIMITS.description),
});

const sameBrand = (a: Sku, b: Sku) => a.brand.trim().toLowerCase() === b.brand.trim().toLowerCase();

function metricsFor(s: Sku, allSkus: Sku[]) {
  const f = auditSku(s, allSkus);
  const lens = s.bullets.map((b) => b.length);
  return {
    sku_id: s.sku_id,
    brand: s.brand,
    title_length: s.title.length,
    title_in_80_150_range: s.title.length >= 80 && s.title.length <= 150,
    title_has_identifier: hasIdentifier(s.title),
    bullet_count: s.bullets.length,
    avg_bullet_length: lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0,
    bullets_with_header: s.bullets.filter(hasBulletHeader).length,
    description_length: s.description.length,
    image_count: s.image_urls.length,
    findings: severityCounts(f),
    compliance_score: complianceScore(f),
  };
}

export function buildPayload(sku: Sku, allSkus: Sku[], isDismissed: (id: string) => boolean): BuiltPayload {
  const group = allSkus.filter((s) => s.competitor_group === sku.competitor_group && s.sku_id !== sku.sku_id);
  const siblings = group.filter((s) => sameBrand(s, sku));
  const competitors = group
    .filter((s) => !sameBrand(s, sku))
    .map((s) => ({ s, score: complianceScore(auditSku(s, allSkus)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.s);

  const findings: PayloadFinding[] = auditSku(sku, allSkus)
    .filter((f) => !isDismissed(f.id))
    .map(({ id, rule_id, field, severity, match_type, message, evidence }) => ({
      id, rule_id, field, severity, match_type: match_type ?? "explicit", message, evidence,
    }));

  return {
    payload: {
      selected_sku: truncateSku(sku),
      competitors: competitors.map(truncateSku),
      same_brand_skus: siblings.map((s) => s.sku_id),
      findings,
      benchmark: {
        selected: metricsFor(sku, allSkus),
        competitors: competitors.map((c) => metricsFor(c, allSkus)),
      },
      rules,
      mode: competitors.length ? "benchmark" : "guidelines_only",
    },
    competitors,
    sameBrand: siblings,
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* Parsing & normalisation                                             */
/* ------------------------------------------------------------------ */

export const INVALID_JSON_MSG = "Your previous output was invalid or incomplete JSON. Return shorter, valid JSON only.";

export function extractJson(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("No JSON object found");
  t = t.slice(first, last + 1);
  return JSON.parse(t);
}

const fixConfirm = (s: string) => s.replace(/\[\s*confirm\s*:\s*([^\]]*?)\s*\]/gi, (_m, inner: string) => `[confirm: ${inner}]`);
const str = (x: unknown) => (typeof x === "string" ? fixConfirm(x.trim()) : "");
const strList = (x: unknown) => (Array.isArray(x) ? x.map(str).filter(Boolean) : []);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const obj = (x: unknown): Loose => (x && typeof x === "object" && !Array.isArray(x) ? (x as Loose) : {});

function fieldText(field: EditField, x: unknown): FieldText {
  if (field === "bullets") {
    if (Array.isArray(x)) return x.map(str).filter(Boolean);
    if (typeof x === "string") return x.split(/\r?\n/).map((l) => str(l)).filter(Boolean);
    return [];
  }
  if (Array.isArray(x)) return x.map(str).filter(Boolean).join(field === "title" ? " " : "\n");
  return str(x);
}

const TOP_KEYS = ["summary", "strengths", "top_edits", "open_issues", "suspected_false_positives", "action_items"];
const EDIT_KEYS = ["rank", "field", "why_ranked", "current", "proposed_full", "proposed_compliance_only", "changes", "placeholders", "resolves_finding_ids"];

export function normalize(raw: unknown): { result: AiResult; failures: GuardFailure[] } {
  const failures: GuardFailure[] = [];
  const r = obj(raw);
  TOP_KEYS.forEach((k) => {
    if (!(k in r)) failures.push({ edit_rank: null, check: "structure", detail: `Missing required key "${k}".` });
  });

  const edits: Edit[] = [];
  (Array.isArray(r.top_edits) ? r.top_edits : []).forEach((e: unknown, i: number) => {
    const eo = obj(e);
    const rank = typeof eo.rank === "number" ? eo.rank : i + 1;
    EDIT_KEYS.forEach((k) => {
      if (!(k in eo)) failures.push({ edit_rank: rank, check: "structure", detail: `Edit is missing required key "${k}".` });
    });
    const field = eo.field;
    if (field !== "title" && field !== "bullets" && field !== "description") {
      failures.push({ edit_rank: rank, check: "structure", detail: `Invalid field "${String(field)}"; edit dropped.` });
      return;
    }
    edits.push({
      rank,
      field,
      why_ranked: str(eo.why_ranked),
      current: fieldText(field, eo.current),
      proposed_full: fieldText(field, eo.proposed_full),
      proposed_compliance_only: fieldText(field, eo.proposed_compliance_only),
      changes: (Array.isArray(eo.changes) ? eo.changes : []).map((c: unknown) => {
        const co = obj(c);
        return {
          type: co.type === "competitive" ? "competitive" : "compliance",
          what: str(co.what),
          rule_ids: strList(co.rule_ids),
          competitor_refs: (Array.isArray(co.competitor_refs) ? co.competitor_refs : []).map((ref: unknown) => {
            const ro = obj(ref);
            return { sku_id: str(ro.sku_id), brand: str(ro.brand), evidence: typeof ro.evidence === "string" ? ro.evidence.trim() : "" };
          }),
        };
      }),
      placeholders: strList(eo.placeholders).map((p) => fixConfirm(p.replace(/^\[|\]$/g, "").replace(/^confirm\s*:/i, "confirm:"))),
      resolves_finding_ids: strList(eo.resolves_finding_ids),
    });
  });
  edits.sort((a, b) => a.rank - b.rank);

  const pairs = (x: unknown) =>
    (Array.isArray(x) ? x : []).map((i) => ({ finding_id: str(obj(i).finding_id), reason: str(obj(i).reason) })).filter((p) => p.finding_id);

  return {
    result: {
      summary: str(r.summary),
      strengths: strList(r.strengths),
      top_edits: edits,
      open_issues: pairs(r.open_issues),
      suspected_false_positives: pairs(r.suspected_false_positives),
      action_items: (Array.isArray(r.action_items) ? r.action_items : [])
        .map((a: unknown) => ({ what: str(obj(a).what), rule_ids: strList(obj(a).rule_ids) }))
        .filter((a: { what: string }) => a.what),
    },
    failures,
  };
}

/* ------------------------------------------------------------------ */
/* Guardrail                                                           */
/* ------------------------------------------------------------------ */

const asList = (t: FieldText) => (Array.isArray(t) ? t : [t]);
const joined = (t: FieldText) => asList(t).join("\n");
const sameText = (a: FieldText, b: FieldText) =>
  JSON.stringify(asList(a).map((s) => s.trim())) === JSON.stringify(asList(b).map((s) => s.trim()));

const CLAIM_WORDS = [
  "certified", "approved", "recommended", "vet", "veterinarian", "safe", "non-toxic", "natural", "organic", "vegan",
  "gluten", "made in", "patented", "tested", "eco", "recyclable", "sustainable", "calories", "vitamin",
];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(w).replace(/\s+/g, "\\s+")}(?![A-Za-z0-9])`, "i");

function inventedClaims(proposed: string, source: string): string[] {
  const text = maskPlaceholders(proposed);
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-free(?![A-Za-z0-9])/gi)) {
    if (!wordRe(m[0]).test(source)) found.add(m[0]);
  }
  for (const w of CLAIM_WORDS) {
    const m = text.match(wordRe(w));
    if (m && !wordRe(w).test(source)) found.add(m[0]);
  }
  for (const m of text.matchAll(/(?<![A-Za-z0-9.])\d+(?:[.,]\d+)?(?:\s?(?:fl\s?oz|oz|ml|l|lb|lbs|g|kg|mg|pack|count|ct|cans?|pcs?|pieces?|inch|in|cm|mm|%))?(?![A-Za-z0-9])/gi)) {
    const num = m[0].match(/\d+(?:[.,]\d+)?/)?.[0] ?? m[0];
    if (!new RegExp(`(?<![0-9])${escapeRe(num)}(?![0-9])`).test(source)) found.add(m[0].trim());
  }
  return Array.from(found);
}

export type GuardOutcome = { result: AiResult; failures: GuardFailure[] };

export function runGuardrail(
  input: AiResult,
  normFailures: GuardFailure[],
  ctx: { sku: Sku; allSkus: Sku[]; built: BuiltPayload },
): GuardOutcome {
  const failures: GuardFailure[] = [...normFailures];
  const { sku, allSkus, built } = ctx;
  const result: AiResult = { ...input, top_edits: [...input.top_edits], open_issues: [...input.open_issues] };

  // 9. Drop no-op edits.
  result.top_edits = result.top_edits.filter((e) => {
    if (sameText(e.proposed_full, e.current)) {
      failures.push({ edit_rank: e.rank, check: "no_change", detail: "Proposed text is identical to the current text; edit dropped." });
      return false;
    }
    return true;
  });

  // 1. Structure.
  if (result.top_edits.length > 3) failures.push({ edit_rank: null, check: "structure", detail: `Returned ${result.top_edits.length} edits; the maximum is 3.` });
  const seenFields = new Set<string>();
  result.top_edits.forEach((e) => {
    if (seenFields.has(e.field)) failures.push({ edit_rank: e.rank, check: "structure", detail: `Field "${e.field}" is used by more than one edit.` });
    seenFields.add(e.field);
    if (e.field === "bullets") {
      if (asList(e.proposed_full).length > 5) failures.push({ edit_rank: e.rank, check: "structure", detail: "Proposed bullets have more than 5 items." });
      if (asList(e.proposed_compliance_only).length > 5) failures.push({ edit_rank: e.rank, check: "structure", detail: "Compliance-only bullets have more than 5 items." });
    }
  });

  // 2. Finding coverage.
  const known = new Set(built.findings.map((f) => f.id));
  const counts = new Map<string, number>();
  const bump = (id: string, rank: number | null) => {
    if (!known.has(id)) {
      failures.push({ edit_rank: rank, check: "unknown_finding", detail: `Unknown finding id "${id}".` });
      return;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  result.top_edits.forEach((e) => e.resolves_finding_ids.forEach((id) => bump(id, e.rank)));
  result.open_issues.forEach((o) => bump(o.finding_id, null));
  result.suspected_false_positives.forEach((o) => bump(o.finding_id, null));
  counts.forEach((n, id) => {
    if (n > 1) failures.push({ edit_rank: null, check: "finding_coverage", detail: `Finding "${id}" appears in more than one place.` });
  });
  built.findings.forEach((f) => {
    if (!counts.has(f.id)) result.open_issues.push({ finding_id: f.id, reason: "Not addressed by the AI response (added automatically).", auto: true });
  });

  // Other brands in the dataset (excluding same-brand siblings).
  const otherBrands = Array.from(
    new Set(allSkus.map((s) => s.brand).filter((b) => b && b.trim().toLowerCase() !== sku.brand.trim().toLowerCase())),
  );
  const source = [sku.title, ...sku.bullets, sku.description].join("\n");
  const competitorsById = new Map(built.competitors.map((c) => [c.sku_id, c]));

  result.top_edits.forEach((e) => {
    // 3. Compliance of proposed text.
    (["proposed_full", "proposed_compliance_only"] as const).forEach((key) => {
      const bad = validateText(e.field, e[key], sku, allSkus).filter(
        (f) => (f.severity === "high" || f.severity === "medium") && !f.rule_id.startsWith("AMZ-IMG") && f.rule_id !== "AMZ-RESTRICT-06",
      );
      bad.forEach((f) =>
        failures.push({ edit_rank: e.rank, check: "compliance", detail: `${key === "proposed_full" ? "Proposed" : "Compliance-only"} text: ${f.rule_id} (${f.severity}) — ${f.message}` }),
      );
    });

    // 4. Rule ids exist.
    e.changes.forEach((c) =>
      c.rule_ids.forEach((id) => {
        if (!ruleById(id)) failures.push({ edit_rank: e.rank, check: "unknown_rule", detail: `Cited rule "${id}" doesn't exist.` });
      }),
    );

    // 5. No other brand in proposed text.
    const proposedAll = maskPlaceholders(`${joined(e.proposed_full)}\n${joined(e.proposed_compliance_only)}`);
    otherBrands.forEach((b) => {
      if (wordRe(b).test(proposedAll)) failures.push({ edit_rank: e.rank, check: "other_brand", detail: `Proposed text mentions another brand: "${b}".` });
    });

    // 6. Competitor refs are real.
    e.changes.forEach((c) =>
      c.competitor_refs.forEach((ref) => {
        const comp = competitorsById.get(ref.sku_id);
        if (!comp) {
          failures.push({ edit_rank: e.rank, check: "competitor_ref", detail: `Competitor "${ref.sku_id}" wasn't one of the competitors sent.` });
          return;
        }
        const hay = [comp.title, ...comp.bullets, comp.description].join("\n").toLowerCase();
        if (!ref.evidence || !hay.includes(ref.evidence.toLowerCase())) {
          failures.push({ edit_rank: e.rank, check: "competitor_evidence", detail: `Evidence "${ref.evidence}" isn't an exact quote from ${comp.brand} (${comp.sku_id}).` });
        }
      }),
    );

    // 7. Invented claims.
    const claims = new Set([...inventedClaims(joined(e.proposed_full), source), ...inventedClaims(joined(e.proposed_compliance_only), source)]);
    claims.forEach((w) => failures.push({ edit_rank: e.rank, check: "unsupported_claim", detail: `Unsupported claim: '${w}' isn't in the source listing.` }));

    // 8. Brand kept exactly in title.
    if (e.field === "title" && sku.brand && !joined(e.proposed_full).includes(sku.brand)) {
      failures.push({ edit_rank: e.rank, check: "brand_name", detail: `Title must include the brand "${sku.brand}" exactly as written.` });
    }
  });

  // Action item rule ids exist.
  result.action_items.forEach((a) =>
    a.rule_ids.forEach((id) => {
      if (!ruleById(id)) failures.push({ edit_rank: null, check: "unknown_rule", detail: `Action item cites unknown rule "${id}".` });
    }),
  );

  // 10. Ranking: high-severity fixes outrank edits that fix nothing.
  const high = new Set(built.findings.filter((f) => f.severity === "high").map((f) => f.id));
  const fixesHigh = (e: Edit) => e.resolves_finding_ids.some((id) => high.has(id));
  const sorted = [...result.top_edits].sort((a, b) => a.rank - b.rank);
  sorted.forEach((e, i) => {
    if (!fixesHigh(e)) return;
    const above = sorted.slice(0, i).find((o) => o.resolves_finding_ids.length === 0);
    if (above) failures.push({ edit_rank: e.rank, check: "ranking", detail: `Edit #${e.rank} fixes a high-severity finding but ranks below edit #${above.rank}, which fixes none.` });
  });

  return { result, failures };
}

export function formatFailuresForRetry(failures: GuardFailure[]) {
  const list = failures.map((f, i) => `${i + 1}. ${f.edit_rank != null ? `Edit #${f.edit_rank}: ` : ""}${f.detail}`).join("\n");
  return `Your previous output failed these checks:\n${list}\nFix them and return corrected JSON only.`;
}
