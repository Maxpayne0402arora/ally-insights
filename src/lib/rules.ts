import type { Finding, Severity, Sku, TextRange } from "@/types/sku";

/* ------------------------------------------------------------------ */
/* Matching helpers                                                    */
/* ------------------------------------------------------------------ */

export type Match = TextRange & { text: string };
export type Term = string | RegExp;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isAlnum = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c);

function termToRegExp(term: Term): RegExp {
  if (term instanceof RegExp) {
    const flags = term.flags.includes("g") ? term.flags : term.flags + "g";
    return new RegExp(term.source, flags.includes("i") ? flags : flags + "i");
  }
  const body = escapeRe(term)
    .replace(/\s+/g, "\\s+")
    .replace(/'/g, "['\u2019]");
  const pattern =
    (isAlnum(term[0]) ? "(?<![A-Za-z0-9])" : "") +
    body +
    (isAlnum(term[term.length - 1]) ? "(?![A-Za-z0-9])" : "");
  return new RegExp(pattern, "gi");
}

/** Every occurrence of every term, as ranges into the original text. Whole words only. */
export function findRanges(text: string, terms: Term[]): Match[] {
  const out: Match[] = [];
  for (const term of terms) {
    const re = termToRegExp(term);
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue;
      const start = m.index ?? 0;
      out.push({ start, end: start + m[0].length, text: m[0] });
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Word-boundary-aware, case-insensitive phrase matcher (matched strings). */
export function findPhrases(text: string, phrases: Term[]): string[] {
  return findRanges(text, phrases).map((m) => m.text);
}

const UNIT_WORDS = ["OZ", "FLOZ", "LB", "LBS", "CT", "PACK", "COUNT", "USA", "GMO", "ML", "KG", "XL", "XXL"];

const STOPWORDS = new Set([
  "with", "from", "your", "this", "that", "they", "them", "than", "then", "have", "into", "over",
  "more", "also", "very", "when", "will", "each", "made", "just", "only", "some", "such", "their",
  "there", "these", "those", "about", "which", "other", "while", "would", "could", "been", "being",
]);

export const IDENTIFIER_RE =
  /(\b\d+(\.\d+)?\s?(fl\s?oz|oz|ml|l|lb|lbs|g|kg|pack|count|ct|cans?|pcs?|pieces?|inch|in|cm)\b)|(\b(pack|count)\s+of\s+\d+\b)|(\b(small|medium|large|x-large|xl|xxl|mini|jumbo)\b)|(\b(flavor|flavour|flavored|flavoured|scent)\b)|(\b(black|white|red|blue|green|pink|grey|gray|purple|yellow|orange)\b)/i;

export const hasIdentifier = (title: string) => IDENTIFIER_RE.test(title);

/** A leading capitalised phrase followed by a colon. " - " / " – " separators are NOT headers. */
export const HEADER_RE = /^\s*[A-Z0-9][A-Za-z0-9 '&/,\-\u2013\u2014()]{0,58}:/;
export const hasBulletHeader = (b: string) => HEADER_RE.test(b);

export type BulletClarity = "Clear" | "Feature-only" | "Needs work";

/**
 * Heuristic verb check: auxiliaries plus common verb endings (-s, -es, -ed, -ing).
 * Intentionally simple — clarity labels are informational, not rule findings.
 */
const VERB_RE = /^(is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|can|could|may|might|must|shall|should|[a-z']+(s|es|ed|ing))$/i;

export const BULLET_CLARITY_TIP =
  "Clear = valid HEADER:, 40–255 characters, and 5–35 words after the header. Feature-only = under 40 characters or no verb after the header. Everything else = Needs work.";

/** Code-computed clarity label for one bullet (no AI). */
export function bulletClarity(bullet: string): { label: BulletClarity; reason: string } {
  const len = bullet.length;
  const header = bullet.match(HEADER_RE);
  const body = (header ? bullet.slice(header[0].length) : bullet).trim();
  const words = body ? body.split(/\s+/) : [];
  const hasVerb = words.some((w) => VERB_RE.test(w.replace(/[^a-z'-]/gi, "")));
  if (len < 40) return { label: "Feature-only", reason: `Under 40 characters (${len}).` };
  if (!hasVerb) return { label: "Feature-only", reason: "No verb after the header — reads as a feature fragment." };
  if (header && len <= 255 && words.length >= 5 && words.length <= 35)
    return { label: "Clear", reason: `Valid HEADER:, ${len} characters, ${words.length} words after the header.` };
  const why: string[] = [];
  if (!header) why.push("no valid HEADER:");
  if (len > 255) why.push(`over 255 characters (${len})`);
  if (words.length < 5) why.push(`only ${words.length} words after the header`);
  if (words.length > 35) why.push(`${words.length} words after the header (over 35)`);
  return { label: "Needs work", reason: why.join("; ") + "." };
}

const CAPS_RE = /(?<![A-Za-z0-9])[A-Z][A-Z'-]{3,}(?![A-Za-z0-9])/g;

/** ALL-CAPS words (4+ letters) as ranges, offset into the original text. */
export function allCapsRanges(text: string, ignore: string[] = [], offset = 0): Match[] {
  const ignoreSet = new Set([...ignore, ...UNIT_WORDS].map((w) => w.toUpperCase().replace(/[^A-Z]/g, "")));
  return Array.from(text.matchAll(CAPS_RE))
    .filter((m) => !ignoreSet.has(m[0].replace(/[^A-Z]/g, "")))
    .map((m) => ({ start: (m.index ?? 0) + offset, end: (m.index ?? 0) + offset + m[0].length, text: m[0] }));
}

export function allCapsWords(text: string, ignore: string[] = []): string[] {
  return allCapsRanges(text, ignore).map((m) => m.text);
}

const truncate = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);

const mk = (
  field: string,
  rule_id: string,
  index: number,
  severity: Severity,
  message: string,
  evidence: string,
  ranges?: TextRange[],
): Finding => ({
  id: `${field}:${rule_id}:${index}`,
  rule_id,
  field,
  severity,
  message,
  evidence,
  match_type: "explicit",
  ...(ranges && ranges.length ? { ranges } : {}),
});

/** One finding per field + rule, listing all occurrences as evidence and keeping every range. */
function fromMatches(
  field: string,
  rule_id: string,
  severity: Severity,
  matches: Match[],
  message: (terms: string[]) => string,
): Finding[] {
  if (!matches.length) return [];
  const seen = new Map<string, string>();
  matches.forEach((m) => {
    const key = m.text.toLowerCase().replace(/\s+/g, " ");
    if (!seen.has(key)) seen.set(key, m.text);
  });
  const terms = Array.from(seen.values());
  const ranges = matches
    .map(({ start, end }) => ({ start, end }))
    .filter((r, i, all) => all.findIndex((o) => o.start === r.start && o.end === r.end) === i);
  return [mk(field, rule_id, 0, severity, message(terms), terms.join(" · "), ranges)];
}

const quoteList = (terms: string[]) => terms.map((t) => `"${t}"`).join(", ");

/* ------------------------------------------------------------------ */
/* Shared restricted-content checks (all text fields)                  */
/* ------------------------------------------------------------------ */

const PROMO_TERMS: Term[] = [
  "free shipping", "free gift", "deal", "discount", /\d*\s?%\s?off(?![A-Za-z0-9])/, "on sale",
  /(?<![A-Za-z0-9])buy(?:\s+now)?\s+and\s+save(?![A-Za-z0-9])/, "save $", "save %", "coupon",
  "great gift", "gift idea",
];
const TIME_SENSITIVE: Term[] = [
  "order now", "order today", "buy now", "limited time", "while supplies last", "don't miss out", "dont miss out",
];
const GUARANTEE_TERMS: Term[] = [
  "money back", "satisfaction guaranteed", "100% satisfaction guaranteed", "100% guaranteed", "warranty",
  "no questions asked", "risk-free", "risk free",
];
const CLAIM_TERMS: Term[] = [
  "best", "#1", "number one", "world's best", "indestructible", "unbreakable", "clinically proven",
  "cures", "guaranteed", "incredible", "amazing deal",
];
const REVIEW_TERMS: Term[] = [
  "5-star rated", "customers love it", "#1 rated", "rated #1", "top rated", "highly rated",
  "five star", "dogs love", "cats love", "loved by",
];
/** REVIEW_TERMS whose findings are marked match_type "interpretation". */
const REVIEW_INTERP = new Set(["top rated", "highly rated"]);

function restrictedChecks(field: string, text: string, sku: Sku, allSkus: Sku[]): Finding[] {
  const otherBrands = Array.from(
    new Set(
      allSkus
        .filter((s) => s.brand && s.brand.toLowerCase() !== (sku.brand ?? "").toLowerCase())
        .map((s) => s.brand),
    ),
  );
  return [
    ...fromMatches(field, "AMZ-RESTRICT-01", "high", findRanges(text, PROMO_TERMS),
      (t) => `Pricing or promotional language (${quoteList(t)}) is not allowed.`),
    ...fromMatches(field, "AMZ-RESTRICT-02", "high", findRanges(text, TIME_SENSITIVE),
      (t) => `Time-sensitive / urgency claim (${quoteList(t)}) is not allowed.`),
    ...fromMatches(field, "AMZ-RESTRICT-03", "high", findRanges(text, GUARANTEE_TERMS),
      (t) => `Guarantee or warranty language (${quoteList(t)}) is not allowed unless it reflects a registered Amazon program.`),
    ...fromMatches(field, "AMZ-RESTRICT-04", "high", findRanges(text, CLAIM_TERMS),
      (t) => `Unverifiable superlative or absolute claim (${quoteList(t)}).`),
    ...fromMatches(field, "AMZ-RESTRICT-05", "high", findRanges(text, REVIEW_TERMS),
      (t) => `Reviews, ratings or testimonials (${quoteList(t)}) must not be referenced.`).map((f) =>
      f.evidence.split(" · ").some((w) => REVIEW_INTERP.has(w.toLowerCase().replace(/[\s-]+/g, " ")))
        ? { ...f, match_type: "interpretation" as const } : f),
    ...fromMatches(field, "AMZ-RESTRICT-06", "high", findRanges(text, otherBrands),
      (t) => `Mentions another brand in the dataset (${quoteList(t)}).`),
  ];
}

/* ------------------------------------------------------------------ */
/* Title                                                               */
/* ------------------------------------------------------------------ */

const TITLE_PROMO: Term[] = ["best", "#1", "cheap", "sale", "free shipping", "guaranteed", "great gift", /!{2,}/];

export function checkTitle(title: string, sku: Sku, allSkus: Sku[], placeholderIdentifier = false): Finding[] {
  const out: Finding[] = [];
  const field = "title";
  const t = title ?? "";

  if (t.length > 200) {
    out.push(mk(field, "AMZ-TITLE-01", 0, "high", `Title is ${t.length} characters — over the 200 character limit.`, truncate(t)));
  } else if (t.length > 150) {
    out.push(mk(field, "AMZ-TITLE-01", 0, "low", `Title is ${t.length} characters — over the recommended 150 characters.`, truncate(t)));
  }

  out.push(...fromMatches(field, "AMZ-TITLE-03", "medium", allCapsRanges(t, [sku.brand ?? ""]),
    (w) => `ALL CAPS word${w.length > 1 ? "s" : ""} ${quoteList(w)} in the title. Use title case.`));

  out.push(...fromMatches(field, "AMZ-TITLE-04", "high", findRanges(t, TITLE_PROMO),
    (w) => `Promotional or subjective term${w.length > 1 ? "s" : ""} ${quoteList(w)} not allowed in the title.`));

  const words = Array.from(t.matchAll(/(?<![A-Za-z0-9])[A-Za-z][A-Za-z'-]{3,}(?![A-Za-z0-9])/g));
  const byWord = new Map<string, Match[]>();
  words.forEach((m) => {
    const w = m[0].toLowerCase();
    if (STOPWORDS.has(w)) return;
    const list = byWord.get(w) ?? [];
    list.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] });
    byWord.set(w, list);
  });
  const repeated = Array.from(byWord.entries()).filter(([, l]) => l.length >= 3);
  if (repeated.length) {
    out.push(...fromMatches(field, "AMZ-TITLE-05", "medium", repeated.flatMap(([, l]) => l),
      () => `Repeated keyword${repeated.length > 1 ? "s" : ""} ${repeated.map(([w, l]) => `"${w}" ×${l.length}`).join(", ")} — looks like keyword stuffing.`));
  }

  if (t && !placeholderIdentifier && !hasIdentifier(t)) {
    out.push(mk(field, "AMZ-TITLE-06", 0, "medium", "Title has no size, count, colour or flavour identifier.", truncate(t)));
  }

  out.push(...restrictedChecks(field, t, sku, allSkus));
  return out;
}

/* ------------------------------------------------------------------ */
/* Bullets                                                             */
/* ------------------------------------------------------------------ */

const BULLET_PROMO: Term[] = ["price", "discount", "deal", "save", "sale", "free shipping"];
const BULLET_CLAIMS: Term[] = ["best", "#1", "never", "cures", "guaranteed", "clinically proven", "indestructible"];

export function checkBullets(bullets: string[], sku: Sku, allSkus: Sku[]): Finding[] {
  const out: Finding[] = [];
  const list = (bullets ?? []).map((b) => (b ?? "").trim()).filter(Boolean);

  if (list.length < 5) {
    out.push(mk("bullets", "AMZ-BULLET-01", 0, "low", `Only ${list.length} of 5 bullet points are used.`, `${list.length} bullets`));
  } else if (list.length > 5) {
    out.push(mk("bullets", "AMZ-BULLET-01", 0, "medium", `${list.length} bullet points — Amazon allows up to 5.`, `${list.length} bullets`));
  }

  list.forEach((b, idx) => {
    const field = `bullet_${idx + 1}`;

    if (b.length > 255) {
      out.push(mk(field, "AMZ-BULLET-02", 0, "medium", `Bullet is ${b.length} characters — over the 255 character guideline.`, truncate(b)));
    }

    const header = b.match(HEADER_RE);
    if (!header) {
      const dash = b.match(/^(.{1,60}?)\s[-\u2013]\s/);
      out.push(mk(field, "AMZ-BULLET-03", 0, "low",
        dash ? 'Leading phrase uses a dash — use a "HEADER:" format.' : 'Bullet does not start with a capitalised "HEADER:" phrase — use a "HEADER:" format.',
        truncate(dash?.[1] ?? b, 80)));
    }

    if (b.length < 40) {
      out.push(mk(field, "AMZ-BULLET-04", 0, "low", "Bullet is very short — likely states a feature without the customer benefit.", b));
    }

    out.push(...fromMatches(field, "AMZ-BULLET-05", "high", findRanges(b, BULLET_PROMO),
      (t) => `Pricing / promotional term${t.length > 1 ? "s" : ""} ${quoteList(t)} not allowed in bullets.`));

    out.push(...fromMatches(field, "AMZ-BULLET-07", "high", findRanges(b, BULLET_CLAIMS),
      (t) => `Unverifiable superlative or absolute claim${t.length > 1 ? "s" : ""} ${quoteList(t)}.`));

    const offset = header ? header[0].length : 0;
    const body = b.slice(offset);
    const letters = body.replace(/[^A-Za-z]/g, "");
    const uppers = body.replace(/[^A-Z]/g, "");
    const capsRatio = letters.length ? uppers.length / letters.length : 0;
    if (capsRatio > 0.5 && letters.length > 0) {
      out.push(mk(field, "AMZ-BULLET-06", 0, "medium", `${Math.round(capsRatio * 100)}% of the bullet body is uppercase.`, truncate(body.trim(), 80)));
    } else {
      out.push(...fromMatches(field, "AMZ-BULLET-06", "medium", allCapsRanges(body, [sku.brand ?? ""], offset),
        (w) => `ALL CAPS word${w.length > 1 ? "s" : ""} ${quoteList(w)} outside the bullet header.`));
    }

    out.push(...restrictedChecks(field, b, sku, allSkus));
  });

  return out;
}

/* ------------------------------------------------------------------ */
/* Description                                                         */
/* ------------------------------------------------------------------ */

const CONTACT_TERMS: Term[] = [
  /\b(?:https?:\/\/|www\.)[^\s]*[^\s.,!?;:)]/,
  /\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/,
  /(?<![A-Za-z0-9])\+?\d[\d\-.\s()]{7,}\d(?![A-Za-z0-9])/,
  /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?![\d])|\$\s?\d+(?:\.\d+)?/,
];

export function checkDescription(description: string, sku: Sku, allSkus: Sku[]): Finding[] {
  const out: Finding[] = [];
  const field = "description";
  const d = description ?? "";

  if (d.length > 2000) {
    out.push(mk(field, "AMZ-DESC-01", 0, "medium", `Description is ${d.length} characters — over the ~2,000 character guideline.`, `${d.length} characters`));
  }

  out.push(...fromMatches(field, "AMZ-DESC-03", "high", findRanges(d, CONTACT_TERMS),
    (t) => `Contact details, external links or pricing (${quoteList(t)}) are not allowed in the description.`));

  out.push(...fromMatches(field, "AMZ-DESC-04", "medium", findRanges(d, [/<\/?[a-z][^>]*>/]),
    () => "Raw HTML tag in description."));

  out.push(...fromMatches(field, "AMZ-DESC-05", "medium", findRanges(d, ["we", "our", "us", "proud to"]),
    (t) => `First-person seller voice (${quoteList(t)}) — write in third person.`));

  out.push(...restrictedChecks(field, d, sku, allSkus));
  return out;
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

export function checkImages(imageUrls: string[]): Finding[] {
  const n = (imageUrls ?? []).filter(Boolean).length;
  if (n === 0) return [mk("images", "AMZ-IMG-01", 0, "high", "No images on this listing.", "0 images")];
  if (n < 5)
    return [mk("images", "AMZ-IMG-01", 0, "medium", `Only ${n} image${n === 1 ? "" : "s"} — best practice is 5–7.`, `${n} images`)];
  return [];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function auditSku(sku: Sku, allSkus: Sku[]): Finding[] {
  return [
    ...checkTitle(sku.title, sku, allSkus),
    ...checkBullets(sku.bullets, sku, allSkus),
    ...checkDescription(sku.description, sku, allSkus),
    ...checkImages(sku.image_urls),
  ];
}

export type ValidatableField = "title" | "bullets" | "description";

/** Run the same deterministic checks on arbitrary proposed text. */
/** Replace "[confirm: …]" placeholders with spaces (same length) so they are never checked. */
export const maskPlaceholders = (s: string) => s.replace(/\[\s*confirm\s*:[^\]]*\]/gi, (m) => " ".repeat(m.length));

/** A [confirm: …] placeholder whose label names a size/count/pack/flavour/colour counts as an identifier for AMZ-TITLE-06. */
export const hasIdentifierPlaceholder = (s: string) =>
  Array.from(s.matchAll(/\[\s*confirm\s*:([^\]]*)\]/gi)).some((m) => /\b(size|count|pack|flavou?r|colou?r)/i.test(m[1] ?? ""));

export function validateText(field: ValidatableField, rawText: string | string[], sku: Sku, allSkus: Sku[]): Finding[] {
  const text = Array.isArray(rawText) ? rawText.map(maskPlaceholders) : maskPlaceholders(rawText);
  if (field === "title") {
    const raw = Array.isArray(rawText) ? rawText.join(" ") : rawText;
    return checkTitle(Array.isArray(text) ? text.join(" ") : text, sku, allSkus, hasIdentifierPlaceholder(raw));
  }
  if (field === "bullets") return checkBullets(Array.isArray(text) ? text : [text], sku, allSkus);
  return checkDescription(Array.isArray(text) ? text.join("\n") : text, sku, allSkus);
}

export function complianceScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) score -= f.severity === "high" ? 15 : f.severity === "medium" ? 8 : 3;
  return Math.max(0, score);
}

export function severityCounts(findings: Finding[]) {
  return {
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };
}
