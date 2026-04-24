---
id: T01
parent: S03
milestone: M061
key_files:
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
key_decisions:
  - Split review prompt telemetry into stable named sections while keeping the external `review.user-prompt` prompt kind unchanged.
  - Applied explicit char budgets only to the volatile expensive sections so operators can attribute growth/truncation without persisting prompt text.
duration: 
verification_result: mixed
completed_at: 2026-04-24T02:03:40.020Z
blocker_discovered: false
---

# T01: Refactored review prompt assembly into budgeted named sections with per-section truncation metrics.

**Refactored review prompt assembly into budgeted named sections with per-section truncation metrics.**

## What Happened

I replaced the monolithic `review-user-prompt` assembly in `src/execution/review-prompt.ts` with explicit section blocks for PR context, change context, size/boundedness context, graph/structural evidence, knowledge context, and the instruction-heavy tail. The builder now applies documented local character budgets to the volatile expensive sections, preserves the existing review content order, prefers unified knowledge context when present, and returns section-level metrics/truncation flags through the existing prompt build result. I also rewrote the top-level prompt-builder test in `src/execution/review-prompt.test.ts` to drive the refactor test-first and assert named sections, token estimates, and truncation behavior under oversized inputs.

## Verification

Ran the task verification command `bun test src/execution/review-prompt.test.ts` after the refactor and confirmed the focused review prompt suite passed (221 pass, 0 fail). I also attempted LSP diagnostics on the edited files, but no language server is configured in this workspace, so static diagnostics were unavailable via LSP.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/execution/review-prompt.test.ts` | 0 | ✅ pass | 120ms |
| 2 | `lsp diagnostics src/execution/review-prompt.ts + src/execution/review-prompt.test.ts` | 1 | ❌ fail (no language server found in workspace) | 20ms |

## Deviations

None.

## Known Issues

LSP diagnostics could not run because no language server is configured for this workspace.

## Files Created/Modified

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
