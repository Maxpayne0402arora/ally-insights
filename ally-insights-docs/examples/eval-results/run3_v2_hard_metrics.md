## Eval run: v2 · 9/24/2026, 3:26:04 PM
Prompt v2 · Model gpt-6-astra · 9/24/2026, 3:26:04 PM · 13 AI rows · 1 rules-only rows · 14 client SKUs · 14 scenarios

| Metric | Result |
|---|---|
| Expected flags found (rules engine recall) | 2/7 |
| False-positive traps avoided (rules engine precision) | 2/4 |
| Scenario pass rate | 100% |
| Compliance rate | 100% |
| Unsupported-claim rate (first attempt) | 8% (2 fixed by retry) |
| Evidence fabrication rate (first attempt) | 0% |
| Competitor-name leaks | 0 |
| Coverage | 100% |
| Auto-added to open issues | 0 |
| Guardrail pass: first attempt / after retry | 84.6% / 100% |
| Avg / p95 duration per SKU | 43.9s / 84.6s |
| Human scores (n=0): Compliant / Faithful / Better / Usable | — / — / — / — |
| Human-verified hallucination rate | 0/0 |

### Failed scenarios
- Subtle promotion and a testimonial that avoid the listed phrases: finding_flagged(rule_ids=[], text="must-have") — No matching finding with evidence matching "must-have".
- Subtle promotion and a testimonial that avoid the listed phrases: finding_flagged(rule_ids=["AMZ-RESTRICT-05"], text="loves it") — No AMZ-RESTRICT-05 finding with evidence matching "loves it".
- Implied superlatives and comparisons with competitors: finding_flagged(rule_ids=[], text="tougher than any") — No matching finding with evidence matching "tougher than any".
- Obfuscated banned phrases (spaced letters, dots, digits for letters, line breaks): finding_flagged(rule_ids=["AMZ-TITLE-04"], text="F R E E") — No AMZ-TITLE-04 finding with evidence matching "F R E E".
- Obfuscated banned phrases (spaced letters, dots, digits for letters, line breaks): finding_flagged(rule_ids=[], text="fr33") — No matching finding with evidence matching "fr33". Closest: [AMZ-BULLET-03] "B.E.S.T. CHEW: The b-e-s-t stick for big chewers"; [AMZ-BULLET-06] "CHEW"; [AMZ-BULLET-07] "guaranteed"
- Brand name contains a banned word ('Best'): must not be flagged or removed: finding_not_flagged(rule_ids=["AMZ-TITLE-04","AMZ-RESTRICT-04","AMZ-BULLET-07"], text="Best Paws") — Wrongly flagged: [AMZ-TITLE-04] "Best"
- Competitor brand that is a common word ('Spark'), plus 'ideal' and 'resale': none should be flagged: finding_not_flagged(rule_ids=["AMZ-RESTRICT-06"], text="spark") — Wrongly flagged: [AMZ-RESTRICT-06] "spark"