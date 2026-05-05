---
id: T03
parent: S04
milestone: M066
key_files:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
key_decisions:
  - Combined review-and-format mode runs Claude review first and formatter suggestions afterward so formatter workspace mutations cannot affect review context.
  - Formatter visible diagnostics in combined mode bypass normal review publish-rights checks because formatter publication has its own S03 idempotency and failure reporting surface.
  - Executor throws in combined mode attempt the formatter subflow before rethrowing so existing review handler failure behavior is preserved.
duration: 
verification_result: mixed
completed_at: 2026-05-05T01:18:17.944Z
blocker_discovered: false
---

# T03: Wired combined review-and-format mentions to run Claude review and formatter suggestions as independently logged subflows.

**Wired combined review-and-format mentions to run Claude review and formatter suggestions as independently logged subflows.**

## What Happened

Updated `src/handlers/mention.ts` so `@kodiai review & format suggestions` preserves the explicit-review executor path, review routing, inline tools, review output key behavior, and existing fallback/error publication behavior while also invoking the formatter suggestion subflow with the same PR/workspace/config inputs used by format-only mode. The formatter runner is now a shared guarded helper that normalizes malformed formatter subflow results, catches unexpected formatter throws into bounded structured failures, and posts formatter visible diagnostics without consulting normal review publish-rights gates. Combined mode runs the formatter after normal review handling so formatter workspace mutations cannot affect Claude review context; if `executor.execute` throws after setup, the handler attempts the formatter subflow, logs the review throw plus formatter result, and then rethrows to the existing outer handler error path. Added combined-mode structured logs with independent `reviewConclusion`, `publishResolution`, `publishFailureCategory`, `formatterStatus`, `commandStatus`, `publisherStatus`, formatter counts, formatter visible-reply outcome, and `combinedPartialFailure` fields. Updated `src/handlers/mention.test.ts` to prove combined requests call both executor and formatter subflow, executor error results still attempt formatter, executor thrown errors attempt formatter before normal handler failure delivery, and formatter diagnostics do not suppress normal review fallback.

## Verification

Used TDD: first ran `bun test ./src/handlers/mention.test.ts --timeout 30000` after adding combined-mode tests and observed the expected red failures because the formatter subflow was not called in combined mode. After implementation, the targeted mention suite passed with 137 tests. The full S04 verification command passed with 293 tests across config, formatter intent, mention, formatter orchestration, formatter mapping, and formatter publisher suites. A TypeScript plus ESLint check on the edited files exited 0 with no output. LSP diagnostics could not run because no language server was registered for `src/handlers/mention.ts`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/mention.test.ts --timeout 30000 (red run after adding tests)` | 1 | ✅ pass | 6500ms |
| 2 | `bun test ./src/handlers/mention.test.ts --timeout 30000` | 0 | ✅ pass | 6500ms |
| 3 | `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000 && bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` | 0 | ✅ pass | 13100ms |
| 4 | `bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/mention.test.ts` | 0 | ✅ pass | 10100ms |
| 5 | `lsp diagnostics src/handlers/mention.ts — not available: no language server found` | -1 | unknown (coerced from string) | 0ms |

## Deviations

No plan-invalidating deviations. I added a shared mention-level formatter helper rather than duplicating format-only and combined subflow setup, preserving the existing format-only behavior while enabling combined mode. The pre-task memory query and post-task memory capture failed because the local GSD memory database is malformed/unwritable.

## Known Issues

The GSD memory store remains unhealthy in this environment: `memory_query` reported `database disk image is malformed`, and `capture_thought` failed to create memory. No code issues are known for this task.

## Files Created/Modified

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
