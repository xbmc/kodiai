---
id: T03
parent: S02
milestone: M051
key_files:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
  - src/handlers/review.test.ts
  - .gsd/DECISIONS.md
key_decisions:
  - D126 — Evidence the surviving manual rereview contract through explicit mention-review completion logs (taskType=review.full, lane=interactive-review) plus skipped team-only review_requested logs for retired ai-review/aireview requests.
duration: 
verification_result: passed
completed_at: 2026-04-19T00:09:32.832Z
blocker_discovered: false
---

# T03: Locked the surviving `@kodiai review` proof surface with explicit lane/task-type observability and team-only skip regressions.

**Locked the surviving `@kodiai review` proof surface with explicit lane/task-type observability and team-only skip regressions.**

## What Happened

Started from the existing supported-path coverage in `src/handlers/mention.test.ts` and tightened it into one explicit proof for the only surviving manual rereview path. The updated regression now verifies that `@kodiai review` enqueues onto the `interactive-review` lane, invokes the executor with `taskType=review.full`, produces a visible approval-bridge publish, and leaves matching completion-log evidence on the same execution. That new assertion failed first because the structured `Mention execution completed` log did not carry the lane/task-type pair, so I added those fields on the explicit-review branch in `src/handlers/mention.ts` and reran the bundle to green. I also added a focused negative regression in `src/handlers/review.test.ts` that feeds both `ai-review` and `aireview` team-only `pull_request.review_requested` events through the real handler and proves they are skipped with `skipReason=team-only-request` and zero enqueues. Finally, I recorded decision D126 so downstream work knows the surviving manual rereview proof now lives on the explicit mention publish/log surface rather than any UI-team rereview contract.

## Verification

Fresh verification ran after the test-first tightening and the explicit-review log update. `bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts` passed with 243 tests green, covering the supported `@kodiai review` lane/task-type/publish chain and the negative `ai-review` / `aireview` skip regression. `bun run tsc --noEmit` then exited 0 to confirm the added mention-log fields compile cleanly. LSP diagnostics were unavailable in this workspace, so the compiler check served as the typed-surface verification.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 12110ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 9830ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/review.test.ts`
- `.gsd/DECISIONS.md`
