---
id: S01
parent: M034
milestone: M034
provides:
  - usageLimit field on ExecutionResult (types.ts) with utilization, rateLimitType, resetsAt
  - result.json includes usageLimit when the SDK emits a rate_limit_event during the run
  - 4 tests prove last-wins semantics and absent-when-no-event contract
requires:
  []
affects:
  - S02
key_files:
  - src/execution/types.ts
  - src/execution/agent-entrypoint.ts
  - src/execution/agent-entrypoint.test.ts
key_decisions:
  - usageLimit only set on the successful result path; absent by default in error cases so S02 knows no event was emitted
  - Spread-conditional (not optional assignment) used so the usageLimit key is fully absent in JSON when no rate_limit_event was seen — avoids null/undefined noise in the output artifact
  - last-wins semantics: each rate_limit_event overwrites the previous, giving the most recent snapshot of limit state
patterns_established:
  - makeRateLimitEvent() helper pattern for injecting synthetic SDKRateLimitEvent messages into agent-entrypoint tests — reusable for future event types
  - Spread-conditional to make a field key absent vs present based on runtime data: `...(cond ? { field: val } : {})` — keeps JSON artifacts clean
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M034/slices/S01/tasks/T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-02T20:16:25.926Z
blocker_discovered: false
---

# S01: Capture Claude Code usage events

**Added optional usageLimit field to ExecutionResult and wired up last-wins SDKRateLimitEvent capture in the agent SDK stream loop, with 4 targeted tests proving the contract.**

## What Happened

Single task, three surgical changes across three files. (1) `src/execution/types.ts` gained an optional `usageLimit` field on `ExecutionResult` with three sub-fields: `utilization`, `rateLimitType`, and `resetsAt` (all `number | string | undefined`). (2) `src/execution/agent-entrypoint.ts` imported `SDKRateLimitEvent`, declared `let lastRateLimitEvent: SDKRateLimitEvent | undefined` before the for-await loop, added an `else if (message.type === "rate_limit_event")` branch that overwrites the variable on every matching message (last-wins), and added a spread-conditional after the loop that populates `usageLimit` only when `lastRateLimitEvent !== undefined`. The error paths (no-result and catch block) were intentionally left untouched — the field is absent there by design. (3) `src/execution/agent-entrypoint.test.ts` gained a `makeRateLimitEvent()` helper and a `describe('rate_limit_event capture')` block with 4 tests covering every contract condition: single event captured, last event wins, absent when no event, and sub-fields undefined when the event omits them. All 17 tests pass; TypeScript emits 0 errors.

## Verification

bun test src/execution/agent-entrypoint.test.ts — 17/17 pass (114ms). bun tsc --noEmit — 0 errors. All 4 new rate_limit_event tests exercised the exact scenarios called out in the slice plan.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

None. The usageLimit field is only populated on the successful result path; error paths leave it absent, which is the intended contract.

## Follow-ups

S02 can now read result.json and render usageLimit fields in the GitHub PR comment Review Details section without any further plumbing.

## Files Created/Modified

- `src/execution/types.ts` — Added optional usageLimit field to ExecutionResult type
- `src/execution/agent-entrypoint.ts` — Imported SDKRateLimitEvent, added last-wins capture variable and else-if branch in for-await loop, populated usageLimit via spread-conditional on successful result
- `src/execution/agent-entrypoint.test.ts` — Added makeRateLimitEvent helper and 4 new tests in rate_limit_event capture describe block
