Eval page update for the held-out hard test set. Keep everything else unchanged. Do not change the system prompts, rules or rule terms.

1. New optional column `eval_set` (e.g. "held-out"). In the results dashboard, add a filter "Eval set" and show every metric per eval set as well as overall. In the run comparison, compare per eval set.

2. New assertion types:
- `edit_field_absent {field}`: there is NO edit for that field.
- `contains_placeholder {field, labels?}`: existing type; if `labels` is given, at least one `[confirm: …]` placeholder in that field must have a label containing one of the given words (case-insensitive).
- `no_competitor_copy {min_words}`: no sequence of `min_words` or more consecutive words from any competitor listing sent in the payload (title, bullets, description) appears in any proposed text. Compare lowercase words with punctuation removed. On failure, show the copied phrase and the competitor.
- `numbers_from_source`: every number in the proposed text (outside `[confirm: …]` placeholders) appears somewhere in the selected SKU's original title, bullets or description. Normalise trailing zeros ("16.90" equals "16.9"). On failure, list the new numbers.
- `human_check {note}`: not evaluated automatically. Show it as "Needs human check" with the note, and never count it as passed or failed.

3. Human scoring: always include in the sample every edit from a row that has a `human_check` assertion, then fill the rest of the sample (up to 10) at random. Show the `human_check` note above that edit's rating form, and add a "Check passed?" yes/no to the form for those edits. Report human-check results as "Human checks passed: x/y".

4. Rules-only rows: a row whose own assertions are only rules assertions (finding_flagged, finding_not_flagged, no_findings) still skips the AI call, regardless of eval_set.

5. Metrics Markdown export: add a line per eval set ("held-out: scenario pass rate x%, n assertions"), and a "Human checks passed" line.
