---
id: T02
parent: S02
milestone: M066
key_files:
  - src/execution/formatter-suggestions.ts
  - src/execution/formatter-suggestions.test.ts
key_decisions:
  - Unsupported formatter diff file statuses are skipped at file granularity rather than partially parsed so later mapping never receives ambiguous file state.
duration: 
verification_result: passed
completed_at: 2026-05-05T00:28:31.228Z
blocker_discovered: false
---

# T02: Parsed formatter unified diffs into conservative file, hunk, line, and skip models.

**Parsed formatter unified diffs into conservative file, hunk, line, and skip models.**

## What Happened

Added the exported formatter diff parser contract in `src/execution/formatter-suggestions.ts`, including file, hunk, line, skip reason, skip entry, and parse result types. Implemented a single-pass git unified diff parser that recognizes `diff --git`, `---`, `+++`, hunk headers, context/removed/added lines, blank added lines, and no-newline markers while preserving old/new cursor positions for downstream mapping. Unsupported binary, added, deleted, and renamed file diffs now produce structured `unsupported-file` skips, while malformed headers or invalid hunk ranges produce `malformed-diff` skips instead of silent partial parsing. Added inline fixture tests in `src/execution/formatter-suggestions.test.ts` and confirmed the new parser import failed before implementation, then brought the targeted suite green.

## Verification

Ran `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` after the final code change: 14 tests passed, 0 failed, 46 assertions. Also ran targeted ESLint on the edited files with no output. LSP diagnostics were attempted for `src/execution/formatter-suggestions.ts`, but no language server was available in this environment.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` | 0 | ✅ pass | 20ms |

## Deviations

None.

## Known Issues

GSD memory lookup still fails with `database disk image is malformed`, as first observed in T01; this is outside the task scope. TypeScript LSP diagnostics could not run because no language server was available.

## Files Created/Modified

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestions.test.ts`
