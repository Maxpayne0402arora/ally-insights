Step 3: restructure the report around recommendations, add approval, and produce the final Markdown summary. Keep everything from steps 1 and 2 working. Do not change the system prompt, rule terms or data files.

## 1. Report layout: fixed header + three tabs
- **Header (always visible, sticky):** breadcrumbs, brand, title, Client/Competitor badge, SKU switcher with previous/next, compliance score, and a one-line summary, e.g. "9 high-risk issues · 3 edits recommended · 1 accepted". The 3-step indicator highlights "Review & approve" on this screen.
- **Tabs:** "Recommendations" (default), "Findings (n)", "Comparison". Store the active tab in the URL (`?tab=findings`) so back/forward and refresh keep it.
- **Recommendations tab:** the AI section from step 2 (summary, strengths, edit cards, suspected false positives, still open, action items), plus the approval controls below.
- **Findings tab:** the Current listing panel with highlights and the findings list from step 1. Supports a filter by finding ids, shown as a removable chip ("Showing 7 findings fixed by edit #1 · Clear").
- **Comparison tab:** the comparison table from step 1.
- Each edit card shows "Fixes N findings", linking to the Findings tab filtered to that edit's `resolves_finding_ids`.
- Keep the "Under the hood" drawer, opened from a small link at the bottom of the Recommendations tab.

## 2. Automatic generation
- When a report opens and there's no cached result for the current cache key, start generation automatically after the user has stayed on that SKU for 2 seconds. Switching SKU or leaving within 2 seconds cancels the timer (not a running request).
- Never auto-generate from the SKU picker, and never for a SKU whose generation the user cancelled in this session (show the manual "Generate recommendations" button instead).
- Keep the manual "Generate recommendations" / "Regenerate" button.
- Store with each cached result the sorted list of active finding ids it was generated from. If the current active findings differ (e.g. the user dismissed or restored a finding), show a banner above the cards: "Findings changed since these recommendations were generated." with a "Regenerate" button. Never regenerate automatically in that case.

## 3. Ranking is computed in code
After the guardrail, reorder `top_edits` in code and renumber ranks 1..n. The AI's order is ignored.
- `edit_score = Σ severity weight of findings in resolves_finding_ids + visibility weight + competitive bonus`
- Severity weights: high 10, medium 4, low 1. Findings with `match_type: "interpretation"` count at half weight.
- Visibility weights: title 3, bullets 2, description 1.
- Competitive bonus: 2 if the edit has at least one competitive change that passed the guardrail.
- Ties: title > bullets > description.
- Each card shows a code-generated reason as the main line, e.g. "Ranked #1: fixes 4 high-risk and 1 medium issue in the title, the most visible field." Show the AI's `why_ranked` below it in smaller muted text.
- Show the scoring formula in a tooltip on "Ranked #n", and include the per-edit scores in the Under the hood drawer.

## 4. Edit card views
- A view switch on each card: **Proposed** (default: clean proposed text only), **Changes** (the word-level diff from step 2), **Side by side** (current on the left, proposed on the right; stacked on mobile).
- For bullets, show one row per bullet, marking added, removed and changed bullets.
- **Full / Compliance-only** toggle: switches the displayed and approvable text between `proposed_full` and `proposed_compliance_only`. Hide the toggle if they're identical. Default: Full.
- Show a character count under title and description, and per bullet, with the guideline limit (e.g. "142 / 200"), amber near the limit and red over it.

## 5. Risk tier per edit (computed in code, recomputed whenever the text changes)
Show as a badge on each card:
- **"Blocked: confirm facts"** (red): the current version still contains a `[confirm: …]` placeholder, OR `validateText` returns any high or medium finding for it, OR it failed a faithfulness check (invented claim or invalid competitor evidence) that the user hasn't fixed.
- **"Safe to bulk-approve"** (green): not blocked, passed the guardrail, has no placeholders, and it only REMOVES text: every word of the proposed version appears in the current text in the same order (compare lowercase words, ignoring punctuation and whitespace). Typically compliance-only removals.
- **"Review"** (amber): everything else (rewrites and additions that pass checks).
Tooltip on each badge explains why it got that tier.

## 6. Approval actions
Each edit has a state: Pending, Accepted, Edited & accepted, Accepted with override, Rejected. Show the state on the card and an "Undo" link after any decision.

**Accept** — available for "Safe to bulk-approve" and "Review" edits.

**Edit** — opens an editor in the card:
- Title and description: a textarea. Bullets: 5 inputs (empty ones allowed), with add/remove.
- **Needs confirmation form:** for each `[confirm: …]` placeholder, a labelled input (e.g. "Pack size") and a "Remove this detail" option. Filling it replaces the placeholder in the text; removing deletes the placeholder and cleans up extra spaces/punctuation. Values entered here are recorded as "user-confirmed facts".
- **Live validation** (debounced 300 ms): run `validateText` and the unsupported-claims check against the source listing plus the user-confirmed facts. Show issues inline under the editor with rule chips. Update the character counts and the risk tier live.
- "Save & accept" is enabled when there are no placeholders left and no high/medium issues.
- If issues remain, offer "Accept anyway (override)", which requires a short reason (text input, required). Remaining placeholders can never be overridden; they must be filled or removed.
- "Cancel" discards unsaved changes (confirm if the text changed).

**Reject** — asks for an optional reason: "Not accurate", "Doesn't fit our brand voice", "Not needed now", "Other" (with text).

**Approve all** — a button at the top of the Recommendations tab, labelled with the count ("Approve all 3"):
- Opens a confirmation dialog listing each pending edit and what will happen: Safe and Review edits will be accepted as shown (in their currently selected Full/Compliance-only version); Blocked edits will be skipped with the reason.
- After confirming, show a toast, e.g. "2 edits accepted · 1 needs confirmation".
- Disabled (with tooltip) when no pending edit is Safe or Review.

**Regenerate with decisions made:** warn first: "Pending recommendations will be replaced. Accepted and rejected edits are kept." New edits for fields that already have an accepted or rejected decision are ignored.

## 7. Persistence
- Save decisions, edited text, selected version (Full/Compliance-only), user-confirmed facts, override and reject reasons per `${datasetId}:${sku_id}` in context and localStorage (try/catch). Restore them when the SKU is reopened, if the cached recommendations still match.
- Extend the step 1 replace-data confirmation: if any SKU has pending or accepted decisions, the message also says "Approved edits for <n> SKUs will be cleared. Download their summaries first."
- On the SKU picker, show a small status per SKU: "Not reviewed", "Recommendations ready", "In review (1/3)", "Reviewed".

## 8. Final Markdown summary
- A "Finish review" button at the bottom of the Recommendations tab, enabled once every edit has a decision. If some are still pending, show "Finish with <n> pending" with a confirmation that pending edits will be listed as not reviewed.
- It opens `/skus/:skuId/summary`, with breadcrumbs "… › <Brand> › Summary" and the step indicator on "Review & approve".
- **Score before → after:** apply the final text of all accepted edits to a copy of the SKU and run `auditSku` on it. Show "Compliance score 12 → 86" and remaining high/medium findings.
- **Actions:** "Copy Markdown", "Download .md" (file name `ally-summary-<sku_id>-<YYYY-MM-DD>.md`), and "Back to recommendations". Two views: Preview (rendered) and Markdown (raw, monospace).
- Generate the Markdown in code from a template (no AI call), exactly in this structure. Omit a section only where it says "if any".

```
# Listing update summary: <Brand> (<sku_id>)

**Date:** <YYYY-MM-DD> · **Data:** <file name> · **Prompt:** v1 · **Model:** <model>
**Compliance score:** <before> → <after> · **Edits:** <accepted count> accepted, <rejected count> rejected, <pending count> not reviewed

## Approved changes

### <n>. <Field> — <Accepted | Edited & accepted | Accepted with override>
**Version:** <Full recommendation | Compliance-only>

**Before**
> <current text; bullets as a list>

**After**
> <final text; bullets as a list>

**Why**
- Compliance: <what> (<rule ids>)
- Competitive: <what> — evidence: <Brand> (<sku_id>): "<evidence>"

**User-confirmed facts** (if any): <label>: <value>
**Override** (if any): <reason> — remaining issues: <rule ids and messages>

## Rejected changes (if any)
- <Field>: <reason or "No reason given">

## Not reviewed (if any)
- <Field>

## Still open
- <severity> · <message> (<rule id>) — <reason>

## Action items
- <what> (<rule ids>)

## Findings dismissed as not an issue (if any)
- <message> (<rule id>) — "<evidence>"

## Final listing
**Title:** <final title>

**Bullets**
- <bullet 1>
- …

**Description**
<final description>

---
*Generated by Ally · Competitor Content Intelligence (prototype). Review before publishing. Recommendations follow the provided Amazon content guidelines; approved overrides are listed above.*
```
- "Final listing" uses accepted final text where an edit was accepted, and the original text otherwise.
- If nothing was accepted, the summary still generates, with "No changes approved" under Approved changes.

## 9. Edge cases to handle
- Recommendations with 0 edits: no approval controls; "Finish review" goes straight to a summary with "No changes recommended".
- An edit whose guardrail failed: it starts as Blocked; the user can fix it in the editor or reject it.
- User edits the text back to exactly the current text: treat as a reject with reason "Kept original".
- Switching the Full/Compliance-only toggle after editing: warn that edits apply to the currently selected version only.
- Very long text in the editor or summary wraps; nothing overflows the page horizontally.
- All decisions, badges and states have text labels, not colour alone; the editor, dialogs and tabs are keyboard accessible.
