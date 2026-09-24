Fix the inline highlighting and make rule matching explicit and testable. Keep everything else unchanged.

## 1. Highlight rendering bug (text is being duplicated)
- For each field, compute ALL match ranges `{start, end, severity, rule_id, match_type, message}` by searching the ORIGINAL text (every occurrence, not only the first).
- Sort ranges by start position. Merge overlapping or touching ranges into one highlight: keep the highest severity; if any merged part is explicit, the highlight is explicit; list every rule id and message in its tooltip.
- Build the output in ONE pass: plain text from the last position to `range.start`, then the highlight for `text.slice(start, end)`, then continue from `end`. Never insert evidence strings; always slice from the original text.
- Safety check: the concatenated plain text of the rendered segments must exactly equal the original field text. If not, render the field without highlights and log an error.

## 2. Matching rules
- Whole words only, treating letters and digits as word characters: "our" must not match inside "your"; "sale" must not match inside "wholesale".
- Case-insensitive, except brands of 3 characters or fewer.
- Currency: match the symbol and number only ("$25", "$25.99"), never trailing punctuation.
- Ignore text inside `[confirm: …]` placeholders.
- Bullet headers: a leading phrase followed by a colon is a header (its ALL CAPS is allowed). A phrase followed by " - " or " – " is NOT a header: flag AMZ-BULLET-03 (low) and check its ALL-CAPS words under AMZ-BULLET-06.

## 3. Rule terms as data: `src/data/ruleTerms.ts`
Move every term-based check out of the matching code into one data file, so the rules are readable and editable without touching logic. Each entry:

```ts
{ term: string | RegExp, rule_id: string, fields: ("title"|"bullets"|"description")[],
  match_type: "explicit" | "interpretation", severity: "high"|"medium"|"low",
  rationale: string }  // rationale required for interpretations
```

- `explicit` = the term (or a direct example of it) appears in the rule's own text.
- `interpretation` = not listed in the rule, but falls under its category. Interpretation findings are one severity lower than the rule's explicit terms.

Load these terms exactly:

| Term(s) | Rule | Fields | Type | Severity | Rationale (interpretations) |
|---|---|---|---|---|---|
| best, #1, cheap, sale, free shipping, 100% guaranteed | AMZ-TITLE-04 | title | explicit | high | |
| two or more consecutive "!" or "?" | AMZ-TITLE-04 | title | explicit | high | |
| best, guaranteed, cures, clinically proven | AMZ-BULLET-07 | bullets | explicit | high | |
| price, discount, deal, shipping, guarantee terms | AMZ-BULLET-05 | bullets | explicit | high | |
| free shipping, buy now, limited time, currency amounts | AMZ-DESC-03 | description | explicit | high | |
| sale, best price, cheap, discount, free gift | AMZ-RESTRICT-01 | all | explicit | high | |
| deal, % off, coupon, buy and save, save $, save %, great gift, gift idea | AMZ-RESTRICT-01 | all | interpretation | medium | Promotional language not listed in the rule's examples |
| order now, while supplies last, limited time offer | AMZ-RESTRICT-02 | all | explicit | high | |
| order today, hurry, don't miss out, act fast, buy now | AMZ-RESTRICT-02 | all | interpretation | medium | Urges immediate purchase, like the listed time-sensitive examples |
| guarantee, guaranteed, warranty, money-back, money back (the rule bans guarantee/warranty language) | AMZ-RESTRICT-03 | all | explicit | high | |
| no questions asked, risk-free | AMZ-RESTRICT-03 | all | interpretation | medium | Implies a guarantee without using the word |
| #1 best-selling, best in the world, #1 | AMZ-RESTRICT-04 | all | explicit | high | |
| best (description only), number one, incredible, amazing, indestructible, unbreakable, world's best | AMZ-RESTRICT-04 | all | interpretation | medium | Unverifiable superlative not listed in the rule's examples |
| never / always used as a product claim ("never breaks") | AMZ-BULLET-07 | bullets, description | interpretation | medium | Absolute claim that may not be verifiable |
| 5-star rated, customers love it | AMZ-RESTRICT-05 | all | explicit | high | |
| #1 rated, rated #1, top rated, highly rated, five star, dogs love, cats love, loved by | AMZ-RESTRICT-05 | all | interpretation | medium | References ratings or customer sentiment like the listed examples |

Non-term checks (lengths, counts, ALL CAPS, repetition, HEADER format, first-person voice, URLs/emails/phones, HTML, images, competitor brands) stay in code and are all `explicit`.

## 4. How interpretations are shown
- **Highlight style:** explicit = solid background fill; interpretation = the same colour as a dashed underline with no fill. Add a two-item legend above the Current listing panel: "Solid: listed in the guidelines · Dashed: our interpretation".
- **Findings list:** interpretation findings carry a small "Interpretation" tag. Their tooltip/detail shows the rationale, e.g. "Not listed in AMZ-RESTRICT-04. Treated as an unverifiable superlative."
- **Counts:** the findings header shows "12 findings · 9 explicit · 3 interpretations".
- **Filter:** a toggle "Include interpretations" (on by default). When off, interpretation findings and highlights are hidden and excluded from the score.
- **Rule drawer:** for any rule, list "Also flagged by interpretation:" with those terms and the rationale, so users can see exactly how each rule is being applied.

## 5. Test cases (create `src/lib/rules.test.ts` with vitest, and make them pass)
Each case: input text, field, and the expected matches (or no match).

Should match:
- title "Best Chew Toy!!!" → "Best" (AMZ-TITLE-04, explicit), "!!!" (AMZ-TITLE-04, explicit)
- description "our #1 rated chew toy" → "#1 rated" as one merged highlight (AMZ-RESTRICT-04 explicit + AMZ-RESTRICT-05 interpretation → shown solid)
- description "Free shipping on all orders over $25." → "Free shipping" (explicit), "$25" (explicit, without the full stop)
- description "Order today while supplies last!" → "Order today" (interpretation), "while supplies last" (explicit)
- description "100% satisfaction guaranteed or your money back, no questions asked" → "guaranteed", "money back" (AMZ-RESTRICT-03 explicit), "no questions asked" (AMZ-RESTRICT-03 interpretation)
- description "Don't miss out on this incredible deal!" → "Don't miss out" (RESTRICT-02 interpretation), "incredible deal" merged (RESTRICT-04 + RESTRICT-01, interpretations)
- description "PawJoy is proud to bring you our toy" → "proud to", "our" (AMZ-DESC-05)
- bullet "SUPER DURABLE - our toy is the BEST on the market and will NEVER break" → "SUPER DURABLE" (AMZ-BULLET-06), "BEST" (AMZ-BULLET-07 explicit), "NEVER break" (AMZ-BULLET-07 interpretation), plus AMZ-BULLET-03 on the bullet
- bullet "Buy now and save!" → one merged highlight "Buy now and save" (RESTRICT-02 + RESTRICT-01 interpretations)

Should NOT match:
- "for your dog" → no match for "our"
- "Rated for dogs up to 50 lbs" → no RESTRICT-05 match
- "Wholesale pricing" → no "sale" match
- "16.9 fl oz, 12-pack" → no phone number match
- "Made with BPA-free rubber in the USA" → no ALL CAPS match (BPA, USA are allow-listed)
- "KONG Classic Dog Toy" (SKU brand KONG) → no ALL CAPS match and no competitor-brand match on its own listing
- "DURABLE DESIGN: Stands up to chewing" → no ALL CAPS match (valid header)
- "[confirm: pack size]" → no match

Rendering:
- Rendering PawJoy's description produces exactly the original 411-character text, with no repeated segments.

## 6. Acceptance check with PawJoy (CIQ-DCT-001)
- Bullet 1 reads exactly "SUPER DURABLE - our toy is the BEST on the market and will NEVER break".
- Bullet 5 reads exactly "Buy now and save!".
- The description appears once. Highlighted: best (dashed), #1 rated (solid), proud to, our (not inside "your"), Great gift (dashed), Order today (dashed), while supplies last (solid), guaranteed and money back (solid), no questions asked (dashed), Free shipping (solid), $25 (solid), Don't miss out (dashed), incredible deal (dashed). "LOVE" is not flagged as ALL CAPS (caps rules apply only to titles and bullets), but "dogs LOVE" is flagged under AMZ-RESTRICT-05 (dashed).
