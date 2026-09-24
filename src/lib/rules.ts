import type { Finding, Severity, Sku } from "@/types/sku";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-boundary-aware, case-insensitive phrase matcher. */
export function findPhrases(text: string, phrases: string[]): string[] {
  const hits: string[] = [];
  for (const phrase of phrases) {
    const escaped = escapeRe(phrase).replace(/\s+/g, "\\s+");
    const startsWord = /^[\w#]/.test(phrase) && /^\w/.test(phrase);
    const endsWord = /\w$/.test(phrase);
    const pattern =
      (startsWord ? "(?<![A-Za-z0-9])" : "") +
      escaped +
      (endsWord ? "(?![A-Za-z0-9])" : "");
    const re = new RegExp(pattern, "gi");
    const m = text.match(re);
    if (m) hits.push(...m);
  }
  return hits;
}

const UNIT_WORDS = [
  "OZ",
  "FLOZ",
  "LB",
  "LBS",
  "CT",
  "PACK",
  "COUNT",
  "USA",
  "GMO",
  "ML",
  "KG",
  "XL",
  "XXL",
];

const STOPWORDS = new Set([
  "with",
  "from",
  "your",
  "this",
  "that",
  "they",
  "them",
  "than",
  "then",
  "have",
  "into",
  "over",
  "more",
  "also",
  "very",
  "when",
  "will",
  "each",
  "made",
  "made",
  "just",
  "only",
  "some",
  "such",
  "their",
  "there",
  "these",
  "those",
  "about",
  "which",
  "other",
  "while",
  "would",
  "could",
  "been",
  "being",
]);

export const IDENTIFIER_RE =
  /(\b\d+(\.\d+)?\s?(fl\s?oz|oz|ml|l|lb|lbs|g|kg|pack|count|ct|cans?|pcs?|pieces?|inch|in|cm)\b)|(\b(pack|count)\s+of\s+\d+\b)|(\b(small|medium|large|x-large|xl|xxl|mini|jumbo)\b)|(\b(flavor|flavour|flavored|flavoured|scent)\b)|(\b(black|white|red|blue|green|pink|grey|gray|purple|yellow|orange)\b)/i;

export const hasIdentifier = (title: string) => IDENTIFIER_RE.test(title);

export const HEADER_RE = /^\s*([A-Z0-9][A-Z0-9'&/-]*\s+)+?[A-Z0-9'&/-]*\s*:/;
export const hasBulletHeader = (b: string) =>
  HEADER_RE.test(b) || /^\s*[A-Z0-9][A-Z0-9\s'&/,-]{2,}:/.test(b);

export function allCapsWords(text: string, ignore: string[] = []): string[] {
  const ignoreSet = new Set(
    [...ignore, ...UNIT_WORDS].map((w) => w.toUpperCase()),
  );
  const matches = text.match(/\b[A-Z][A-Z'-]{3,}\b/g) ?? [];
  return matches.filter((w) => !ignoreSet.has(w.replace(/[^A-Z]/g, "")));
}

const mk = (
  field: string,
  rule_id: string,
  index: number,
  severity: Severity,
  message: string,
  evidence: string,
): Finding => ({
  id: `${field}:${rule_id}:${index}`,
  rule_id,
  field,
  severity,
  message,
  evidence,
});

const truncate = (s: string, n = 160) =>
  s.length > n ? `${s.slice(0, n)}…` : s;

/* ------------------------------------------------------------------ */
/* Shared restricted-content checks (any field)                        */
/* ------------------------------------------------------------------ */

const TIME_SENSITIVE = [
  "order now",
  "order today",
  "buy now",
  "limited time",
  "while supplies last",
  "don't miss out",
  "dont miss out",
];
const GUARANTEE_TERMS = [
  "money back",
  "satisfaction guaranteed",
  "100% guaranteed",
  "warranty",
];
const REVIEW_TERMS = [
  "5-star",
  "5 star",
  "rated",
  "customers love",
  "dogs love",
  "reviews",
];

function restrictedChecks(
  field: string,
  text: string,
  sku: Sku,
  allSkus: Sku[],
): Finding[] {
  const out: Finding[] = [];

  findPhrases(text, TIME_SENSITIVE).forEach((hit, i) =>
    out.push(
      mk(
        field,
        "AMZ-RESTRICT-02",
        i,
        "high",
        "Time-sensitive / urgency claim is not allowed in listing content.",
        hit,
      ),
    ),
  );

  findPhrases(text, GUARANTEE_TERMS).forEach((hit, i) =>
    out.push(
      mk(
        field,
        "AMZ-RESTRICT-03",
        i,
        "high",
        "Guarantee or warranty language is not allowed unless it reflects a registered Amazon program.",
        hit,
      ),
    ),
  );

  findPhrases(text, REVIEW_TERMS).forEach((hit, i) =>
    out.push(
      mk(
        field,
        "AMZ-RESTRICT-05",
        i,
        "high",
        "Reviews, ratings or testimonials must not be referenced in listing content.",
        hit,
      ),
    ),
  );

  const otherBrands = Array.from(
    new Set(
      allSkus
        .filter(
          (s) =>
            s.brand &&
            s.brand.toLowerCase() !== (sku.brand ?? "").toLowerCase(),
        )
        .map((s) => s.brand),
    ),
  );
  const brandHits = otherBrands.filter(
    (b) => findPhrases(text, [b]).length > 0,
  );
  brandHits.forEach((b, i) =>
    out.push(
      mk(
        field,
        "AMZ-RESTRICT-06",
        i,
        "high",
        `Mentions another brand in the dataset ("${b}").`,
        b,
      ),
    ),
  );

  return out;
}

/* ------------------------------------------------------------------ */
/* Title                                                               */
/* ------------------------------------------------------------------ */

const TITLE_PROMO = [
  "best",
  "#1",
  "cheap",
  "sale",
  "free shipping",
  "guaranteed",
  "great gift",
];

export function checkTitle(title: string, sku: Sku, allSkus: Sku[]): Finding[] {
  const out: Finding[] = [];
  const field = "title";
  const t = title ?? "";

  if (t.length > 200) {
    out.push(
      mk(
        field,
        "AMZ-TITLE-01",
        0,
        "high",
        `Title is ${t.length} characters — over the 200 character limit.`,
        truncate(t),
      ),
    );
  } else if (t.length > 150) {
    out.push(
      mk(
        field,
        "AMZ-TITLE-01",
        0,
        "low",
        `Title is ${t.length} characters — over the recommended 150 characters.`,
        truncate(t),
      ),
    );
  }

  allCapsWords(t, [sku.brand ?? ""]).forEach((w, i) =>
    out.push(
      mk(
        field,
        "AMZ-TITLE-03",
        i,
        "medium",
        `ALL CAPS word "${w}" in the title. Use title case.`,
        w,
      ),
    ),
  );

  const promoHits = findPhrases(t, TITLE_PROMO);
  if (/!!/.test(t)) promoHits.push("!!");
  promoHits.forEach((hit, i) =>
    out.push(
      mk(
        field,
        "AMZ-TITLE-04",
        i,
        "high",
        `Promotional or subjective term "${hit}" is not allowed in the title.`,
        hit,
      ),
    ),
  );

  const counts = new Map<string, number>();
  (t.toLowerCase().match(/\b[a-z][a-z'-]{3,}\b/g) ?? []).forEach((w) => {
    if (STOPWORDS.has(w)) return;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  });
  Array.from(counts.entries())
    .filter(([, n]) => n >= 3)
    .forEach(([w, n], i) =>
      out.push(
        mk(
          field,
          "AMZ-TITLE-05",
          i,
          "medium",
          `Keyword "${w}" repeated ${n} times — looks like keyword stuffing.`,
          w,
        ),
      ),
    );

  if (t && !hasIdentifier(t)) {
    out.push(
      mk(
        field,
        "AMZ-TITLE-06",
        0,
        "medium",
        "Title has no size, count, colour or flavour identifier.",
        truncate(t),
      ),
    );
  }

  out.push(...restrictedChecks(field, t, sku, allSkus));
  return out;
}

/* ------------------------------------------------------------------ */
/* Bullets                                                             */
/* ------------------------------------------------------------------ */

const BULLET_PROMO = [
  "price",
  "discount",
  "deal",
  "save",
  "sale",
  "free shipping",
];
const BULLET_CLAIMS = [
  "best",
  "#1",
  "never",
  "cures",
  "guaranteed",
  "clinically proven",
  "indestructible",
];

export function checkBullets(
  bullets: string[],
  sku: Sku,
  allSkus: Sku[],
): Finding[] {
  const out: Finding[] = [];
  const list = (bullets ?? []).map((b) => (b ?? "").trim()).filter(Boolean);

  if (list.length < 5) {
    out.push(
      mk(
        "bullets",
        "AMZ-BULLET-01",
        0,
        "low",
        `Only ${list.length} of 5 bullet points are used.`,
        `${list.length} bullets`,
      ),
    );
  } else if (list.length > 5) {
    out.push(
      mk(
        "bullets",
        "AMZ-BULLET-01",
        0,
        "medium",
        `${list.length} bullet points — Amazon allows up to 5.`,
        `${list.length} bullets`,
      ),
    );
  }

  list.forEach((b, idx) => {
    const field = `bullet_${idx + 1}`;

    if (b.length > 255) {
      out.push(
        mk(
          field,
          "AMZ-BULLET-02",
          0,
          "medium",
          `Bullet is ${b.length} characters — over the 255 character guideline.`,
          truncate(b),
        ),
      );
    }

    if (!hasBulletHeader(b)) {
      out.push(
        mk(
          field,
          "AMZ-BULLET-03",
          0,
          "low",
          'Bullet does not start with a capitalised "HEADER:" phrase.',
          truncate(b, 80),
        ),
      );
    }

    if (b.length < 40) {
      out.push(
        mk(
          field,
          "AMZ-BULLET-04",
          0,
          "low",
          "Bullet is very short — likely states a feature without the customer benefit.",
          b,
        ),
      );
    }

    findPhrases(b, BULLET_PROMO).forEach((hit, i) =>
      out.push(
        mk(
          field,
          "AMZ-BULLET-05",
          i,
          "high",
          `Pricing / promotional term "${hit}" is not allowed in bullets.`,
          hit,
        ),
      ),
    );

    findPhrases(b, BULLET_CLAIMS).forEach((hit, i) =>
      out.push(
        mk(
          field,
          "AMZ-BULLET-07",
          i,
          "high",
          `Unverifiable superlative or absolute claim "${hit}".`,
          hit,
        ),
      ),
    );

    const headerMatch = b.match(/^[^:]{0,60}:/);
    const body = headerMatch ? b.slice(headerMatch[0].length) : b;
    const letters = body.replace(/[^A-Za-z]/g, "");
    const uppers = body.replace(/[^A-Z]/g, "");
    const capsRatio = letters.length ? uppers.length / letters.length : 0;
    const strayCaps = allCapsWords(body, [sku.brand ?? ""]);
    if (capsRatio > 0.5 && letters.length > 0) {
      out.push(
        mk(
          field,
          "AMZ-BULLET-06",
          0,
          "medium",
          `${Math.round(capsRatio * 100)}% of the bullet body is uppercase.`,
          truncate(body.trim(), 80),
        ),
      );
    } else if (strayCaps.length) {
      out.push(
        mk(
          field,
          "AMZ-BULLET-06",
          0,
          "medium",
          `ALL CAPS word "${strayCaps[0]}" outside the bullet header.`,
          strayCaps[0] ?? "",
        ),
      );
    }

    out.push(...restrictedChecks(field, b, sku, allSkus));
  });

  return out;
}

/* ------------------------------------------------------------------ */
/* Description                                                         */
/* ------------------------------------------------------------------ */

export function checkDescription(
  description: string,
  sku: Sku,
  allSkus: Sku[],
): Finding[] {
  const out: Finding[] = [];
  const field = "description";
  const d = description ?? "";

  if (d.length > 2000) {
    out.push(
      mk(
        field,
        "AMZ-DESC-01",
        0,
        "medium",
        `Description is ${d.length} characters — over the ~2,000 character guideline.`,
        `${d.length} characters`,
      ),
    );
  }

  const contactHits: string[] = [];
  const url = d.match(/\b(https?:\/\/|www\.)[^\s]+/gi);
  const email = d.match(/\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/g);
  const phone = d.match(/\b(\+?\d[\d\-.\s()]{7,}\d)\b/g);
  const price = d.match(/\$\s?\d[\d,.]*/g);
  [url, email, phone, price].forEach((m) => m && contactHits.push(...m));
  contactHits.forEach((hit, i) =>
    out.push(
      mk(
        field,
        "AMZ-DESC-03",
        i,
        "high",
        "Contact details, external links or pricing are not allowed in the description.",
        hit,
      ),
    ),
  );

  const html = d.match(/<\/?[a-z][^>]*>/gi);
  (html ?? []).forEach((hit, i) =>
    out.push(
      mk(field, "AMZ-DESC-04", i, "medium", "Raw HTML tag in description.", hit),
    ),
  );

  findPhrases(d, ["we", "our", "us", "proud to"]).forEach((hit, i) =>
    out.push(
      mk(
        field,
        "AMZ-DESC-05",
        i,
        "medium",
        `First-person seller voice ("${hit}") — write in third person.`,
        hit,
      ),
    ),
  );

  out.push(...restrictedChecks(field, d, sku, allSkus));
  return out;
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

export function checkImages(imageUrls: string[]): Finding[] {
  const n = (imageUrls ?? []).filter(Boolean).length;
  if (n === 0)
    return [
      mk("images", "AMZ-IMG-01", 0, "high", "No images on this listing.", "0 images"),
    ];
  if (n < 5)
    return [
      mk(
        "images",
        "AMZ-IMG-01",
        0,
        "medium",
        `Only ${n} image${n === 1 ? "" : "s"} — best practice is 5–7.`,
        `${n} images`,
      ),
    ];
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
export function validateText(
  field: ValidatableField,
  text: string | string[],
  sku: Sku,
  allSkus: Sku[],
): Finding[] {
  if (field === "title")
    return checkTitle(Array.isArray(text) ? text.join(" ") : text, sku, allSkus);
  if (field === "bullets")
    return checkBullets(Array.isArray(text) ? text : [text], sku, allSkus);
  return checkDescription(
    Array.isArray(text) ? text.join("\n") : text,
    sku,
    allSkus,
  );
}

export function complianceScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) {
    score -= f.severity === "high" ? 15 : f.severity === "medium" ? 8 : 3;
  }
  return Math.max(0, score);
}

export function severityCounts(findings: Finding[]) {
  return {
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };
}
