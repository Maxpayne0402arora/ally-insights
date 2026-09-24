Step 4: batch recommendations for client SKUs, a paginated review queue, bulk actions and exports. Real users review hundreds or thousands of SKUs, so recommendations must be generated in the background right after upload, not one at a time. Keep everything from steps 1–3 working. Do not change the system prompt, rule terms or data files.

## 1. Scope: client SKUs only
- Batch generation runs ONLY for SKUs with `is_client = true`. Competitor SKUs are benchmarks and are never queued.
- Competitor reports keep a manual "Generate recommendations" button (no automatic generation on open for competitors; remove the step 3 two-second auto-start for them).
- For client SKUs, the batch queue replaces the step 3 two-second auto-start.

## 2. Batch queue (`BatchProvider`, app-level context)
**Start**
- When a dataset is loaded (upload or sample), enqueue every client SKU that doesn't already have a cached result for its cache key (`${datasetId}:${sku_id}:${promptVersion}`), and start automatically.
- **Order: worst first.** Sort by compliance score ascending, then by number of high-severity findings descending, then by sku_id.

**Run**
- At most 5 requests in flight at once. When one finishes, start the next in the queue.
- Reuse the full step 2 pipeline for each SKU (payload, call, parse, guardrail, one retry, ranking in code), and cache each result as it completes.
- **429 (rate limit):** pause the whole queue and retry that SKU after 5 s, then 15 s, then 45 s. After the third failure, mark it Failed and continue.
- **402 (credits exhausted):** pause the whole queue and show "AI credits have run out. Batch paused." with Resume.
- **Other errors or timeouts:** mark that SKU Failed (with the error) and continue. Never retry these automatically.
- Update the server function limits for batch use: allow up to 60 requests per minute and 1,000 per hour per client.

**Controls and progress** — a progress bar at the top of the review queue, and a compact version in the top nav while running:
- "Generating recommendations for client SKUs · 12 of 36 ready · 5 in progress · 19 queued · 0 failed · about 4 min left"
- Time left = remaining SKUs × average duration so far ÷ 5.
- Buttons: Pause, Resume, Cancel (cancel keeps finished results and marks the rest "Not generated", with a "Generate remaining" button).
- While a batch is running, warn on tab close ("Recommendations are still being generated. Leaving will pause the batch.").

**Persistence**
- Store results, decisions and queue state in IndexedDB (use the `idb-keyval` package), not localStorage, because 1,000 results won't fit. Keep the dataset itself where it is. All storage calls wrapped in try/catch.
- After a reload with unfinished work, show "Batch paused · 19 SKUs left · Resume" instead of restarting automatically.

**Interactions**
- Opening a report for a Queued client SKU shows "Queued #7" with a "Generate now" button that moves it to the front of the queue.
- If the user dismisses or restores a finding for a SKU with a result, keep the step 3 "Findings changed · Regenerate" banner (never auto-regenerate).
- Replacing the dataset while a batch runs: the replace confirmation also says "The running batch will be cancelled." On confirm, cancel all requests and discard results for the old dataset.

## 3. Review queue ("/skus")
Replace the grouped SKU list with a paginated table.
- Segmented control at the top: "Client SKUs (36)" (default) and "Competitors (14)".
- **Columns (client view):** checkbox, SKU id, brand, title (truncated), group, score (current → projected if all accepted edits are applied), status, edits (count), risk tier counts as small chips (Safe / Review / Blocked), last updated.
- **Statuses:** Queued, Generating, Ready (recommendations ready, no decisions yet), In review (some edits decided), Reviewed (all edits decided), No changes (0 edits recommended), Failed (with a Retry action), Not generated.
- **Filters:** status (multi-select), group, "Has Blocked edits", search (SKU id, brand, title).
- **Sort:** score low→high (default), status, brand, last updated.
- **Pagination:** 25 rows per page by default (25 / 50 / 100 selectable), page number and filters in the URL so refresh and back keep them. Show "Showing 1–25 of 36".
- Clicking a row opens the report.
- Competitor view: the same table without approval columns, and with a "Generate" action per row.

## 4. Bulk actions (on selected rows, or "Select all <n> matching filters")
- **Approve Safe edits:** accepts every pending edit with the "Safe to bulk-approve" tier across the selected SKUs. Review and Blocked edits are never touched. Confirmation dialog: "Accept 23 Safe edits across 14 SKUs. 31 Review and 6 Blocked edits won't be changed." Then a toast with the result.
- **Retry failed:** re-queues the selected Failed SKUs.
- **Generate now:** moves the selected Queued SKUs to the front of the queue.
- **Export:** opens the export dialog (section 6) scoped to the selection.

## 5. Report: working through the queue
- Header: add "Next SKU to review →", which opens the next client SKU in the current queue order (respecting the queue's filters and sort) whose status is Ready or In review. Show "3 left in this view". When none remain: "All caught up in this view."
- When the last pending edit on a SKU is decided, show a small prompt: "SKU reviewed. Next SKU to review →".
- **Reviewer name:** at the first decision in a session, ask once for a reviewer name (stored in localStorage; editable from the top nav). Record it and a timestamp with every decision.
- **Comments:** each edit card gets an optional "Comment for the publisher" field, saved with the decision.
- **Reviewer changes as data:** for every Edited & accepted edit, store both the AI-proposed text and the final text, and show "Changed by reviewer" on the card with a toggle to see what the reviewer changed (word diff between AI proposal and final text).

## 6. Exports (an "Export" button on the review queue, and "Export this SKU" on the summary page)
The export dialog has a scope choice (all client SKUs / selected / current filter) and three formats.

**a. Review export (CSV)** — for internal review and audit. One row per SKU per edit. Columns:
`sku_id, brand, group, field, rank, decision, version, risk_tier, before_text, ai_proposed_text, final_text, changed_by_reviewer, rule_ids, competitor_evidence, user_confirmed_facts, override_reason, reject_reason, comment, reviewer, decided_at, score_before, score_after`
- Bullets are joined with " | " inside one cell.
- SKUs with no edits get one row with field "none" and decision "No changes recommended". Failed or not-generated SKUs get one row with decision "Not generated".

**b. Amazon listing update (CSV)** — changes ready to map to an Amazon upload template. One row per SKU that has at least one accepted edit. Columns:
`sku, update_delete, item_name, bullet_point1, bullet_point2, bullet_point3, bullet_point4, bullet_point5, product_description, ally_changed_fields`
- `sku` = the SKU's `sku_id`; `update_delete` = "PartialUpdate".
- Fields with an accepted edit use the final text. Fields without one are filled with the current text (never left blank, since blanks may clear the field on Amazon depending on the template).
- `ally_changed_fields` lists the changed fields, e.g. "item_name; bullet_point1-5".
- Exclude SKUs with no accepted edits, and never export text containing `[confirm:` (skip that SKU and list it in the dialog).
- Strip any HTML tags; keep line breaks inside the description cell.
- Before download, the dialog shows a notice: "Amazon listing uploads use category-specific templates (or the Listings API), and column names vary by category and account type. Map these columns to your template before uploading. This file assumes sku_id is your seller SKU."

**c. Batch summary (Markdown)** — code-generated from a template (no AI call):
```
# Ally batch review summary
**Date:** <YYYY-MM-DD> · **Data:** <file name> · **Client SKUs:** <n> · **Reviewer(s):** <names>

## Overview
- Recommendations generated: <n> · No changes needed: <n> · Failed or not generated: <n>
- Edits: <accepted> accepted (<edited> edited by reviewer, <overrides> with override), <rejected> rejected, <pending> pending
- Average compliance score: <before> → <after>

## SKUs
| SKU | Brand | Score | Edits accepted | Status |
|---|---|---|---|---|
| <sku_id> | <brand> | <before> → <after> | <n>/<total> | <status> |

## Needs attention
- <sku_id>: <n> Blocked edits · <n> pending · <failed reason>

## Common issues
- <rule id> <rule name>: found in <n> SKUs
```
Then append the per-SKU summary (from step 3) for each SKU with at least one decision.

**CSV rules for both CSV exports:** generate with `Papa.unparse`, quote every field, UTF-8, `\n` line endings. File names: `ally-review-<YYYY-MM-DD>.csv`, `ally-amazon-update-<YYYY-MM-DD>.csv`, `ally-batch-summary-<YYYY-MM-DD>.md`. Disable a format (with a tooltip explaining why) when it would be empty, e.g. no accepted edits.

## 7. Edge cases
- Dataset with no client SKUs: no batch runs; the queue shows "No client SKUs in this file. Mark rows with is_client = true to generate recommendations." Competitors can still be analysed manually.
- A client SKU whose group has no competitors: generated in "guidelines_only" mode (as in step 2).
- The same SKU can never be in flight twice; enqueueing is idempotent.
- The step 1 500-row limit still applies. Keep the UI responsive with 500 rows (paginate; don't render all rows).
- Exports with 500 SKUs must not freeze the page (build the file in chunks, then download).
- All statuses, tiers and progress have text labels, not colour alone.
