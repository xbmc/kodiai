---
id: T02
parent: S04
milestone: M066
key_files:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
key_decisions:
  - Format-only formatter mentions short-circuit in the mention handler after checkout/config load and before prompt/executor construction so they stay read-only and avoid Claude cost.
  - Publisher-posted formatter reviews rely on the PR review as the visible success surface; the handler posts issue replies only when the subflow returns a diagnostic visibleMessage.
duration: 
verification_result: passed
completed_at: 2026-05-05T01:13:15.295Z
blocker_discovered: false
---

# T02: Wired format-only PR mentions to run formatter suggestions directly without invoking Claude.

**Wired format-only PR mentions to run formatter suggestions directly without invoking Claude.**

## What Happened

Imported the T01 formatter suggestion subflow into the real mention handler and added a dependency-injection seam for tests. Format-only PR requests now short-circuit after workspace checkout and repo config load, pass PR identity, refs, formatter command/maxSuggestions, installation/delivery IDs, bot handles, Octokit, workspace token, and GitHub PR-file fallback providers into the formatter subflow, and return before prompt construction or executor dispatch. Visible subflow diagnostics are posted through the existing mention reply path with mention sanitization, while successful publisher-posted reviews avoid an extra success issue comment. The handler records a structured format-only completion log with formatter mode/status, command/publisher status, counts, partial-failure flags, and visible-reply outcome, without logging formatter stdout or unbounded stderr. Updated the formatter-intent mention tests so format-only fixtures assert Claude is bypassed, the injected subflow receives config and PR identity, missing-command setup guidance is posted, publisher success does not create an extra issue comment, and review-and-format still follows normal explicit review routing.

## Verification

Watched new format-only mention tests fail first because the existing handler still called executor.execute, then implemented the subflow short-circuit and reran verification. The task verification command passed with 145 tests across the mention handler and formatter orchestration suites. A TypeScript plus ESLint check on the edited files also exited 0. Slice-level observability criteria advanced through tests that assert structured completion logs and visible diagnostics for setup-needed and publisher-success paths; T01 orchestration tests continue to cover bounded formatter failure, timeout, mapping, duplicate, blocked, and publisher failure statuses.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000` | 0 | ✅ pass | 6317ms |
| 2 | `bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/mention.test.ts` | 0 | ✅ pass | 10290ms |

## Deviations

No plan-invalidating deviations. The pre-task memory query and post-task capture_thought calls failed because the local GSD memory database is malformed/unwritable, so durable memory capture could not be recorded.

## Known Issues

The GSD memory store is unhealthy in this environment: memory_query reported a malformed database image and capture_thought failed to create memory. No code issues are known for this task.

## Files Created/Modified

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
