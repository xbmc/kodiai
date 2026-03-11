# T02: 07-operational-resilience 02

**Slice:** S07 — **Milestone:** M001

## Description

Wire error reporting into both handlers so that every failure path results in a user-visible, actionable error comment -- never silent failure.

Purpose: The review handler currently catches errors and only logs them (user sees nothing). The mention handler has partial error reporting but uses hardcoded messages instead of classified errors. This plan upgrades both handlers to use the shared errors module from Plan 01.

Output: Updated `src/handlers/review.ts` and `src/handlers/mention.ts` with comprehensive error reporting on all failure paths.

## Must-Haves

- [ ] "A review handler failure (execution error, timeout, clone failure, config error) posts a new error comment on the PR"
- [ ] "A mention handler failure posts or updates the tracking comment with a classified, actionable error message"
- [ ] "Error comments are clear and actionable -- never stack traces, never generic 'something went wrong'"
- [ ] "Timeout errors specifically mention the timeout duration and suggest increasing it or breaking work into smaller pieces"
- [ ] "Failed error comment posting is caught and logged but never masks the original error"

## Files

- `src/handlers/review.ts`
- `src/handlers/mention.ts`
