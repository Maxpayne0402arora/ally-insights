Update the existing app to handle edge cases and improve the flow. Keep all existing functionality, data and routes. Where the requirements below differ from what is built, follow the requirements below. Do not change the sample data or rules files.

Summary of changes:
1. Upload: more robust parsing, validation and a replace-data confirmation.
2. Rules engine: fewer false positives (allow-lists, tighter patterns), deduplication, same-brand handling.
3. Report: current listing panel with highlights, SKU switcher, dismissible findings, not-found and zero-findings states, capped comparison table.
4. Picker: search, filter, sort.
5. Rule drawer, guidelines drawer and competitor peek instead of page navigation.
6. Persistence, accessibility and mobile fixes.

## Data layer
- A React context `SkuDataProvider` holds: `skus`, `source` ("sample" | "upload" | null), `fileName`, `loadedAt`, `datasetId` (a short hash of the file contents, used later to key cached results), `dismissedFindings` (set of finding ids), and `setDataset(...)`.
- SKU shape: `{ sku_id, is_client, competitor_group, brand, category, title, bullets: string[], description, image_urls: string[] }`.
- On first visit, NO data is loaded. Sample data is loaded only when the user clicks "Use sample data".
- Persist the dataset and dismissed findings to localStorage, all reads and writes wrapped in try/catch. If saving fails (e.g. quota exceeded), keep working in memory and show a one-time notice: "This dataset is too large to keep after a page refresh." If stored data is corrupted or has an unexpected shape, discard it and start with no data.
- Every screen and the rules engine read SKUs from this context. Never import sample data directly outside the context.
- If "/skus" or a report is opened with no data loaded, redirect to "/" with a notice: "Load product data to get started."

## Load data screen
- Show a clear drag-over state and a parsing spinner on the upload zone.

### Parsing (papaparse, header: true, skipEmptyLines: "greedy")
Columns:
- Required: `sku_id`, `brand`, `title`
- Recommended: `category`, `competitor_group`, `is_client`, `bullet_1` … `bullet_5`, `description`, `image_urls`

File-level handling:
- Accept only `.csv` (case-insensitive extension). If the user drops an `.xlsx`/`.xls`/`.numbers` file, show: "Excel files aren't supported yet. Export as CSV (File › Save as › CSV UTF-8) and upload again."
- If several files are dropped, use the first and show "Only one file can be loaded at a time."
- Max 5 MB. Empty file or header-only file → blocking error "This file has no rows."
- Strip a UTF-8 BOM. Let papaparse auto-detect the delimiter (comma, semicolon, tab), and show the detected delimiter in the summary if it isn't a comma.
- If the text contains the Unicode replacement character (�), warn: "Some characters couldn't be read. Save the file as CSV UTF-8 and re-upload."
- Quoted fields with commas or line breaks must parse correctly (papaparse handles this; don't split lines manually).

Header mapping:
- Match headers case-insensitively, trimming whitespace, and treating spaces, hyphens and underscores the same (e.g. "SKU ID", "sku-id", " SKU_ID " all → `sku_id`).
- Duplicate headers → blocking error naming the column.
- Columns `bullet_6` and above → warning "Only 5 bullets are used; extra bullet columns were ignored." (keep bullets 1–5).
- Unrecognised columns → warning listing them (ignored).

Value mapping:
- Trim every value; treat whitespace-only values as empty. Keep original casing (the rules engine needs to detect ALL CAPS).
- Decode common HTML entities (`&amp;`, `&quot;`, `&#39;`, `&nbsp;`) for display, but keep the raw text for the rules engine so HTML-in-description is still detected.
- `sku_id`: trim; duplicates are compared case-insensitively.
- `image_urls`: split on `|`, trim, drop empties. Count only values that start with `http://` or `https://`; others → row warning "N image values aren't valid URLs and weren't counted."
- `bullet_1..5`: keep non-empty ones in order.
- `is_client`: accept true/false, yes/no, 1/0, y/n (case-insensitive). Empty → false. Any other value → false plus a row warning.
- Missing `competitor_group` → use `category`; if both are missing → "Ungrouped".
- Any single field longer than 10,000 characters → truncate to 10,000 for storage and warn (the rules engine still flags the length issue).

### Validation (show results before loading)
- **Blocking errors** (disable "Load data"): unsupported file type; can't be parsed; empty file; a required column missing; duplicate headers; 0 valid rows; more than 500 rows ("Prototype limit is 500 SKUs").
- **Skipped rows** (listed with row numbers): missing `sku_id` or `title`; duplicate `sku_id` (keep the first occurrence).
- **Warnings** (load anyway, listed with row numbers where relevant): no `competitor_group` column (grouped by category instead); a group with only 1 SKU (nothing to benchmark against); no SKU marked as client; a group containing SKUs from more than one category; rows missing description, bullets or images; invalid image values; unrecognised or extra bullet columns; odd `is_client` values; truncated fields; unreadable characters; mostly non-English text ("Guideline checks are English-only; results may be incomplete").
- Summary line, e.g. "8 rows read · 8 valid · 0 skipped · 2 warnings", with an expandable list of errors and warnings. Errors in red, warnings in amber, each with an icon and text (not colour alone).

### Preview and load
- Preview table of valid rows: sku_id, brand, group, Client/Competitor badge, truncated title, # bullets, # images, compliance score. Paginate at 50 rows.
- Buttons: "Load data" (primary) and "Cancel".
- If a dataset is already loaded, "Load data" asks for confirmation: "Replace the current data (<file>, <n> SKUs)? Dismissed findings and any generated recommendations for it will be cleared."
- On load: replace the dataset in context, show a toast ("8 SKUs loaded from <file>"), and go to "/skus".
- "Use sample data" loads the sample immediately (source "sample", file name "Sample data"), with the same replace confirmation if data is already loaded, and goes to "/skus".

## Screen: Select SKU ("/skus")
- Breadcrumbs: "Load data › SKUs".
- Banner at the top: "Showing data from <file name> · <n> SKUs · Change data" (links to "/").
- A search box (matches brand, sku_id, title), a "Clients only" toggle, and a sort control: compliance score low→high (default), high→low, or brand A→Z.
- SKUs grouped by competitor_group, with a count per group. Client SKUs listed first within each group.
- Each row: brand, sku_id, truncated title, "Client" or "Competitor" badge, and the compliance score.
- Any SKU is selectable, including competitors. Clicking opens "/skus/:skuId" (URL-encode the id).
- No matches → "No matching SKUs" with a "Clear filters" button.

## Screen: Report ("/skus/:skuId")
Header:
- Breadcrumbs "Load data › SKUs › <Brand>".
- Brand, title, category, Client/Competitor badge, compliance score (with tooltip).
- A SKU switcher dropdown (grouped by competitor group) and previous/next buttons that move within the current group, so users can move between SKUs without going back.
- If the skuId in the URL doesn't exist in the loaded data, show "SKU not found" with a link back to SKUs.

(a) **Current listing panel**: the selected SKU's full title, bullets, description and image count. Highlight each finding's evidence inline (red = high, amber = medium, grey = low, plus a small severity label so colour isn't the only signal). Hovering a highlight shows the rule id and message. Clicking a finding in the findings list scrolls to and briefly flashes its highlight. Empty fields show "Missing" in grey.

(b) **Comparison table**: the selected SKU vs the other SKUs in the same competitor_group, one column per SKU (selected SKU first and highlighted). Rows:
- Title length (chars), and whether it is in the 80–150 range
- Title includes a size/count/flavor/color identifier (same logic as AMZ-TITLE-06)
- # bullets (of 5)
- Avg bullet length (chars)
- # bullets using "HEADER:" format
- Description length (chars)
- # images (5–7 is best practice)
- # rule findings (high / medium / low)
Colour each cell green/amber/red relative to the guideline and to the best value in the group, with a text value always visible. Label same-brand sibling SKUs as "Same brand" rather than competitors. If the group has more than 5 other SKUs, show the 5 with the highest compliance scores and a "Show all <n>" toggle. The table scrolls horizontally inside its own container on narrow screens.
If the group has no other SKUs, hide the table and show: "No competitors in this group. Showing a guidelines-only audit."

(c) **Findings list**: grouped by field, sorted by severity. Each finding shows severity, message, evidence and a rule-ID chip (opens the rule drawer).
- Each finding has a "Not an issue" action that dismisses it (e.g. a false positive): it moves to a collapsed "Dismissed (n)" section with a "Restore" action, and no longer counts toward the score. Dismissals are saved per dataset.
- A SKU with zero active findings shows a green "No guideline issues found" card.
- Info note: "Images are checked by count only; image content isn't analysed."

(d) A placeholder card: "Top 3 recommended edits — AI step coming next", with a disabled "Generate recommendations" button.

## Rule drawer and guidelines
- Clicking any rule-ID chip opens a right-side drawer (not a page navigation) with the rule id, section, name and full text, plus "Other rules in this section" collapsed below.
- Close with an × button, Esc, or clicking the backdrop. Trap focus while open and return focus to the chip on close. The page underneath keeps its scroll position. On mobile the drawer is full-screen.
- The "Guidelines" nav item opens the same drawer showing all rules grouped by section, with a search box. Keep a `/guidelines` route working for direct links (full page, rules grouped by section, each with an anchor id equal to its rule id; highlight the targeted rule briefly).

## Competitor peek
Clicking a competitor's column header in the comparison table opens a read-only right-side drawer with that competitor's full listing (title, bullets, description, image count) and its findings. Same close behaviour as the rule drawer.

## Rules engine (`src/lib/rules.ts`)
Export `auditSku(sku, allSkus)` returning findings, and `validateText(field, text | string[], sku, allSkus)` that runs the same checks on arbitrary proposed text (title, bullets or description) — this will validate AI output later. Both are pure functions with no UI dependencies.

Finding shape: `{ id, rule_id, field (title | bullet_n | description | images), severity (high | medium | low), message, evidence }`. `id` is stable: `${field}:${rule_id}:${index}` (e.g. `title:AMZ-TITLE-04:0`). `evidence` is the exact offending text. Deduplicate: the same rule on the same evidence in the same field is reported once.

General matching rules:
- Case-insensitive and word-boundary aware ("best" must not match "bestow"; "sale" must not match "wholesale"; "save" must not match "saved" unless listed).
- Ignore text inside `[confirm: …]` placeholders (used later by the AI).
- ALL CAPS allow-list (never flagged): the SKU's own brand name exactly as it appears in the `brand` field; the brand of any SKU in the same group styled that way (e.g. "KONG"); common acronyms and units: BPA, USA, US, UK, USDA, FDA, UV, LED, USB, XS, S, M, L, XL, XXL, OZ, FL, LB, LBS, KG, G, ML, CT, PK, DIY, ID, TV, pH, NSF, AAFCO; any token containing a digit (e.g. "12PK").
- The "HEADER:" part of a bullet (text before the first colon, if it is 2–40 characters) is allowed to be ALL CAPS.

Checks:
- AMZ-TITLE-01 (high): title > 200 chars. (low): title > 150 chars.
- AMZ-TITLE-03 (medium): any ALL-CAPS word of 4+ letters in the title, excluding the allow-list. One finding per title listing all such words as evidence.
- AMZ-TITLE-04 (high): promo/subjective terms in the title: best, #1, cheap, sale, on sale, free shipping, guaranteed, great gift, top rated, hot deal; or two or more consecutive "!" or "?".
- AMZ-TITLE-05 (medium): a content word (4+ letters, not a stopword, not the brand) repeated 3+ times in the title.
- AMZ-TITLE-06 (medium): no size/count/flavor/color identifier in the title. Identifier = a number followed by a unit (oz, fl oz, ml, l, lb, lbs, kg, g, pack, pk, count, ct, pcs, inch, in, cm), "pack of N", "N-pack", a size word (small, medium, large, x-large, xl, mini, giant), or a colour word from a short list.
- AMZ-BULLET-01 (low): fewer than 5 non-empty bullets. (medium): more than 5.
- AMZ-BULLET-02 (medium): bullet > 255 chars.
- AMZ-BULLET-03 (low): bullet doesn't start with a "HEADER:" phrase (2–40 chars before a colon).
- AMZ-BULLET-04 (low): bullet shorter than 40 chars (likely feature-only, no benefit).
- AMZ-BULLET-05 / AMZ-RESTRICT-01 (high): pricing or promotion in bullets: a currency amount ($, €, £, ₹ followed by a number), "% off", discount, deal, "on sale", "buy and save", "save $", "save %", "save now", free shipping, free gift, coupon.
- AMZ-BULLET-06 (medium): outside the header, more than 50% of letters are uppercase, or a non-header ALL-CAPS word of 4+ letters not in the allow-list.
- AMZ-BULLET-07 / AMZ-RESTRICT-04 (high): best, #1, number one, cures, guaranteed, clinically proven, indestructible, unbreakable, world's best. (medium): "never" or "always" used as an absolute product claim (e.g. "never breaks", "always fresh") — message: "Possible unverifiable absolute claim; check it can be substantiated."
- AMZ-DESC-01 (medium): description > 2000 chars.
- AMZ-DESC-03 / AMZ-RESTRICT-07 (high): in the description: a URL (http, https, www., or a domain like name.com/.in/.co), an email address, a phone number (7+ digits in phone format; do NOT match sizes like "16.9 fl oz", "12-pack", years, or model numbers), or a currency amount.
- AMZ-DESC-04 (medium): HTML tags in the description (e.g. `<br>`, `<p>`, `<b>`, `</…>`).
- AMZ-DESC-05 (medium): first-person seller voice: standalone "we", "our", "us", "we're", "we've", or "proud to".
- AMZ-RESTRICT-02 (high, any field): order now, order today, buy now, limited time, limited-time, while supplies last, hurry, don't miss out, act fast.
- AMZ-RESTRICT-03 (high, any field): money back, money-back, satisfaction guaranteed, 100% guaranteed, lifetime guarantee, warranty.
- AMZ-RESTRICT-05 (high, any field): references to reviews or ratings: 5-star, five star, top rated, highly rated, best rated, rated #1, customer reviews, customers love, dogs love, cats love, "loved by". Do NOT flag "rated for" (e.g. "rated for 50 lbs").
- AMZ-RESTRICT-06 (high, any field): the brand name of any OTHER SKU in the loaded dataset, matched as a whole word. Exclude the SKU's own brand and any SKU with the same brand (sibling products). Brands of 3 characters or fewer only match with exact case.
- AMZ-IMG-01 (high): 0 valid images. (medium): fewer than 5 valid images.

Compliance score: start at 100; each high −15, medium −8, low −3; floor 0; dismissed findings don't count. Show a tooltip on the score explaining this formula.

## Design and accessibility
- Clean, professional B2B SaaS look (like an analytics dashboard): white background, neutral greys, one accent colour, clear typography, generous spacing, responsive layout. The page body never scrolls sideways.
- Every interactive element is keyboard reachable with a visible focus state; icon-only buttons have aria-labels; status is never conveyed by colour alone.
- Use empty, loading and error states wherever data may be missing. Never show a blank screen.
