export type Rule = {
  id: string;
  section: string;
  name: string;
  text: string;
};

export const rules: Rule[] = [
  {
    id: "AMZ-TITLE-01",
    section: "Product Title",
    name: "Length",
    text: "Keep titles under 200 characters (including spaces). Shorter, scannable titles (~80–150 characters) generally perform better on mobile.",
  },
  {
    id: "AMZ-TITLE-02",
    section: "Product Title",
    name: "Structure",
    text: "Recommended pattern: `Brand + Model/Key Feature + Product Type + Size/Count/Color (if applicable)`.",
  },
  {
    id: "AMZ-TITLE-03",
    section: "Product Title",
    name: "Capitalization",
    text: "Capitalize the first letter of each word (title case). Do not write in ALL CAPS.",
  },
  {
    id: "AMZ-TITLE-04",
    section: "Product Title",
    name: "No promotional/subjective claims",
    text: 'Do not include phrases like "Best", "#1", "Cheap", "Sale", "Free Shipping", "100% Guaranteed", or excessive punctuation (e.g., "!!!").',
  },
  {
    id: "AMZ-TITLE-05",
    section: "Product Title",
    name: "No keyword stuffing",
    text: "Do not repeat the same keyword multiple times or cram unrelated search terms into the title.",
  },
  {
    id: "AMZ-TITLE-06",
    section: "Product Title",
    name: "Required identifiers",
    text: "Include size, count, color, or flavor when the product has variants, so customers can distinguish this SKU from others.",
  },
  {
    id: "AMZ-BULLET-01",
    section: "Bullet Points",
    name: "Count",
    text: "Use up to 5 bullet points.",
  },
  {
    id: "AMZ-BULLET-02",
    section: "Bullet Points",
    name: "Length",
    text: "Keep each bullet under roughly 200–255 characters; lead with the most important information first.",
  },
  {
    id: "AMZ-BULLET-03",
    section: "Bullet Points",
    name: "Format",
    text: 'Start each bullet with a short capitalized "header" phrase (e.g., "DURABLE DESIGN:") followed by a benefit-oriented sentence. Avoid ending with a period if using a fragment style, but be consistent.',
  },
  {
    id: "AMZ-BULLET-04",
    section: "Bullet Points",
    name: "Focus on benefits, not just features",
    text: 'Explain what the feature means for the customer (e.g., not just "rubber material" but "durable rubber construction stands up to aggressive chewing").',
  },
  {
    id: "AMZ-BULLET-05",
    section: "Bullet Points",
    name: "No pricing, promotions, or shipping claims",
    text: "Do not mention price, discounts, deals, or shipping/guarantee terms in bullets — these belong in seller-controlled merchandising, not content.",
  },
  {
    id: "AMZ-BULLET-06",
    section: "Bullet Points",
    name: "No ALL CAPS sentences",
    text: "Emphasis words may be capitalized (e.g., a short header), but full bullets should not be written in all caps.",
  },
  {
    id: "AMZ-BULLET-07",
    section: "Bullet Points",
    name: "No unverifiable superlative/medical claims",
    text: 'Avoid "best", "cures", "guaranteed", "clinically proven" (unless substantiated with certification), or claims about health/safety benefits that cannot be verified.',
  },
  {
    id: "AMZ-DESC-01",
    section: "Product Description",
    name: "Length",
    text: "Up to approximately 2,000 characters. Use complete sentences and short paragraphs (avoid a single wall of text).",
  },
  {
    id: "AMZ-DESC-02",
    section: "Product Description",
    name: "Content",
    text: 'Expand on bullet points with use-case context, materials, care instructions, sizing guidance, and any relevant compliance/safety notes (e.g., "always supervise pets during use").',
  },
  {
    id: "AMZ-DESC-03",
    section: "Product Description",
    name: "No contact info, external links, or promotional pricing",
    text: 'Do not include phone numbers, email addresses, URLs to external websites, or pricing/promotional language ("buy now," "limited time," "free shipping").',
  },
  {
    id: "AMZ-DESC-04",
    section: "Product Description",
    name: "No HTML in plain listings",
    text: "Do not paste raw HTML tags into the description field.",
  },
  {
    id: "AMZ-DESC-05",
    section: "Product Description",
    name: "Consistent tone",
    text: 'Avoid first-person seller voice ("we are proud to bring you...") — write in an informative, third-person, customer-facing tone.',
  },
  {
    id: "AMZ-IMG-01",
    section: "Images",
    name: "Minimum count",
    text: "Provide a minimum of 1 main image; best practice is 5–7 images including main + lifestyle + infographic + size/scale reference.",
  },
  {
    id: "AMZ-IMG-02",
    section: "Images",
    name: "Main image requirements",
    text: "Pure white (RGB 255,255,255) background, product fills ~85% of frame, no text/logos/watermarks/props on the main image.",
  },
  {
    id: "AMZ-IMG-03",
    section: "Images",
    name: "Resolution",
    text: "At least 1000px on the longest side to enable zoom functionality.",
  },
  {
    id: "AMZ-RESTRICT-01",
    section: "Prohibited / Restricted Content",
    name: "No pricing or promotional claims",
    text: 'No pricing or promotional claims anywhere in title, bullets, or description ("sale," "best price," "cheap," "discount," "free gift").',
  },
  {
    id: "AMZ-RESTRICT-02",
    section: "Prohibited / Restricted Content",
    name: "No time-sensitive claims",
    text: 'No time-sensitive claims ("order now," "while supplies last," "limited time offer").',
  },
  {
    id: "AMZ-RESTRICT-03",
    section: "Prohibited / Restricted Content",
    name: "No guarantees/warranties language",
    text: 'No guarantees/warranties language unless it reflects an actual registered Amazon program (e.g., do not self-declare "100% money-back guarantee").',
  },
  {
    id: "AMZ-RESTRICT-04",
    section: "Prohibited / Restricted Content",
    name: "No unverifiable superlatives",
    text: 'No unverifiable superlatives ("#1 best-selling," "best in the world") without substantiation.',
  },
  {
    id: "AMZ-RESTRICT-05",
    section: "Prohibited / Restricted Content",
    name: "No reviews/testimonials referenced in content",
    text: 'No reviews/testimonials referenced in content ("5-star rated by customers," "customers love it").',
  },
  {
    id: "AMZ-RESTRICT-06",
    section: "Prohibited / Restricted Content",
    name: "No competitor mentions",
    text: "No competitor mentions (brand names of other sellers/products) in title, bullets, or description.",
  },
  {
    id: "AMZ-RESTRICT-07",
    section: "Prohibited / Restricted Content",
    name: "No seller/company contact information or external links.",
    text: "No seller/company contact information or external links.",
  },
  {
    id: "AMZ-KW-01",
    section: "Keyword & Backend Search Terms",
    name: "Backend search terms",
    text: "Backend search terms should complement (not repeat) the front-end title/bullets, stay under the platform's character limit, and avoid duplicate or irrelevant terms. Context only; not assessed.",
  },
];

export const ruleById = (id: string) => rules.find((r) => r.id === id);

export const ruleSections = Array.from(new Set(rules.map((r) => r.section)));
