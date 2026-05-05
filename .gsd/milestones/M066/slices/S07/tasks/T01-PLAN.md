---
estimated_steps: 1
estimated_files: 6
skills_used: []
---

# T01: Root-cause the deployed formatter trigger miss

Reconstruct the failed PR #134 path from existing artifacts before changing code. Inspect `docs/smoke/m066-formatter-suggestions.md`, S06 task summaries, current mention routing tests, and relevant logs/artifacts if available. Identify the first boundary where `@kodiai format suggestions` stopped being interpreted as formatter intent: webhook event shape, mention parser input normalization, PR/issue-comment surface classification, config loading, or orchestrator dispatch. Produce a short root-cause note in the task summary with exact file/function evidence.

## Inputs

- `.gsd/milestones/M066/M066-VALIDATION.md`
- `docs/smoke/m066-formatter-suggestions.md`
- `S06 task summaries`

## Expected Output

- `Root-cause evidence recorded in T01 summary`
- `Any new regression test target identified before implementation`

## Verification

No code-change gate yet. Verification is evidence quality: cite the exact boundary and source lines/artifacts showing why `@kodiai format suggestions` fell through to conversational handling.

## Observability Impact

Confirms which runtime boundary lacked formatter-classification evidence so later logging/test fixes target the root cause.
