Why: eval run 2 showed the rule-id filter still broken (it read only the singular rule_id), rules-only rows still calling the AI (about a third of run time), and two real rules false positives.

---

Fix issues from eval run 2. Keep everything else unchanged.

1. Eval harness, rule filter: finding_flagged / finding_not_flagged must read "rule_ids" (array) from the expectations JSON, and also accept "rule_id" (string). Filter findings by rule id BEFORE matching text; an empty rule_ids array means any rule. Replace the unit test with one using the exact RULE-05 case: finding_not_flagged {"rule_ids":["AMZ-DESC-05"],"text":"your"} must PASS when the only finding is an AMZ-BULLET-03 finding whose evidence contains "your".

2. Rules-only rows must not call the AI: if every assertion in a row's own expectations is finding_flagged, finding_not_flagged or no_findings, skip generation entirely and do not add the default guardrail_pass / brand_preserved assertions. The run header should report "<n> AI rows · <n> rules-only rows".

3. Header detection: detect the header on the raw bullet text BEFORE applying the ALL-CAPS acronym allow-list. Allowed header characters also include en/em dashes (– —) and parentheses. Add tests: "BPA-FREE CANS: Made in the USA with BPA-free can linings" and "EASY CARE (BETWEEN USES): Rinse and air dry" → no AMZ-BULLET-03 or AMZ-BULLET-06 finding.

4. AMZ-RESTRICT-05: never match "rated" on its own. Only match the listed phrases (5-star rated, customers love it, #1 rated, rated #1, top rated, highly rated, five star, dogs love, cats love, loved by). "rated for …" must never match. Add a test with "rated for storage up to 12 months".
