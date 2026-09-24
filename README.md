# Ally Insights

Build a web app called "Ally – Competitor Content Intelligence". Ally is CommerceIQ's AI teammate; this is one of its skills. It helps a brand or e-commerce manager compare an Amazon listing (SKU) against competitor SKUs, find content gaps and guideline violations, and later get compliant content recommendations.

The user flow has 3 steps: 1 · Load data → 2 · Select SKU → 3 · Review & approve.

In THIS step, build the upload flow, the SKU picker, the report screen, the guidelines page and a deterministic rules engine. NO AI/LLM calls yet — those come in a later step.

1. Tech and structure

React + TypeScript + Tailwind (your defaults are fine). Use papaparse for CSV parsing.

Put the sample data below in src/data/sampleSkus.ts and the rules in src/data/rules.ts exactly as given. Do not invent or modify SKUs or rules.

Put all checks in src/lib/rules.ts as pure functions, so they can be reused later to validate AI-generated text.

Routes: "/" = Load data, "/skus" = Select SKU, "/skus/:skuId" = report, "/guidelines" = guidelines.

Top nav: "Ally · Competitor Content Intelligence" on the left; "1 · Load data", "2 · Select SKU", "Guidelines" on the right. "2 · Select SKU" is disabled until data is loaded.

Show a simple 3-step progress indicator (Load data → Select SKU → Review & approve) at the top of the Load data, Select SKU and report screens, highlighting the current step.

2. Data layer

A React context SkuDataProvider holds: skus, source ("sample" | "upload" | null), fileName, loadedAt, and setDataset(...).

SKU shape: { sku_id, is_client, competitor_group, brand, category, title, bullets: string[], description, image_urls: string[] }.

On first visit, NO data is loaded. Sample data is loaded only when the user clicks "Use sample data".

Save the loaded dataset to localStorage (wrapped in try/catch) so a refresh keeps it. If storage is empty or broken, start with no data.

Every screen and the rules engine read SKUs from this context. Never import sample data directly outside the context.

If "/skus" or a report is opened with no data loaded, redirect to "/" with a small notice: "Load product data to get started."

3. Screen: Load data ("/", the landing page)

Header: "Load product data". Subtext: "Upload a CSV of SKUs to compare. Each row is one listing."

If a dataset is already loaded, show a card at the top: "Continue with <file name> · <n> SKUs" with a primary "Continue" button to "/skus", and a hint "or upload a new file below to replace it".

A drag-and-drop zone plus a "Choose file" button. Accept .csv only, max 5 MB.

A secondary button "Use sample data (8 SKUs)" and a "Download CSV template" link that downloads a CSV with the expected headers and one example row.

Parsing (papaparse, header: true, skipEmptyLines: true)

Columns:

Required: sku_id, brand, title

Recommended: category, competitor_group, is_client, bullet_1 … bullet_5, description, image_urls

Mapping:

Match headers case-insensitively and trim whitespace (e.g. "SKU_ID", " Title ").

image_urls is pipe-separated (|); split and drop empty values.

bullet_1..5: keep non-empty ones, in order.

is_client: accept true/false, yes/no, 1/0, Y/N (case-insensitive). Missing → false.

Missing competitor_group → use category; if both missing → "Ungrouped".

Trim all values but keep original casing (the rules engine needs to detect ALL CAPS).

Validation (show results before loading)

Blocking errors (disable "Load data"): not a CSV or can't be parsed; a required column is missing; 0 valid rows; more than 500 rows ("Prototype limit is 500 SKUs").

Skipped rows (listed with row numbers): missing sku_id or title; duplicate sku_id (keep the first).

Warnings (load anyway): no competitor_group column (grouped by category instead); a group with only 1 SKU (nothing to benchmark against); no SKU marked as client; a row missing description, bullets or images; unrecognised extra columns (ignored).

Summary line, e.g. "8 rows read · 8 valid · 0 skipped · 2 warnings", with an expandable list of errors and warnings.

Preview and load

Preview table of valid rows: sku_id, brand, group, Client/Competitor badge, truncated title, # bullets, # images, compliance score (from the rules engine).

Buttons: "Load data" (primary) and "Cancel".

On load: replace the dataset in context, show a toast ("8 SKUs loaded from <file>"), and go to "/skus".

"Use sample data" loads the sample immediately (source "sample", file name "Sample data") and goes to "/skus".

4. Screen: Select SKU ("/skus")

Banner at the top: "Showing data from <file name> · <n> SKUs · Change data" (links to "/").

All SKUs grouped by competitor_group.

Each row: brand, sku_id, truncated title, "Client" or "Competitor" badge, and a compliance score 0–100 from the findings (start at 100; each high −15, medium −8, low −3; floor 0).

Any SKU is selectable, including competitors. Clicking opens "/skus/:skuId".

5. Screen: Report ("/skus/:skuId")

Header: brand, title, category, Client/Competitor badge, compliance score, and a "← Back to SKUs" link.

(a) Comparison table: the selected SKU vs the other SKUs in the same competitor_group, one column per SKU (selected SKU first and highlighted). Rows:

Title length (chars), and whether it is in the 80–150 range

Title includes a size/count/flavor/color identifier (regex: numbers + units like oz, fl oz, pack, count, ct, lb; or size words like small/medium/large; or a flavor word)

bullets (of 5)

Avg bullet length (chars)

bullets using "HEADER:" format (starts with 2+ uppercase words followed by a colon)

Description length (chars)

images (5–7 is best practice)

rule findings (high / medium / low)

Colour each cell green/amber/red relative to the guideline and to the best value in the group. If the group has no other SKUs, hide the table and show: "No competitors in this group. Showing a guidelines-only audit."

(b) Findings list for the selected SKU. Each finding: { id, rule_id, field (title | bullet_n | description | images), severity (high | medium | low), message, evidence (the exact offending text) }. The id is stable: ${field}:${rule_id}:${index} (e.g. title:AMZ-TITLE-04:0). Show a rule-ID chip linking to /guidelines#<rule_id>. Group findings by field. Add an info note: "Images are checked by count only; image content isn't analysed."

(c) A placeholder card: "Top 3 recommended edits — AI step coming next", with a disabled "Generate recommendations" button.

6. Rules engine (src/lib/rules.ts)

Export auditSku(sku, allSkus) returning findings, and validateText(field, text | string[], sku, allSkus) that runs the same checks on arbitrary proposed text (title, bullets or description) — this will validate AI output later.

Checks (case-insensitive, word-boundary aware so "best" doesn't match inside other words):

AMZ-TITLE-01 (high): title > 200 chars. (low): title > 150 chars.

AMZ-TITLE-03 (medium): any ALL-CAPS word of 4+ letters in the title (ignore the SKU's own brand name and units).

AMZ-TITLE-04 (high): promo/subjective terms in the title: best, #1, cheap, sale, free shipping, guaranteed, great gift; or "!!".

AMZ-TITLE-05 (medium): a content word (4+ letters, not a stopword) repeated 3+ times in the title.

AMZ-TITLE-06 (medium): no size/count/flavor/color identifier in the title.

AMZ-BULLET-01 (low): fewer than 5 non-empty bullets. (medium): more than 5.

AMZ-BULLET-02 (medium): bullet > 255 chars.

AMZ-BULLET-03 (low): bullet doesn't start with a "HEADER:" phrase.

AMZ-BULLET-04 (low): bullet shorter than 40 chars (likely feature-only, no benefit).

AMZ-BULLET-05 / AMZ-RESTRICT-01 (high): price, discount, deal, save, sale, free shipping in bullets.

AMZ-BULLET-06 (medium): more than 50% of letters outside the header are uppercase, or a non-header ALL-CAPS word of 4+ letters.

AMZ-BULLET-07 / AMZ-RESTRICT-04 (high): best, #1, never, cures, guaranteed, clinically proven, indestructible.

AMZ-DESC-01 (medium): description > 2000 chars.

AMZ-DESC-03 / AMZ-RESTRICT-07 (high): URL, email, phone number, or $ price in the description.

AMZ-DESC-04 (medium): HTML tags in the description.

AMZ-DESC-05 (medium): first-person seller voice: we, our, us, "proud to".

AMZ-RESTRICT-02 (high, any field): order now, order today, buy now, limited time, while supplies last, don't miss out.

AMZ-RESTRICT-03 (high, any field): money back, satisfaction guaranteed, 100% guaranteed, warranty.

AMZ-RESTRICT-05 (high, any field): 5-star, rated, customers love, dogs love, reviews.

AMZ-RESTRICT-06 (high, any field): the brand name of any OTHER SKU in the currently loaded dataset.

AMZ-IMG-01 (high): 0 images. (medium): fewer than 5 images.

7. Screen: Guidelines ("/guidelines")

Render all rules from rules.ts grouped by section. Each rule has an anchor id equal to its rule id, so chips can deep-link and scroll to it (highlight the targeted rule briefly).

8. Design

Clean, professional B2B SaaS look (like an analytics dashboard): white background, neutral grays, one accent colour, clear typography, generous spacing, responsive layout. Use empty states and loading states wherever data may be missing.

Sample data (src/data/sampleSkus.ts)

[
  {
    "sku_id": "CIQ-DCT-001",
    "is_client": true,
    "competitor_group": "dog_chew_toys",
    "brand": "PawJoy",
    "category": "Pet Supplies > Dog Supplies > Chew Toys",
    "title": "PawJoy Dog Chew Toy Best Durable Tough Indestructible Chew Toys for Aggressive Chewers Large Dogs Puppy Teething Toy Non Toxic Rubber Bone Great Gift!!!",
    "bullets": [
      "SUPER DURABLE - our toy is the BEST on the market and will NEVER break",
      "Great for dogs of all sizes and ages",
      "Made with rubber material",
      "Helps with teeth",
      "Buy now and save!"
    ],
    "description": "Looking for the best chew toy for your dog? PawJoy is proud to bring you our #1 rated chew toy that dogs LOVE! This amazing product is made of durable rubber and is perfect for aggressive chewers. Great gift idea for any dog owner. Order today while supplies last! 100% satisfaction guaranteed or your money back, no questions asked. Free shipping on all orders over $25. Don't miss out on this incredible deal!",
    "image_urls": [
      "https://images.ciq-demo.com/skus/CIQ-DCT-001-1.jpg",
      "https://images.ciq-demo.com/skus/CIQ-DCT-001-2.jpg"
    ]
  },
  {
    "sku_id": "COMP-DCT-101",
    "is_client": false,
    "competitor_group": "dog_chew_toys",
    "brand": "Benebone",
    "category": "Pet Supplies > Dog Supplies > Chew Toys",
    "title": "Benebone Wishbone Durable Dog Chew Toy for Aggressive Chewers, Real Bacon Flavor, Made in USA, Large",
    "bullets": [
      "REAL FLAVOR INFUSED THROUGHOUT: Unlike toys with flavor only on the surface, Benebone infuses real bacon flavor throughout the entire toy so the taste lasts longer"
    ],
    "description": "The Benebone Wishbone is an ergonomically designed dog chew toy shaped to be easy for dogs to hold with their paws. Made in the USA from a tough nylon material, it is designed for powerful chewers. The curved ends make it easy to pick up off the floor. Recommended for large dogs (over 50 lbs). Not for dogs that ingest large pieces of toys.",
    "image_urls": [
      "https://images.ciq-demo.com/skus/COMP-DCT-101-1.jpg",
      "https://images.ciq-demo.com/skus/COMP-DCT-101-2.jpg",
      "https://images.ciq-demo.com/skus/COMP-DCT-101-3.jpg"
    ]
  },
  {
    "sku_id": "COMP-DCT-102",
    "is_client": false,
    "competitor_group": "dog_chew_toys",
    "brand": "Nylabone",
    "category": "Pet Supplies > Dog Supplies > Chew Toys",
    "title": "Nylabone Power Chew Textured Dog Chewing Toy, Chicken Flavor, Large Breed (1 Count)",
    "bullets": [
      "LONG-LASTING CHEW: Durable dog toy is designed for aggressive chewers and helps satisfy your pup's natural urge to chew",
      "PROMOTES DENTAL HEALTH: Textured surface helps clean teeth and reduce plaque and tartar buildup as your dog chews",
      "GREAT TASTE DOGS LOVE: Infused with chicken flavor that dogs find irresistible, encouraging appropriate chewing habits",
      "SAFE FOR LARGE BREEDS: Recommended for dogs 50 lbs and up; always supervise pets with any chew toy"
    ],
    "description": "Nylabone Power Chew toys are engineered for dogs that chew aggressively. The durable material is designed to stand up to tough chewing while the textured surface helps reduce plaque and tartar for better dental health. Infused with a long-lasting chicken flavor, this toy keeps dogs engaged and helps redirect chewing away from furniture and shoes. Available in multiple sizes to match your dog's breed and chew strength. As with any chew toy, supervise your dog during use and replace if the toy becomes damaged.",
    "image_urls": [
      "https://images.ciq-demo.com/skus/COMP-DCT-102-1.jpg",
      "https://images.ciq-demo.com/skus/COMP-DCT-102-2.jpg"
    ]
  },
  {
    "sku_id": "COMP-DCT-103",
    "is_client": false,
    "competitor_group": "dog_chew_toys",
    "brand": "KONG",
    "category": "Pet Supplies > Dog Supplies > Chew Toys",
    "title": "KONG Extreme Dog Toy, Large, Black",
    "bullets": [
      "DURABLE RUBBER FOR TOUGH CHEWERS: Made from KONG's most durable rubber formulation for dogs with strong chewing habits",
      "STUFF WITH TREATS: Hollow center can be filled with KONG treats or snacks to extend playtime and mental stimulation",
      "BOUNCES UNPREDICTABLY: Erratic bounce encourages active play and interactive fetch games",
      "VETERINARIAN RECOMMENDED: Recommended by veterinarians and trainers as a safe outlet for natural chewing instincts",
      "MADE IN THE USA: Manufactured in the USA with high-quality materials"
    ],
    "description": "The KONG Extreme is built for dogs who chew with serious power. Constructed from KONG's toughest rubber compound, it is designed to withstand heavy use over time. The hollow design lets you stuff the toy with treats, peanut butter, or KONG Easy Treat to turn chew time into an engaging mental workout. Recommended for large, powerful chewers. Always supervise dogs during play and replace the toy if it becomes damaged. Available in multiple sizes for dogs of all breeds.",
    "image_urls": [
      "https://images.ciq-demo.com/skus/COMP-DCT-103-1.jpg",
      "https://images.ciq-demo.com/skus/COMP-DCT-103-2.jpg",
      "https://images.ciq-demo.com/skus/COMP-DCT-103-3.jpg"
    ]
  },
  {
    "sku_id": "CIQ-SPW-001",
    "is_client": true,
    "competitor_group": "sparkling_water",
    "brand": "FizzWave",
    "category": "Grocery & Gourmet Food > Beverages > Bottled Beverages > Sparkling Water",
    "title": "FizzWave Sparkling Water Natural Flavor Variety Pack 12 Cans BEST TASTING Zero Calorie Zero Sugar Zero Sodium Naturally Flavored Sparkling Water Drink Cans Pack of 12 CHEAP DEAL",
    "bullets": [
      "Tastes amazing, you will love it",
      "Zero calories",
      "Comes in a pack of 12",
      "Great for parties or everyday",
      "100% GUARANTEED to be the best sparkling water you've ever had or your money back!!!"
    ],
    "description": "FizzWave is here to change the sparkling water game forever! Our cans are packed with flavor and ZERO calories, ZERO sugar. Perfect for anyone on keto, diet, or just trying to be healthy. Cheapest price on Amazon, buy 2 packs and save even more! Great for the whole family. 5 star rated by our customers. Order now before this deal ends!",
    "image_urls": [
      "https://images.ciq-demo.com/skus/CIQ-SPW-001-1.jpg"
    ]
  },
  {
    "sku_id": "COMP-SPW-101",
    "is_client": false,
    "competitor_group": "sparkling_water",
    "brand": "LaCroix",
    "category": "Grocery & Gourmet Food > Beverages > Bottled Beverages > Sparkling Water",
    "title": "LaCroix Sparkling Water, Pamplemousse (Grapefruit), 12 Fl Oz (Pack of 12)",
    "bullets": [
      "NO CALORIES, NO SWEETENERS, NO SODIUM: LaCroix is a zero calorie, sugar free, sodium free sparkling water",
      "NATURALLY ESSENCED: Flavor comes from the essence oils extracted from the named fruit used in each LaCroix flavor",
      "REFRESHING PAMPLEMOUSSE FLAVOR: A crisp grapefruit taste that's perfect on its own or as a mixer",
      "PACK OF 12: Includes twelve 12 fl oz cans for stocking up at home or the office",
      "RECYCLABLE ALUMINUM CANS: Packaged in fully recyclable cans to help reduce environmental impact"
    ],
    "description": "LaCroix Pamplemousse Sparkling Water delivers a crisp, refreshing grapefruit taste with no calories, sweeteners, or sodium. Naturally essenced using the essential oils extracted from the named fruits, LaCroix offers a clean, crisp taste that's become a favorite for those seeking a flavorful alternative to soda and juice. Enjoy it on its own, over ice, or as a mixer in your favorite mocktail or cocktail. Each case includes twelve 12 fl oz recyclable aluminum cans.",
    "image_urls": [
      "https://images.ciq-demo.com/skus/COMP-SPW-101-1.jpg",
      "https://images.ciq-demo.com/skus/COMP-SPW-101-2.jpg"
    ]
  },
  {
    "sku_id": "COMP-SPW-102",
    "is_client": false,
    "competitor_group": "sparkling_water",
    "brand": "Spindrift",
    "category": "Grocery & Gourmet Food > Beverages > Bottled Beverages > Sparkling Water",
    "title": "Spindrift Sparkling Water, Raspberry Lime Flavored, Made with Real Squeezed Fruit, 12 Fl Oz Cans, Pack of 12",
    "bullets": [
      "MADE WITH REAL SQUEEZED FRUIT: Spindrift is the only sparkling water made with real squeezed fruit, not flavor extracts",
      "ONLY 15 CALORIES PER CAN: A light, refreshing option with just 15 calories and 3g of sugar from real fruit",
      "NON-GMO AND VEGAN: Certified non-GMO and suitable for vegan diets",
      "CRISP RASPBERRY LIME TASTE: A tart and refreshing blend of raspberry and lime",
      "PACK OF 12 CANS: Twelve 12 fl oz cans, perfect for stocking your fridge"
    ],
    "description": "Spindrift is made with real squeezed fruit, so you can taste the difference from the very first sip. Unlike sparkling waters made with flavor extracts, Spindrift Raspberry Lime is crafted using real raspberries and limes for a genuinely fruity, refreshing taste. Each can contains only 15 calories and no artificial sweeteners or flavors. Certified non-GMO and vegan-friendly, Spindrift is a great choice for anyone looking for a lightly flavored, better-for-you sparkling beverage. Comes in a pack of twelve 12 fl oz cans.",
    "image_urls": [
      "https://images.ciq-demo.com/skus/COMP-SPW-102-1.jpg",
      "https://images.ciq-demo.com/skus/COMP-SPW-102-2.jpg",
      "https://images.ciq-demo.com/skus/COMP-SPW-102-3.jpg"
    ]
  },
  {
    "sku_id": "COMP-SPW-103",
    "is_client": false,
    "competitor_group": "sparkling_water",
    "brand": "bubly",
    "category": "Grocery & Gourmet Food > Beverages > Bottled Beverages > Sparkling Water",
    "title": "bubly Sparkling Water, Strawberry, 12 fl oz Cans (12 Pack)",
    "bullets": [
      "ZERO CALORIES, ZERO SUGAR: bubly sparkling water is made with no calories, no sweeteners, and no sodium",
      "NATURALLY FLAVORED: Made with natural strawberry flavor for a crisp, refreshing taste",
      "12 PACK OF 12 FL OZ CANS: Convenient multipack for home, work, or on the go",
      "NON-GMO INGREDIENTS: Made with non-GMO ingredients you can feel good about",
      "PAIRS WELL WITH ANY OCCASION: Enjoy on its own or as a mixer for your favorite recipes"
    ],
    "description": "bubly Strawberry sparkling water brings crisp, refreshing flavor with zero calories and zero sugar. Made with natural strawberry flavor and carbonated water, bubly is a simple, feel-good alternative to soda. Each pack includes twelve 12 fl oz cans, making it easy to stock up for the week or bring along to your next gathering. Non-GMO ingredients and no artificial sweeteners.",
    "image_urls": [
      "https://images.ciq-demo.com/skus/COMP-SPW-103-1.jpg",
      "https://images.ciq-demo.com/skus/COMP-SPW-103-2.jpg"
    ]
  }
]


Rules (src/data/rules.ts)

[
  {
    "id": "AMZ-TITLE-01",
    "section": "Product Title",
    "name": "Length",
    "text": "Keep titles under 200 characters (including spaces). Shorter, scannable titles (~80–150 characters) generally perform better on mobile."
  },
  {
    "id": "AMZ-TITLE-02",
    "section": "Product Title",
    "name": "Structure",
    "text": "Recommended pattern: `Brand + Model/Key Feature + Product Type + Size/Count/Color (if applicable)`."
  },
  {
    "id": "AMZ-TITLE-03",
    "section": "Product Title",
    "name": "Capitalization",
    "text": "Capitalize the first letter of each word (title case). Do not write in ALL CAPS."
  },
  {
    "id": "AMZ-TITLE-04",
    "section": "Product Title",
    "name": "No promotional/subjective claims",
    "text": "Do not include phrases like \"Best\", \"#1\", \"Cheap\", \"Sale\", \"Free Shipping\", \"100% Guaranteed\", or excessive punctuation (e.g., \"!!!\")."
  },
  {
    "id": "AMZ-TITLE-05",
    "section": "Product Title",
    "name": "No keyword stuffing",
    "text": "Do not repeat the same keyword multiple times or cram unrelated search terms into the title."
  },
  {
    "id": "AMZ-TITLE-06",
    "section": "Product Title",
    "name": "Required identifiers",
    "text": "Include size, count, color, or flavor when the product has variants, so customers can distinguish this SKU from others."
  },
  {
    "id": "AMZ-BULLET-01",
    "section": "Bullet Points",
    "name": "Count",
    "text": "Use up to 5 bullet points."
  },
  {
    "id": "AMZ-BULLET-02",
    "section": "Bullet Points",
    "name": "Length",
    "text": "Keep each bullet under roughly 200–255 characters; lead with the most important information first."
  },
  {
    "id": "AMZ-BULLET-03",
    "section": "Bullet Points",
    "name": "Format",
    "text": "Start each bullet with a short capitalized \"header\" phrase (e.g., \"DURABLE DESIGN:\") followed by a benefit-oriented sentence. Avoid ending with a period if using a fragment style, but be consistent."
  },
  {
    "id": "AMZ-BULLET-04",
    "section": "Bullet Points",
    "name": "Focus on benefits, not just features",
    "text": "Explain what the feature means for the customer (e.g., not just \"rubber material\" but \"durable rubber construction stands up to aggressive chewing\")."
  },
  {
    "id": "AMZ-BULLET-05",
    "section": "Bullet Points",
    "name": "No pricing, promotions, or shipping claims",
    "text": "Do not mention price, discounts, deals, or shipping/guarantee terms in bullets — these belong in seller-controlled merchandising, not content."
  },
  {
    "id": "AMZ-BULLET-06",
    "section": "Bullet Points",
    "name": "No ALL CAPS sentences",
    "text": "Emphasis words may be capitalized (e.g., a short header), but full bullets should not be written in all caps."
  },
  {
    "id": "AMZ-BULLET-07",
    "section": "Bullet Points",
    "name": "No unverifiable superlative/medical claims",
    "text": "Avoid \"best\", \"cures\", \"guaranteed\", \"clinically proven\" (unless substantiated with certification), or claims about health/safety benefits that cannot be verified."
  },
  {
    "id": "AMZ-DESC-01",
    "section": "Product Description",
    "name": "Length",
    "text": "Up to approximately 2,000 characters. Use complete sentences and short paragraphs (avoid a single wall of text)."
  },
  {
    "id": "AMZ-DESC-02",
    "section": "Product Description",
    "name": "Content",
    "text": "Expand on bullet points with use-case context, materials, care instructions, sizing guidance, and any relevant compliance/safety notes (e.g., \"always supervise pets during use\")."
  },
  {
    "id": "AMZ-DESC-03",
    "section": "Product Description",
    "name": "No contact info, external links, or promotional pricing",
    "text": "Do not include phone numbers, email addresses, URLs to external websites, or pricing/promotional language (\"buy now,\" \"limited time,\" \"free shipping\")."
  },
  {
    "id": "AMZ-DESC-04",
    "section": "Product Description",
    "name": "No HTML in plain listings",
    "text": "Do not paste raw HTML tags into the description field."
  },
  {
    "id": "AMZ-DESC-05",
    "section": "Product Description",
    "name": "Consistent tone",
    "text": "Avoid first-person seller voice (\"we are proud to bring you...\") — write in an informative, third-person, customer-facing tone."
  },
  {
    "id": "AMZ-IMG-01",
    "section": "Images",
    "name": "Minimum count",
    "text": "Provide a minimum of 1 main image; best practice is 5–7 images including main + lifestyle + infographic + size/scale reference."
  },
  {
    "id": "AMZ-IMG-02",
    "section": "Images",
    "name": "Main image requirements",
    "text": "Pure white (RGB 255,255,255) background, product fills ~85% of frame, no text/logos/watermarks/props on the main image."
  },
  {
    "id": "AMZ-IMG-03",
    "section": "Images",
    "name": "Resolution",
    "text": "At least 1000px on the longest side to enable zoom functionality."
  },
  {
    "id": "AMZ-RESTRICT-01",
    "section": "Prohibited / Restricted Content",
    "name": "No pricing or promotional claims",
    "text": "No pricing or promotional claims anywhere in title, bullets, or description (\"sale,\" \"best price,\" \"cheap,\" \"discount,\" \"free gift\")."
  },
  {
    "id": "AMZ-RESTRICT-02",
    "section": "Prohibited / Restricted Content",
    "name": "No time-sensitive claims",
    "text": "No time-sensitive claims (\"order now,\" \"while supplies last,\" \"limited time offer\")."
  },
  {
    "id": "AMZ-RESTRICT-03",
    "section": "Prohibited / Restricted Content",
    "name": "No guarantees/warranties language",
    "text": "No guarantees/warranties language unless it reflects an actual registered Amazon program (e.g., do not self-declare \"100% money-back guarantee\")."
  },
  {
    "id": "AMZ-RESTRICT-04",
    "section": "Prohibited / Restricted Content",
    "name": "No unverifiable superlatives",
    "text": "No unverifiable superlatives (\"#1 best-selling,\" \"best in the world\") without substantiation."
  },
  {
    "id": "AMZ-RESTRICT-05",
    "section": "Prohibited / Restricted Content",
    "name": "No reviews/testimonials referenced in content",
    "text": "No reviews/testimonials referenced in content (\"5-star rated by customers,\" \"customers love it\")."
  },
  {
    "id": "AMZ-RESTRICT-06",
    "section": "Prohibited / Restricted Content",
    "name": "No competitor mentions",
    "text": "No competitor mentions (brand names of other sellers/products) in title, bullets, or description."
  },
  {
    "id": "AMZ-RESTRICT-07",
    "section": "Prohibited / Restricted Content",
    "name": "No seller/company contact information or external links.",
    "text": "No seller/company contact information or external links."
  },
  {
    "id": "AMZ-KW-01",
    "section": "Keyword & Backend Search Terms",
    "name": "Backend search terms",
    "text": "Backend search terms should complement (not repeat) the front-end title/bullets, stay under the platform's character limit, and avoid duplicate or irrelevant terms. Context only; not assessed."
  }
]

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/02d4f3b4-59a2-40ca-a024-a0891abee208).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
