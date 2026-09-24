# Examples

## test-data/
| File | Purpose |
|---|---|
| `client_skus_ciq_assignment.csv` | The 8 SKUs provided with the assignment |
| `test_messy_upload.csv` | Upload validation: odd headers, missing title, duplicate SKU, single-SKU group, missing group |
| `test_batch_50_skus.csv` | 36 client SKUs + 14 competitors across 6 groups, for demoing review at scale (invented competitor brands in the new groups) |
| `eval_set_compact.csv` | Standard eval set: 14 AI scenarios, 7 rules-only rows, 9 benchmark competitors |
| `eval_set_hard.csv` | Held-out hard set, written after prompt v1 was frozen: 13 AI scenarios, 1 rules-only row |

Eval CSVs add three columns to the normal format: `scenario`, `expectations` (a JSON array of assertions) and `eval_type`; the hard set also has `eval_set`.

## eval-results/
| Run | Prompt | Set | Files |
|---|---|---|---|
| 1 | v1 | Standard | `run1_v1_standard_*` |
| 2 | v1 | Standard, after checker and harness fixes | `run2_v1_standard_fixed_*` |
| 3 | v2 | Held-out hard | `run3_v2_hard_*` |

What each run found is written up in the main [README, section 8](../README.md#8-evaluation-how-we-know-it-works).

## sample-outputs/
| File | What it shows |
|---|---|
| `ally-summary-COMP-SPW-103-2026-09-24.md` | A Markdown summary exported from the app (bubly). This run exposed the bullet-header false positive: the AI rewrote three compliant headers and dropped the pack size, which led to fix prompt 05 and regression scenario EVAL-09 |
