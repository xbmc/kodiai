---
id: T01
parent: S04
milestone: M066
key_files:
  - src/handlers/formatter-suggestion-orchestration.ts
  - src/handlers/formatter-suggestion-orchestration.test.ts
key_decisions:
  - Used `mention-format-suggestions` as the formatter-specific review output action so formatter reviews do not collide with normal `mention-review` output keys.
  - Returned structured expected-failure results instead of throwing for command, diff, mapping, and publisher subflow failures.
duration: 
verification_result: passed
completed_at: 2026-05-05T01:06:53.821Z
blocker_discovered: false
---

# T01: Added a formatter suggestion subflow helper with structured statuses, visible diagnostics, and redaction-safe orchestration tests.

**Added a formatter suggestion subflow helper with structured statuses, visible diagnostics, and redaction-safe orchestration tests.**

## What Happened

Created `runFormatterSuggestionSubflow()` in `src/handlers/formatter-suggestion-orchestration.ts` as a focused orchestration seam for explicit formatter suggestion requests. The helper keeps side effects injected, preflights missing formatter commands, runs the S02 formatter command runner, collects full PR diff content, maps formatter diffs through `buildPrDiffCommentabilityIndex()` and `mapFormatterDiffToSuggestions()`, resolves the PR head SHA, builds a formatter-specific `mention-format-suggestions` review output key, and publishes through the S03 batched publisher. Expected dependency failures are returned as structured result statuses (`setup-needed`, `no-op`, `pr-diff-unavailable`, `mapped-no-suggestions`, `posted`, `duplicate`, `blocked`, `failed`) with bounded visible messages instead of throws. Added `src/handlers/formatter-suggestion-orchestration.test.ts` covering setup guidance, no-op output, formatter failure/timeout, missing PR diff, malformed formatter diff, successful publication, duplicate/idempotency skip, secret-blocked publication, GitHub/publisher failure, cap semantics, and a negative assertion that raw formatter stdout is not logged or surfaced.

## Verification

Ran the task-level helper test, both slice-level regression commands from `S04-PLAN.md`, and a targeted TypeScript/eslint check because no LSP server was available for diagnostics. All commands exited 0. The tests assert the required failure modes and observability/redaction contract for this helper; handler wiring/demo behavior remains for downstream S04 tasks.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000` | 0 | ✅ pass | 181ms |
| 2 | `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` | 0 | ✅ pass | 6357ms |
| 3 | `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` | 0 | ✅ pass | 6519ms |
| 4 | `bunx tsc --noEmit --pretty false && bunx eslint src/handlers/formatter-suggestion-orchestration.ts src/handlers/formatter-suggestion-orchestration.test.ts` | 0 | ✅ pass | 9256ms |

## Deviations

No plan-invalidating deviations. The memory lookup requested before implementation failed because the memory database reported `database disk image is malformed`, so execution proceeded from source and plan files.

## Known Issues

The GSD memory query database is malformed in this environment. No code issues are known for this task.

## Files Created/Modified

- `src/handlers/formatter-suggestion-orchestration.ts`
- `src/handlers/formatter-suggestion-orchestration.test.ts`
