Status: designed, not built in this prototype.

---

Add a portal-agnostic CSV extract of review decisions. If an Export dialog already exists (step 4), extend it; otherwise create it. Keep everything else unchanged.

1. Where the extract is available
- Summary page ("/skus/:skuId/summary"): an "Export CSV" button next to "Download .md", scoped to that SKU.
- Report header: an "Export" button, enabled once at least one edit on the SKU is decided.
- Review queue: the "Export" button, with scope: selected SKUs / current filter / all reviewed SKUs.
- After "Finish review", the success toast includes an "Export CSV" link.

2. Two formats (radio choice in the dialog)
a) "Final listings — one row per SKU" (for updating another portal). Columns:
sku_id, brand, review_status, changed_fields, title, title_changed, bullet_1, bullet_2, bullet_3, bullet_4, bullet_5, bullets_changed, description, description_changed, edits_accepted, edits_rejected, reviewer, reviewed_at
- Each field holds the FINAL text: accepted (or edited & accepted) text where approved, otherwise the original text unchanged.
- *_changed columns are "Yes"/"No". changed_fields lists them, e.g. "title; bullets".
- Option "Only include SKUs with at least one accepted change" (on by default).

b) "Decision log — one row per edit" (for audit or a team handoff). Columns:
sku_id, brand, field, decision, version, risk_tier, before_text, ai_proposed_text, final_text, changed_by_reviewer, rule_ids, competitor_evidence, user_confirmed_facts, override_reason, reject_reason, comment, reviewer, decided_at
- Bullets joined with " | " in one cell.

3. What's included
- Client SKUs only. Pending edits are exported as unchanged in format (a) and as decision "Pending" in format (b), and the dialog warns: "<n> edits are still pending and will be exported as unchanged."
- Never export text containing "[confirm:". Such edits can't be accepted anyway; if one is found, skip it and list it in the dialog.
- Strip HTML tags. Keep line breaks inside quoted cells.

4. File rules
- Generate with Papa.unparse, quote every field, "\n" line endings.
- Checkbox "Excel-friendly (UTF-8 with BOM)", on by default.
- CSV injection protection: if a cell starts with =, +, -, @, tab or carriage return, prefix it with a single quote.
- File names: ally-listings-<scope>-<YYYY-MM-DD>.csv and ally-decisions-<scope>-<YYYY-MM-DD>.csv, where scope is the sku_id for a single SKU, or "batch".
- Disable a format with a tooltip when it would be empty (e.g. no accepted changes).

5. After download, show a toast: "Exported <n> SKUs (<n> changed fields)".
