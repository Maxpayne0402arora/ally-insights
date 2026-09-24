Why: testing on bubly (COMP-SPW-103) showed valid headers with commas, digits and hyphens ("ZERO CALORIES, ZERO SUGAR:", "12 PACK OF 12 FL OZ CANS:", "NON-GMO INGREDIENTS:") flagged as ALL CAPS sentences. The AI then rewrote three compliant bullets and dropped the pack size.

---

Fix three issues found in testing. Keep everything else unchanged.

1. Bullet header detection (rules engine): a header is the text before the first colon if it is 2–60 characters and contains no lowercase letters. It may include letters, digits, spaces, commas, hyphens, ampersands, slashes, apostrophes and periods (e.g. "ZERO CALORIES, ZERO SUGAR:", "12 PACK OF 12 FL OZ CANS:", "NON-GMO INGREDIENTS:", "BPA-FREE & DISHWASHER SAFE:"). Header text is exempt from ALL CAPS checks. Add these as test cases in rules.test.ts, each expecting no AMZ-BULLET-06 finding and no AMZ-BULLET-03 finding.

2. Compliance-only must be minimal (guardrail check 11): for each edit, compare proposed_compliance_only with current, per bullet or sentence. Any bullet/sentence that changed must contain the evidence of at least one finding in resolves_finding_ids. If an unflagged bullet/sentence changed, record a failure "Compliance-only version changed text that had no finding: <text>".

3. Summary: when an edit was accepted as Compliance-only, list only its compliance changes under "Why" (omit competitive changes). When the SKU is a competitor, title the summary "Content analysis: <Brand> (<sku_id>)" and label the approved-changes section "Suggested changes" with a note: "This is a competitor listing; changes are for analysis only."

After fixing, re-run bubly (COMP-SPW-103): expect no edit to bullets 1, 3 or 4 unless another finding applies.
