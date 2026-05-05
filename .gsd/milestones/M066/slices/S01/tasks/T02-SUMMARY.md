---
id: T02
parent: S01
milestone: M066
key_files:
  - src/handlers/formatter-suggestion-intent.ts
  - src/handlers/formatter-suggestion-intent.test.ts
key_decisions:
  - Kept formatter-suggestion mention parsing in a pure handler-local module and matched explicit suggestion-oriented phrases only, so future mention integration can distinguish read-only formatter suggestions from write-mode formatting commands.
duration: 
verification_result: mixed
completed_at: 2026-05-05T00:11:56.946Z
blocker_discovered: false
---

# T02: Added a pure formatter-suggestion mention intent parser with conservative phrase matching.

**Added a pure formatter-suggestion mention intent parser with conservative phrase matching.**

## What Happened

Created `src/handlers/formatter-suggestion-intent.test.ts` first and confirmed the RED failure was the missing parser module. Implemented `src/handlers/formatter-suggestion-intent.ts` as a pure module that exports the stable `FormatterSuggestionRequest` descriptor and `detectFormatterSuggestionRequest(...)` without importing the large mention handler. The parser normalizes whitespace, case, and trailing sentence punctuation, detects accepted format-only suggestion phrases, detects combined `review-and-format` phrases explicitly before format-only phrases, supports polite prefixes for combined requests, and leaves broad write-like wording such as `format this PR` unmatched to avoid write-mode ambiguity.

## Verification

Ran the task-specific parser suite and the full slice verification command. The task suite passed 20 tests after the expected initial RED failure. The slice command `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000` passed 242 tests across config, parser, and mention handler suites. LSP diagnostics were attempted for the new files, but no TypeScript language server was available in the harness.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/formatter-suggestion-intent.test.ts --timeout 30000` | 1 | ❌ fail | 7ms |
| 2 | `bun test ./src/handlers/formatter-suggestion-intent.test.ts --timeout 30000` | 0 | ✅ pass | 8ms |
| 3 | `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000` | 0 | ✅ pass | 6320ms |

## Deviations

None.

## Known Issues

GSD memory lookup failed before implementation because the local memory database reported `database disk image is malformed`; no code blocker resulted. TypeScript LSP diagnostics could not run because no language server was available.

## Files Created/Modified

- `src/handlers/formatter-suggestion-intent.ts`
- `src/handlers/formatter-suggestion-intent.test.ts`
