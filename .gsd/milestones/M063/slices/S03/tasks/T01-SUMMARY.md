---
id: T01
parent: S03
milestone: M063
key_files:
  - src/execution/review-prompt.test.ts
key_decisions:
  - Kept the proof at the production seam by comparing `buildReviewPromptDetails(...)` outputs instead of introducing mocked prompt snapshots.
  - Made the continuation contract section-specific: `review-change-context` and `review-size-context` must narrow, while `review-knowledge-context` is allowed to remain equal because retrieval context is intentionally reused.
duration: 
verification_result: passed
completed_at: 2026-04-24T06:21:57.288Z
blocker_discovered: false
---

# T01: Added production-seam continuation prompt tests that prove retry prompts narrow change/size context while preserving required reused sections.

**Added production-seam continuation prompt tests that prove retry prompts narrow change/size context while preserving required reused sections.**

## What Happened

I traced the shipped prompt-builder seam from `src/handlers/review.ts` into `buildReviewPromptDetails(...)` and confirmed the real initial-vs-retry contract: first pass carries the full changed-file set, large-PR triage, and bounded-review disclosure, while retry narrows `changedFiles`, drops `largePRContext`, and switches instructions to reduced-scope inline-only continuation. I then added minimal deterministic helpers in `src/execution/review-prompt.test.ts` to build both prompt variants from one shared review scenario, plus a reusable continuation-contract assertion. The new tests prove section-level narrowing on `review-change-context`, prove first-pass-only size context is omitted on continuation, verify reused knowledge context remains present and equal-sized, and include an explicit negative test showing the contract fails when a retry prompt does not narrow the first pass. No production code changes were needed because the shipped builder already satisfied the intended contract once exercised at the right seam.

## Verification

Ran the task-scoped continuation test filter against `src/execution/review-prompt.test.ts`, which passed with the new production-seam assertions. Then ran `bun run tsc --noEmit`, which exited successfully, confirming the new helper and assertions type-check cleanly. Slice-level verification for this intermediate task is partially satisfied through the prompt test surface and TypeScript gate; the remaining slice verifier script and handler retry-path checks belong to later tasks in the slice.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/execution/review-prompt.test.ts --filter "continuation"` | 0 | ✅ pass | 148ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 9309ms |

## Deviations

None.

## Known Issues

`capture_thought` returned an error while attempting to save a reusable testing pattern, so no cross-session memory entry was recorded.

## Files Created/Modified

- `src/execution/review-prompt.test.ts`
