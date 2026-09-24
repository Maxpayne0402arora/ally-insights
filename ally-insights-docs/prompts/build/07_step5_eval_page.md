Step 5: add an Eval page that measures how well the rules engine and the AI perform on a fixed test set, lets me score a sample by hand, and compares prompt versions. This page is for the product team, not end users. Keep everything from steps 1–4 working. Do not change the system prompt, rule terms or data files.

## 1. Access and structure
- New route `/eval`, linked from a small "Eval" link in the footer (not in the main nav).
- Eval runs are completely separate from review data: they use their own cache namespace (`eval:<runId>:<sku_id>`), never touch approval decisions, review statuses or the batch queue, and don't change the loaded dataset.
- Store runs in IndexedDB (`idb-keyval`), wrapped in try/catch.

## 2. Prompt versions
- Turn `src/prompts/` into a registry: `PROMPTS = { v1: { version: "v1", system: TOP3_EDITS_SYSTEM_PROMPT, notes: "Initial prompt" } }`, with the review flow using a `CURRENT_PROMPT_VERSION` constant (currently "v1").
- New versions (v2, …) will be added later as new files, never by editing v1.

## 3. Eval set upload
- Upload an eval CSV on the Eval page. It uses the same columns and parser as the main upload, plus two optional columns:
  - `scenario`: a short description of what the row tests.
  - `expectations`: a JSON array of assertions (section 4).
  - `eval_type`: "AI", "Rules" or empty (informational; rows with no expectations are benchmark competitors).
- If `expectations` is invalid JSON or has an unknown assertion type, show a row-level error and skip only that row's assertions.
- **Default assertions** apply to every client row that calls the AI, in addition to its own: `guardrail_pass` and `brand_preserved`.
- Show a summary: "67 rows · 50 client SKUs · 14 scenarios · 52 assertions".

## 4. Assertion types
All text comparisons are case-insensitive. "Proposed text" means `proposed_full` of the kept attempt, for every edit (title, bullets joined with newlines, description). `field` is "title", "bullets", "description" or "any".

Rules engine assertions (evaluated on the ORIGINAL listing with `auditSku`, no AI needed):
- `finding_flagged {rule_ids, text}`: a finding exists whose rule_id is any of `rule_ids`, and if `text` is non-empty, its evidence contains `text`. (Measures recall.) Accept a single `rule_id` string too, for backward compatibility. An empty `rule_ids` array means "any rule".
- `finding_not_flagged {rule_ids, text}`: no finding whose rule_id is any of `rule_ids` has evidence containing `text` (if `text` is empty: no finding with those rule ids at all). (Measures precision.)
- `no_findings`: `auditSku` returns no findings at all (a clean control listing).

**Rules-only rows:** if every assertion on a row (including defaults) is a rules engine assertion, don't call the AI for that row. For these rows, the default AI assertions (`guardrail_pass`, `brand_preserved`) are not added. Show them in results as "Rules only".

AI output assertions:
- `not_contains {field, value}`: no proposed text in that field contains `value`. Placeholder text inside `[confirm: …]` is ignored.
- `contains_placeholder {field}`: some proposed text in that field contains a `[confirm: …]` placeholder.
- `edit_field_present {field}`: there is an edit for that field.
- `max_edits {value}` / `min_edits {value}`: number of edits.
- `max_length {field, value}`: proposed text for that field is at most `value` characters. For "bullets", every individual bullet must be at most `value`.
- `no_competitive_changes`: no edit has a change of type "competitive" or any `competitor_refs`.
- `no_new_claims`: the step 2 unsupported-claims check finds nothing in any edit.
- `suspected_fp {text}`: some item in `suspected_false_positives` refers to a finding whose evidence contains `text`.
- `guardrail_pass`: the kept attempt has no guardrail failures.
- `brand_preserved`: if there's a title edit, its proposed text contains the brand exactly as in the source (same casing).
- `compliance_only_unchanged {field}`: if there is an edit for that field, its `proposed_compliance_only` equals `current` (compared per bullet, ignoring surrounding whitespace). Passes if there's no edit for the field.
- `preserves {field, value}`: if there is an edit for that field, its `proposed_full` still contains `value` (case-insensitive). Catches edits that drop useful information. Passes if there's no edit for the field.

If the AI call for a row failed, its AI assertions count as failed, with the reason "Generation failed".

## 5. Running an eval
- Controls: prompt version (dropdown), rows to run (All client rows / Scenarios only / First N), and an optional "Consistency check: run 3 random AI rows 3 times each" (off by default, since it adds 6 calls).
- Runs through the same pipeline as the batch (payload, call, parse, guardrail, one retry, ranking in code), 5 at a time, with progress, Pause and Cancel.
- Record per SKU: every attempt's raw output, guardrail failures per attempt, which attempt was kept, duration, token usage (if returned), and each assertion's result with a reason.
- Each run gets an id, a name (editable, default "v1 · <date time>"), prompt version, model and timestamp.

## 6. Results dashboard (per run)
Show metric cards, each with a one-line explanation in a tooltip:

**Rules engine**
- Expected flags found: `finding_flagged` passed / total (recall on test cases).
- False-positive traps avoided: `finding_not_flagged` and `no_findings` passed / total (precision on test cases).
- Rule coverage: a table with one row per rule id, showing the expected-flag and false-positive-trap results that mention it, so gaps in specific rules are visible.

**AI output quality (automatic)**
- Scenario pass rate: AI assertions passed / total.
- Compliance rate: edits whose kept proposed text has no high or medium `validateText` findings / total edits.
- Unsupported-claim rate: edits flagged by the unsupported-claims check (first attempt) / total edits. Also show how many were fixed by the retry.
- Evidence fabrication rate: invalid `competitor_refs` (first attempt) / total refs.
- Competitor-name leaks: count in final proposed text (should be 0).
- Coverage: findings accounted for (resolved, open or suspected false positive) / total findings.
- First-attempt guardrail pass rate, and pass rate after retry.
- Retry rate, failure rate.
- Duration: average and 95th percentile per SKU. Tokens: average input and output per SKU, if available.
- Consistency (if run): for each repeated SKU, whether the same fields were edited in all 3 runs, and whether all 3 passed the guardrail. Show "Same fields chosen: 2/3 SKUs".

**Tables**
- Scenarios: one row per scenario with the SKU, scenario text, each assertion (pass/fail with reason), and a link to open the full output (before/after, changes, guardrail results, raw JSON).
- All SKUs: sortable by failures, with the same drill-down.

## 7. Human scoring
- A "Score a sample" section: pick 10 edits at random from the run (seeded, so the sample is the same on reload; "Resample" available). Include at least one title, bullets and description edit if they exist.
- For each edit, show before and after side by side, the changes list and the source listing, then four ratings (1–3) with the rubric shown next to them:
  - **Compliant:** 1 = breaks a guideline · 2 = borderline · 3 = fully compliant
  - **Faithful:** 1 = invents facts · 2 = small overreach or wording that implies more than the source · 3 = only facts from the source or placeholders
  - **Better:** 1 = worse or no clearer than the original · 2 = somewhat better · 3 = clearly better
  - **Usable:** 1 = needs a rewrite · 2 = needs light edits · 3 = publish as is
- Plus: "Hallucination spotted?" (yes/no; if yes, a required note quoting the invented text), and a free-text note.
- Show averages per rating, the human-verified hallucination rate (yes / scored), and progress ("7 of 10 scored"). Scores are saved with the run.

## 8. Comparing runs
- Select two runs to compare (e.g. v1 vs v2). Show each metric side by side with the change (green if better, red if worse, noting which direction is better for each metric).
- Scenario diff: scenarios that went fail → pass, pass → fail, or stayed failed.
- Human score averages side by side, if both runs were scored.

## 9. Export
- "Export results (CSV)": one row per SKU per assertion, with run name, prompt version, sku_id, scenario, assertion, result, reason.
- "Export metrics (Markdown)": a summary for the README:
```
## Eval run: <run name>
Prompt <version> · Model <model> · <date> · <n> client SKUs · <n> scenarios

| Metric | Result |
|---|---|
| Expected flags found (rules engine recall) | <x>/<y> |
| False-positive traps avoided (rules engine precision) | <x>/<y> |
| Scenario pass rate | <x>% |
| Compliance rate | <x>% |
| Unsupported-claim rate (first attempt) | <x>% (<n> fixed by retry) |
| Evidence fabrication rate (first attempt) | <x>% |
| Competitor-name leaks | <n> |
| Coverage | <x>% |
| Guardrail pass: first attempt / after retry | <x>% / <y>% |
| Avg / p95 duration per SKU | <a>s / <b>s |
| Human scores (n=<n>): Compliant / Faithful / Better / Usable | <a> / <b> / <c> / <d> |
| Human-verified hallucination rate | <x>/<n> |

### Failed scenarios
- <scenario>: <assertion> — <reason>
```
- If two runs are selected, the Markdown includes the comparison table instead.
