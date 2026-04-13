---
id: T01
parent: S01
milestone: M049
key_files:
  - src/handlers/review-idempotency.ts
  - src/handlers/review-idempotency.test.ts
key_decisions:
  - Kept `review-output-key` marker creation and extraction unchanged while moving clean approvals to a visible plain-markdown body with an explicit `Evidence:` section.
  - Reserved one evidence slot for optional approval-confidence text so merge-confidence stays structured as a bullet instead of trailing free-form prose.
duration: 
verification_result: mixed
completed_at: 2026-04-13T14:28:13.329Z
blocker_discovered: false
---

# T01: Defined the shared visible clean-approval body contract with bounded evidence bullets and the existing review-output marker.

**Defined the shared visible clean-approval body contract with bounded evidence bullets and the existing review-output marker.**

## What Happened

I followed a red-green TDD loop in `src/handlers/review-idempotency.test.ts` by replacing the old wrapper-only approval assertion with contract tests for visible markdown, `Decision: APPROVE`, `Issues: none`, an `Evidence:` block, bounded 1–3 bullets, approval-confidence normalization, fallback evidence when inputs are empty, and unchanged marker extraction. After confirming the tests failed against the previous `<details>`-wrapped body, I updated `src/handlers/review-idempotency.ts` to keep marker generation centralized while adding small evidence-normalization helpers. `buildApprovedReviewBody(...)` now emits plain markdown instead of using `wrapInDetails(...)`, trims and filters evidence inputs, caps total bullets at three, preserves approval confidence as a structured bullet by reserving one slot for it, and falls back to a single default factual evidence line when no usable evidence is provided. I then reran the focused helper suite to green and ran the slice-level verification commands. The full slice suite now has one expected downstream failure in `src/handlers/mention.test.ts` because T02 still needs to adopt the new visible approval body contract; everything else in that suite passed, and `tsc --noEmit` stayed clean.

## Verification

Verified the helper contract with `bun test ./src/handlers/review-idempotency.test.ts`, which passed all 15 tests and confirmed the approval body is visible markdown with bounded evidence bullets, fallback evidence handling, preserved marker extraction, and no `<details>` wrapper. Ran the slice-level test command `bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts`; it produced one expected failure in `src/handlers/mention.test.ts` still asserting the old `<summary>kodiai response</summary>` wrapper, while the remaining 311 tests passed. Ran `bun run tsc --noEmit`, which exited successfully with no type errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/review-idempotency.test.ts` | 0 | ✅ pass | 25ms |
| 2 | `bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts` | 1 | ❌ fail | 8813ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 8003ms |

## Deviations

None.

## Known Issues

`bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts` still has one expected downstream failure in `src/handlers/mention.test.ts` because T02 has not yet updated explicit approval publishing to the shared visible body contract.

## Files Created/Modified

- `src/handlers/review-idempotency.ts`
- `src/handlers/review-idempotency.test.ts`
