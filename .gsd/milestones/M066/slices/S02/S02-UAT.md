# S02: Formatter command and diff-to-suggestion mapper — UAT

**Milestone:** M066
**Written:** 2026-05-05T00:33:05.149Z

## Preconditions

- Repository has M066/S02 code present.
- Bun is available.
- No live GitHub credentials or formatter binary are required; S02 is contract-level fixture proof only.

## Test Case 1 — Formatter command runner statuses

1. Run `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000`.
2. Confirm the runner tests pass for missing command, empty stdout, diff stdout, nonzero exit, and timeout.

Expected outcome: `runFormatterCommand()` returns `no-command`, `no-op`, `success`, `failed`, and `timed-out` without throwing or publishing anything to GitHub.

## Test Case 2 — Placeholder safety and diagnostics

1. Inspect the passing test named `resolveFormatterCommand > substitutes only allowlisted placeholders and leaves unknown braces literal`.
2. Inspect the passing nonzero-exit stderr test.

Expected outcome: only `{baseRef}`, `{headRef}`, and `{diffRange}` are substituted; unknown placeholders remain literal. Long/token-like stderr is bounded and redacted before becoming visible diagnostics.

## Test Case 3 — Conservative formatter diff parsing

1. Run the formatter test suite.
2. Confirm parser fixtures pass for one modified file, multiple files/hunks, default hunk counts, blank added lines, and no-newline markers.
3. Confirm binary, added, deleted, renamed, malformed file, and malformed hunk fixtures pass as skipped cases.

Expected outcome: supported modified-file hunks produce file/hunk/line models with old/new cursor data; unsupported or malformed input returns structured skip entries instead of partial ambiguous models.

## Test Case 4 — PR RIGHT-side index behavior

1. Run the formatter test suite.
2. Confirm `buildPrDiffCommentabilityIndex` records RIGHT-side context and addition lines, excludes deletions, and refuses malformed hunk ranges.

Expected outcome: the commentability index contains only line numbers GitHub can target on the PR RIGHT side.

## Test Case 5 — Safe suggestion mapping

1. Run the formatter test suite.
2. Confirm one-line replacement maps with `line` only.
3. Confirm multi-line/uneven replacement maps with `startLine` and `line` when every old target line exists in the PR diff index.
4. Confirm each emitted payload has `path`, `line`, optional `startLine`, `side: "RIGHT"`, markdown ```suggestion blocks, raw `suggestionBody`, and source metadata.

Expected outcome: S03 can convert these payloads directly into a batched GitHub PR review comment list.

## Test Case 6 — Unsafe and excessive hunk handling

1. Run the formatter test suite.
2. Confirm pure insertions and pure deletions are skipped.
3. Confirm path mismatch, off-by-one target ranges, empty PR diff index, and formatter ranges outside the PR diff are skipped as unmappable.
4. Confirm `maxSuggestions = 1` keeps the first safe candidate and reports later safe candidates as `max-suggestions-exceeded`.

Expected outcome: unsafe/unmappable/excessive formatter output does not produce malformed suggestions; returned counts and skip reasons remain visible for downstream logs and PR summary copy.

## Test Case 7 — Full slice regression

1. Run `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000`.

Expected outcome: config, mention intent, mention routing, and formatter suggestion contract tests all pass together; this proves S02 did not regress S01's explicit-request/default-off contract.
