## Eval run: v1 · 9/24/2026, 1:31:54 PM
Prompt v1 · Model gpt-6-astra · 9/24/2026, 1:31:54 PM · 21 client SKUs · 21 scenarios

| Metric | Result |
|---|---|
| Expected flags found (rules engine recall) | 40/42 |
| False-positive traps avoided (rules engine precision) | 6/10 |
| Scenario pass rate | 96.3% |
| Compliance rate | 94.3% |
| Unsupported-claim rate (first attempt) | 0% (0 fixed by retry) |
| Evidence fabrication rate (first attempt) | 0% |
| Competitor-name leaks | 0 |
| Coverage | 100% |
| Guardrail pass: first attempt / after retry | 90.5% / 90.5% |
| Avg / p95 duration per SKU | 34.2s / 59.0s |
| Human scores (n=0): Compliant / Faithful / Better / Usable | — / — / — / — |
| Human-verified hallucination rate | 0/0 |

### Failed scenarios
- Sparse listing (1 bullet, no description): placeholders, nothing invented: guardrail_pass — 2 guardrail failure(s): Proposed text: AMZ-TITLE-06 (medium) — Title has no size, count, colour or flavour identifier.
- Title missing size/count + a rule-breaking competitor in the group: use placeholder, don't copy competitor patterns: guardrail_pass — 2 guardrail failure(s): Proposed text: AMZ-TITLE-06 (medium) — Title has no size, count, colour or flavour identifier.
- 'deal' in a non-promotional sense: AI should mark as possible false positive: suspected_fp(text="deal") — No suspected false positive with evidence containing "deal".
- Restricted content in any field + no images: finding_flagged(text="customers love it") — No matching finding with evidence containing "customers love it".
- Precision traps: your/our, rated for, wholesale/sale, sizes vs phone numbers, acronyms, same-brand mention, placeholder text: finding_not_flagged(text="your") — Wrongly flagged: "BPA-FREE CANS: Made in the USA with BPA-free can linings for your peace of mind"
- Precision traps: your/our, rated for, wholesale/sale, sizes vs phone numbers, acronyms, same-brand mention, placeholder text: finding_not_flagged(text="BPA") — Wrongly flagged: "BPA-FREE CANS: Made in the USA with BPA-free can linings for your peace of mind"
- Precision traps: your/our, rated for, wholesale/sale, sizes vs phone numbers, acronyms, same-brand mention, placeholder text: finding_not_flagged(text="USA") — Wrongly flagged: "BPA-FREE CANS: Made in the USA with BPA-free can linings for your peace of mind"
- Precision traps: your/our, rated for, wholesale/sale, sizes vs phone numbers, acronyms, same-brand mention, placeholder text: finding_not_flagged — Wrongly flagged: "BPA-FREE CANS: Made in the USA with BPA-free can linings for your peace of mind"
- Interpretation terms and dash-style header are flagged: finding_flagged(text="top rated") — No matching finding with evidence containing "top rated".