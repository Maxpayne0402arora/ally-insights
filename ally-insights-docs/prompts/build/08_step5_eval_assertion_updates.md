Why: the compact eval set needed multi-rule assertions, new check types, and rules-only rows that skip the AI (to cut run time in the browser).

---

Update the Eval page assertions. Keep everything else unchanged.
1. finding_flagged and finding_not_flagged now take "rule_ids" (an array; match any). Still accept a single "rule_id" string. For finding_not_flagged with empty text: no finding with those rule ids at all.
2. New assertion "no_findings": auditSku on the original listing returns no findings. Counts toward false-positive traps.
3. New assertion "compliance_only_unchanged {field}": if there's an edit for that field, proposed_compliance_only equals current (per bullet, trimmed); passes if no edit.
4. New assertion "preserves {field, value}": if there's an edit for that field, proposed_full still contains value (case-insensitive); passes if no edit.
5. Rules-only rows: if all of a row's own assertions are rules engine assertions (finding_flagged, finding_not_flagged, no_findings), don't call the AI and don't add the default guardrail_pass/brand_preserved assertions. Label them "Rules only" in results.
6. Add a "Rule coverage" table: one row per rule id with the finding_flagged and finding_not_flagged results that include it.
7. Accept an optional "eval_type" column (informational; don't warn about it).
8. In finding_flagged / finding_not_flagged, an empty rule_ids array means "any rule".
9. max_length with field "bullets" checks each bullet individually.
10. The consistency check runs 3 random AI rows 3 times each, and is off by default.
