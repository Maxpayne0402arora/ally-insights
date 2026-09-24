## Eval run: v1 · 9/24/2026, 3:12:27 PM
Prompt v1 · Model gpt-6-astra · 9/24/2026, 3:12:27 PM · 21 client SKUs · 21 scenarios

| Metric | Result |
|---|---|
| Expected flags found (rules engine recall) | 42/42 |
| False-positive traps avoided (rules engine precision) | 5/10 |
| Scenario pass rate | 97.5% |
| Compliance rate | 97.1% |
| Unsupported-claim rate (first attempt) | 0% (0 fixed by retry) |
| Evidence fabrication rate (first attempt) | 0% |
| Competitor-name leaks | 0 |
| Coverage | 100% |
| Auto-added to open issues | 0 |
| Guardrail pass: first attempt / after retry | 95.2% / 95.2% |
| Avg / p95 duration per SKU | 30.6s / 52.3s |
| Human scores (n=0): Compliant / Faithful / Better / Usable | — / — / — / — |
| Human-verified hallucination rate | 0/0 |

### Failed scenarios
- 'deal' in a non-promotional sense: AI should mark as possible false positive: suspected_fp(text="deal") — No suspected false positive with evidence containing "deal".
- Over-limit listing (title >200, bullet >255, description >2,000): rewrite within limits: guardrail_pass — 1 guardrail failure(s): Proposed text: AMZ-BULLET-06 (medium) — ALL CAPS words "BETWEEN-USE", "CARE" outside the bullet header.
- Precision traps: your/our, rated for, wholesale/sale, sizes vs phone numbers, acronyms, same-brand mention, placeholder text: finding_not_flagged(text="your") — Wrongly flagged: [AMZ-BULLET-03] "BPA-FREE CANS: Made in the USA with BPA-free can linings for your peace of mind"
- Precision traps: your/our, rated for, wholesale/sale, sizes vs phone numbers, acronyms, same-brand mention, placeholder text: finding_not_flagged(text="rated for") — Wrongly flagged: [AMZ-RESTRICT-05] "rated"
- Precision traps: your/our, rated for, wholesale/sale, sizes vs phone numbers, acronyms, same-brand mention, placeholder text: finding_not_flagged(text="BPA") — Wrongly flagged: [AMZ-BULLET-03] "BPA-FREE CANS: Made in the USA with BPA-free can linings for your peace of mind"
- Precision traps: your/our, rated for, wholesale/sale, sizes vs phone numbers, acronyms, same-brand mention, placeholder text: finding_not_flagged(text="USA") — Wrongly flagged: [AMZ-BULLET-03] "BPA-FREE CANS: Made in the USA with BPA-free can linings for your peace of mind"
- Precision traps: your/our, rated for, wholesale/sale, sizes vs phone numbers, acronyms, same-brand mention, placeholder text: finding_not_flagged — Wrongly flagged: [AMZ-BULLET-03] "BPA-FREE CANS: Made in the USA with BPA-free can linings for your peace of mind"