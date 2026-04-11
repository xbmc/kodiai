---
estimated_steps: 4
estimated_files: 3
skills_used:
  - test-driven-development
  - systematic-debugging
  - verification-before-completion
---

# T02: Suppress opted-out identity suggestions and prove route continuity

**Slice:** S02 — Contract-first Slack, retrieval, and profile continuity rollout
**Milestone:** M047

## Description

Close the remaining continuity bug where opted-out linked contributors can still receive identity-link suggestions because the suggestion path uses a user-view profile lookup. Keep the existing fail-open Slack API behavior, but switch this path onto the system-view lookup that can actually see opted-out rows and prove the new continuity copy across the signed slash-command HTTP surface.

## Steps

1. Change `suggestIdentityLink(...)` to use `profileStore.getByGithubUsername(githubUsername, { includeOptedOut: true })` so opted-out linked rows are treated as existing profiles.
2. Add focused identity-suggestion tests for opted-out suppression, linked-profile suppression, no-match behavior, and Slack API failures, resetting in-memory state with `resetIdentitySuggestionStateForTests()` in setup and teardown.
3. Extend `src/routes/slack-commands.test.ts` with signed-request scenarios that assert the updated continuity copy makes it through the real Hono route JSON response.
4. Keep the route dependency surface narrow: do not add new route injections or link-time recalculation work just to make the copy truthful.

## Must-Haves

- [ ] Opted-out linked contributors are treated as existing profiles and no longer receive identity-link DMs.
- [ ] Slack API failures stay non-blocking and logged, preserving the current fail-open behavior.
- [ ] Route-level tests prove the slash-command HTTP surface returns the updated continuity copy without widening route dependencies.

## Verification

- `bun test ./src/handlers/identity-suggest.test.ts ./src/routes/slack-commands.test.ts`
- `bun run verify:m047:s02 -- --json`

## Observability Impact

- Signals added/changed: opted-out identity suppression is visible through route/handler tests and the existing non-blocking warn path in `src/handlers/identity-suggest.ts`.
- How a future agent inspects this: run `bun test ./src/handlers/identity-suggest.test.ts ./src/routes/slack-commands.test.ts` or inspect the identity scenarios in `bun run verify:m047:s02 -- --json`.
- Failure state exposed: a DM sent for an opted-out linked profile, or a signed slash-command route returning stale optimistic continuity copy.

## Inputs

- `src/handlers/identity-suggest.ts` — current fail-open identity suggestion path that still hides opted-out rows behind the default lookup.
- `src/handlers/identity-suggest.test.ts` — existing test coverage plus the state-reset seam that must be used around cache-sensitive cases.
- `src/routes/slack-commands.ts` — signed Hono route that forwards slash-command responses.
- `src/routes/slack-commands.test.ts` — route-level HTTP coverage for signed slash-command requests.
- `.gsd/KNOWLEDGE.md` — documents the required `includeOptedOut: true` lookup rule and the `resetIdentitySuggestionStateForTests()` test-isolation rule.
- `src/contributor/types.ts` — store interface definition for the system-view profile lookup.

## Expected Output

- `src/handlers/identity-suggest.ts` — system-view opted-out suppression in the DM suggestion path.
- `src/handlers/identity-suggest.test.ts` — explicit opted-out, linked-profile, no-match, and Slack failure coverage with reset-state isolation.
- `src/routes/slack-commands.test.ts` — signed-route continuity checks for the updated slash-command copy.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `profileStore.getByGithubUsername(githubUsername, { includeOptedOut: true })` | Treat the lookup as unavailable and preserve the existing fail-open warning path rather than crashing review handling. | N/A — local store lookup only. | Prefer suppressing or failing open over assuming the contributor is absent when opt-out state cannot be read safely. |
| Slack Web API calls in `src/handlers/identity-suggest.ts` | Keep the path non-blocking and logged; do not let DM delivery failures affect review execution. | Preserve the existing bounded timeout behavior and avoid retry storms. | Ignore malformed Slack responses and log a warning instead of sending duplicate or partially formed DMs. |

## Load Profile

- **Shared resources**: in-memory member cache, in-memory suggested-username set, Slack `users.list` / DM APIs, and the signed slash-command route.
- **Per-operation cost**: one system-view profile lookup, zero or one cached `users.list` call, and at most one DM send.
- **10x breakpoint**: stale cache/suppression state and Slack rate limits break correctness before compute does, so tests must reset state and keep lookups bounded.

## Negative Tests

- **Malformed inputs**: missing or mismatched GitHub usernames, opted-out rows, and duplicate suggestion attempts in the same process.
- **Error paths**: `users.list` failure, `conversations.open` failure, malformed Slack JSON, and missing profile-store support for opted-out lookups.
- **Boundary conditions**: existing linked profile, opted-out linked profile, no high-confidence match, one high-confidence match, and repeated calls after cache reset.
