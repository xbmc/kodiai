---
id: T01
parent: S02
milestone: M066
key_files:
  - src/execution/formatter-suggestions.ts
  - src/execution/formatter-suggestions.test.ts
key_decisions:
  - Unknown formatter-command brace placeholders remain literal; only `{baseRef}`, `{headRef}`, and `{diffRange}` are substituted.
duration: 
verification_result: passed
completed_at: 2026-05-05T00:26:07.687Z
blocker_discovered: false
---

# T01: Added a formatter command runner contract with injectable process execution and structured command statuses.

**Added a formatter command runner contract with injectable process execution and structured command statuses.**

## What Happened

Implemented `src/execution/formatter-suggestions.ts` as the formatter execution seam for downstream diff parsing. Added RED tests first in `src/execution/formatter-suggestions.test.ts`, confirmed the missing-module failure, then implemented `resolveFormatterCommand()` and `runFormatterCommand()` with explicit workspace/refs/range/timeout inputs, an injectable process runner, and a Bun-backed default runner. The command resolver substitutes only `{baseRef}`, `{headRef}`, and `{diffRange}` while leaving unknown brace expressions literal. The runner now returns deterministic `no-command`, `no-op`, `success`, `failed`, and `timed-out` statuses with stdout, resolved command, exit code, duration, timeout flag, and bounded/redacted stderr diagnostics. Memory lookup before implementation failed because the GSD memory DB reported `database disk image is malformed`, so execution proceeded from repo files and the task plan.

## Verification

Verified the new runner contract with `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` after implementation: 8 tests passed. Also ran the slice regression command `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000`: 253 tests passed. LSP diagnostics were attempted for the edited TypeScript files but no language server was available.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` | 0 | ✅ pass | 9ms |
| 2 | `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` | 0 | ✅ pass | 6490ms |

## Deviations

None.

## Known Issues

GSD memory lookup failed before implementation with `database disk image is malformed`; not fixed because it is outside this task's code scope. TypeScript LSP diagnostics could not run because no language server was available.

## Files Created/Modified

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestions.test.ts`
