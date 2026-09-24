Why: eval run 1 found 9 failures; only one (EVAL-07, "deal" in its ordinary sense) was an AI problem. The rest were a checker bug (TITLE-06 vs placeholders), harness bugs (rule-id filtering, text matching), a missing term and an unfailable coverage metric.

---

Two sets of changes in one go. Keep everything else unchanged.

PART A — Fixes from the eval run

1. validateText / AMZ-TITLE-06: a [confirm: …] placeholder whose label mentions size, count, pack, flavor, flavour, color or colour counts as an identifier for AMZ-TITLE-06. Placeholder text is still ignored by all other checks, and edits containing placeholders stay "Blocked: confirm facts" until filled.

2. Eval harness, finding_flagged / finding_not_flagged: filter by rule_ids BEFORE checking text. A finding only counts if its rule_id is in rule_ids (an empty rule_ids array means any rule). Add a unit test: finding_not_flagged with rule_ids ["AMZ-TITLE-06"] and empty text must not fail because of a bullet finding.

3. Eval harness text matching: a finding matches if its evidence contains the assertion text OR the assertion text contains its evidence (case-insensitive). Example: evidence "Customers love" matches text "customers love it".

4. Rule terms: make sure "top rated" and "highly rated" are in ruleTerms.ts under AMZ-RESTRICT-05, match_type "interpretation", for all fields.

5. Eval results: for each failed rules assertion, show the offending finding's rule_id next to its evidence.

6. Coverage metric: count only finding ids the AI itself placed in resolves_finding_ids, open_issues or suspected_false_positives. Findings the app added to open issues automatically don't count as covered. Show "Auto-added to open issues: <n>" as a separate number.

PART B — Prompt v2

Create src/prompts/top3Edits_v2.ts as an exact copy of v1 with only the two changes below. Register it as "v2" with notes "Context check for interpretation findings; fuller descriptions with placeholders". Do not edit v1. Keep CURRENT_PROMPT_VERSION at "v1".

Change 1 — in the FINDINGS section, replace the bullet that starts "For an interpretation finding" with:
"- For each interpretation finding, before editing, read the whole sentence it appears in. If the word is used in its ordinary, non-promotional meaning, do NOT edit it and list it in suspected_false_positives with a one-sentence reason. Examples of ordinary meaning: 'helps dogs deal with separation' (deal = cope), 'never needs batteries' (a plain fact), 'a toy to love' (not a testimonial). Examples of violations: 'incredible deal', 'never breaks', 'dogs love it'."

Change 2 — in HARD CONSTRAINTS ON ALL PROPOSED TEXT, add directly after rule 4:
"4b. When rewriting a description, cover what shoppers need (per AMZ-DESC-02): what the product is, materials, how to use it, care, and sizing or safety notes. Use only facts from the source; where a useful detail is missing, add a placeholder such as [confirm: care instructions] or [confirm: size guidance] instead of leaving the description thin."

When done, confirm: (a) v2 appears in the Eval page's prompt dropdown, (b) the review flow still uses v1, (c) the new unit test passes.
