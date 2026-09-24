import Papa from "papaparse";
import type { Sku } from "@/types/sku";

export const REQUIRED_COLUMNS = ["sku_id", "brand", "title"];
export const RECOMMENDED_COLUMNS = [
  "category",
  "competitor_group",
  "is_client",
  "bullet_1",
  "bullet_2",
  "bullet_3",
  "bullet_4",
  "bullet_5",
  "description",
  "image_urls",
];
export const KNOWN_COLUMNS = [...REQUIRED_COLUMNS, ...RECOMMENDED_COLUMNS];

export const MAX_ROWS = 500;
export const MAX_BYTES = 5 * 1024 * 1024;

export type ParseResult = {
  skus: Sku[];
  rowsRead: number;
  errors: string[];
  skipped: string[];
  warnings: string[];
};

const norm = (h: string) => h.trim().toLowerCase();

function toBool(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return ["true", "yes", "1", "y"].includes(s);
}

export function csvTemplate(): string {
  const headers = KNOWN_COLUMNS.join(",");
  const example = [
    "CIQ-EXAMPLE-001",
    "YourBrand",
    '"YourBrand Stainless Steel Water Bottle, 24 oz, Matte Black"',
    '"Sports & Outdoors > Hydration > Water Bottles"',
    "water_bottles",
    "true",
    '"KEEPS DRINKS COLD: Double-wall vacuum insulation keeps drinks cold for 24 hours"',
    '"LEAK-PROOF LID: Threaded cap seals tight so your bag stays dry"',
    '"EASY TO CLEAN: Wide mouth fits standard ice cubes and a bottle brush"',
    '"DURABLE FINISH: Powder-coated exterior resists scratches and slipping"',
    '"FITS CUP HOLDERS: Tapered base fits most car and gym cup holders"',
    '"A 24 oz insulated stainless steel bottle designed for everyday hydration at work, the gym, or on the trail."',
    "https://example.com/img-1.jpg|https://example.com/img-2.jpg",
  ].join(",");
  return `${headers}\n${example}\n`;
}

export function parseCsv(text: string): ParseResult {
  const errors: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => norm(h),
  });

  if (parsed.errors.length && !parsed.data.length) {
    errors.push(`The file could not be parsed: ${parsed.errors[0]?.message}`);
    return { skus: [], rowsRead: 0, errors, skipped, warnings };
  }

  const headers = (parsed.meta.fields ?? []).map(norm);
  const missingRequired = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missingRequired.length) {
    errors.push(`Missing required column(s): ${missingRequired.join(", ")}`);
  }

  const extras = headers.filter((h) => h && !KNOWN_COLUMNS.includes(h));
  if (extras.length)
    warnings.push(`Unrecognised column(s) ignored: ${extras.join(", ")}`);

  const hasGroupCol = headers.includes("competitor_group");
  if (!hasGroupCol)
    warnings.push("No competitor_group column — SKUs grouped by category instead.");

  const rows = parsed.data;
  if (rows.length > MAX_ROWS) {
    errors.push(`Prototype limit is 500 SKUs (file has ${rows.length} rows).`);
  }

  const skus: Sku[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const rowNo = i + 2; // header is row 1
    const get = (k: string) => (row[k] ?? "").toString().trim();
    const sku_id = get("sku_id");
    const title = get("title");

    if (!sku_id || !title) {
      skipped.push(`Row ${rowNo}: missing ${!sku_id ? "sku_id" : "title"}`);
      return;
    }
    if (seen.has(sku_id.toLowerCase())) {
      skipped.push(`Row ${rowNo}: duplicate sku_id "${sku_id}" (first kept)`);
      return;
    }
    seen.add(sku_id.toLowerCase());

    const category = get("category");
    const group = get("competitor_group") || category || "Ungrouped";
    const bullets = [1, 2, 3, 4, 5]
      .map((n) => get(`bullet_${n}`))
      .filter(Boolean);
    const image_urls = get("image_urls")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const description = get("description");

    const gaps: string[] = [];
    if (!description) gaps.push("description");
    if (!bullets.length) gaps.push("bullets");
    if (!image_urls.length) gaps.push("images");
    if (gaps.length)
      warnings.push(`Row ${rowNo} (${sku_id}): missing ${gaps.join(", ")}`);

    skus.push({
      sku_id,
      is_client: toBool(row["is_client"]),
      competitor_group: group,
      brand: get("brand"),
      category,
      title,
      bullets,
      description,
      image_urls,
    });
  });

  if (!skus.length && !errors.length)
    errors.push("No valid rows found in this file.");

  const groups = new Map<string, number>();
  skus.forEach((s) =>
    groups.set(s.competitor_group, (groups.get(s.competitor_group) ?? 0) + 1),
  );
  groups.forEach((n, g) => {
    if (n === 1)
      warnings.push(`Group "${g}" has only 1 SKU — nothing to benchmark against.`);
  });
  if (skus.length && !skus.some((s) => s.is_client))
    warnings.push("No SKU is marked as the client listing (is_client).");

  return { skus, rowsRead: rows.length, errors, skipped, warnings };
}
