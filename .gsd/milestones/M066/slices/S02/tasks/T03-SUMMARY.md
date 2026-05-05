---
id: T03
parent: S02
milestone: M066
key_files:
  - src/execution/formatter-suggestions.ts
  - src/execution/formatter-suggestions.test.ts
key_decisions:
  - Formatter suggestions validate against the PR RIGHT-side line index before enforcing `maxSuggestions`, so caps only drop candidates that were otherwise safe and batchable.
duration: 
verification_result: passed
completed_at: 2026-05-05T00:31:19.546Z
blocker_discovered: false
---

# T03: Mapped formatter diff replacement blocks to capped, PR-safe GitHub suggestion payloads.

**Mapped formatter diff replacement blocks to capped, PR-safe GitHub suggestion payloads.**

## What Happened

Added public mapper/index contracts in `src/execution/formatter-suggestions.ts`. `buildPrDiffCommentabilityIndex()` now parses PR unified diffs and records only RIGHT-side context/addition line numbers per path, ignoring deletions and refusing malformed hunk ranges. `mapFormatterDiffToSuggestions()` now parses formatter diffs, extracts contiguous changed groups, validates every replacement target line against the PR RIGHT-side index, emits GitHub suggestion payloads with `path`, `line`, optional `startLine`, `side: "RIGHT"`, markdown suggestion bodies, and source metadata, and returns structured counts/skips for unsafe, unmappable, parser-skipped, and capped candidates. Added tests for one-line replacements, multi-line uneven replacements, pure insertions/deletions, empty index, path mismatch, off-by-one ranges, mixed safe/unsafe hunks, maxSuggestions capping, blank replacement lines, parser skip propagation, and malformed PR diff hunks. The initial targeted RED run failed because `mapFormatterDiffToSuggestions` was not exported yet, then the implementation brought the targeted and slice regression suites green.

## Verification

Verified with the targeted formatter suite and the slice-level regression command. `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` passed with 24 tests and 74 assertions. `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` passed with 269 tests and 1246 assertions. LSP diagnostics were attempted for the edited TypeScript files but no language server was available in this environment.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` | 0 | ✅ pass | 13ms |
| 2 | `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` | 0 | ✅ pass | 6500ms |

## Deviations

None.

## Known Issues

GSD memory lookup failed before implementation with `database disk image is malformed`; not fixed because it is outside this task scope. TypeScript LSP diagnostics could not run because no language server was available.

## Files Created/Modified

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestions.test.ts`
