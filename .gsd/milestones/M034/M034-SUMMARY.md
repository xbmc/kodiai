---
id: M034
title: "Claude Code Usage Visibility"
status: complete
completed_at: 2026-04-02T20:30:44.308Z
key_decisions:
  - Capture the last SDKRateLimitEvent seen during a run and persist it on ExecutionResult as a structured usageLimit object (D021) — still valid; last-wins semantics correctly gives the most recent limit snapshot
  - Spread-conditional pattern (`...(cond ? { field: val } : {})`) to make a JSON key fully absent vs present based on runtime data — avoids null/undefined noise in result.json artifacts
  - Inlined usageLimit shape in formatReviewDetailsSummary rather than importing from ExecutionResult — keeps review-utils independent of execution types and avoids circular dependency risk
  - tokenUsage object constructed inline at the review.ts call site from result fields — keeps the call site self-documenting without pre-forming an intermediate object
key_files:
  - src/execution/types.ts
  - src/execution/agent-entrypoint.ts
  - src/execution/agent-entrypoint.test.ts
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
lessons_learned:
  - SDKRateLimitEvent is emitted during streaming, not in the final result message — any future SDK event types should be checked for this same pattern before assuming they appear in the result envelope
  - The spread-conditional pattern (`...(cond ? { field: val } : {})`) is the right idiom for optional JSON keys in TypeScript — prefer it over optional assignment to keep artifact JSON clean of null/undefined values
  - Inlining external type shapes at function boundaries (rather than importing) is worth the minor duplication when it prevents coupling between otherwise-independent modules
  - makeRateLimitEvent() helper pattern for injecting synthetic SDK messages in tests is a useful template for future event-type tests — keeps test setup readable and reusable
---

# M034: Claude Code Usage Visibility

**Surfaced Claude Code weekly usage limit and token consumption directly in GitHub PR comment Review Details by capturing SDKRateLimitEvents in the agent run and rendering them into formatReviewDetailsSummary.**

## What Happened

M034 was a focused two-slice milestone to make Claude Code usage context visible to operators in GitHub PR review comments.

**S01 — Capture Claude Code usage events** added an optional `usageLimit` field to `ExecutionResult` in `src/execution/types.ts` (three sub-fields: `utilization`, `rateLimitType`, `resetsAt`). The agent entrypoint (`src/execution/agent-entrypoint.ts`) was wired to capture `SDKRateLimitEvent` messages with last-wins semantics: `let lastRateLimitEvent` is declared before the for-await loop, each matching event overwrites it, and a spread-conditional after the loop populates `usageLimit` only when an event was actually seen. The error paths (no-result, catch block) are untouched — the field is intentionally absent there. Four targeted tests (`src/execution/agent-entrypoint.test.ts`) prove every contract condition: single event captured, last-wins, absent when no event, sub-fields undefined when event omits them.

**S02 — Render usage and tokens in Review Details** extended `formatReviewDetailsSummary` in `src/lib/review-utils.ts` with two optional parameters: `usageLimit` (renders `- Claude Code usage: {pct}% of {type} limit | resets {ISO}`) and `tokenUsage` (renders `- Tokens: {N} in / {M} out | {cost}`). Both shapes are inlined rather than imported from execution types, keeping review-utils decoupled. The single call site in `src/handlers/review.ts` (~line 3004) was updated to pass `result.usageLimit` and an inline `tokenUsage` object. Three unit tests cover renders-usage-line, renders-token-line, and omits-both-when-absent. One integration test in `src/handlers/review.test.ts` asserts `detailsCommentBody` contains `80% of seven_day limit` and `in /` when the executor returns usage data.

Final verification: 17/17 agent-entrypoint tests, 3/3 review-utils tests, 73/73 handler tests, TypeScript 0 errors.

## Success Criteria Results

## Success Criteria

**S01 After this:** `result.json` includes Claude Code usage-limit data when the SDK emits a rate-limit event, and tests prove the last event wins.
- ✅ Met. `usageLimit` field added to `ExecutionResult` type; agent-entrypoint captures last `SDKRateLimitEvent` via spread-conditional. 4 tests prove the contract: single event, last-wins, absent when no event, undefined sub-fields. 17/17 tests pass.

**S02 After this:** The GitHub PR comment's Review Details section shows usage percentage, reset timing, token usage, and cost.
- ✅ Met. `formatReviewDetailsSummary` renders `- Claude Code usage: {pct}% of {type} limit | resets {ISO}` and `- Tokens: {N} in / {M} out | {cost}` when the respective fields are present. Integration test confirms the lines appear in `detailsCommentBody`. 73/73 handler tests pass.

## Definition of Done Results

## Definition of Done

- ✅ S01 slice complete — S01-SUMMARY.md present, all tasks complete, 17/17 tests pass
- ✅ S02 slice complete — S02-SUMMARY.md present, all tasks complete, 73/73 tests pass
- ✅ Both slices marked ✅ in M034-ROADMAP.md
- ✅ `bun tsc --noEmit` exits 0
- ✅ Cross-slice integration: S02 consumes `result.usageLimit` produced by S01's plumbing; integration test in review.test.ts confirms end-to-end wiring

## Requirement Outcomes

## Requirement Outcomes

No requirement status transitions during this milestone. M034 is a product-capability feature addition, not a quality/infrastructure remediation milestone. Existing validated requirements (R001 TypeScript zero errors) continues to hold — `bun tsc --noEmit` exits 0 after all changes.

## Deviations

None.

## Follow-ups

Slack surface for usage/token visibility is explicitly deferred per the milestone vision. When that work begins, the usageLimit field on ExecutionResult is already available and just needs a Slack formatter.
