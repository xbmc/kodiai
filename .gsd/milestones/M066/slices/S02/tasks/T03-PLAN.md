---
estimated_steps: 16
estimated_files: 5
skills_used:
  - test-driven-development
  - tdd
  - verify-before-complete
---

# T03: Map safe formatter replacement blocks to capped GitHub suggestion payloads

Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: R082 and R083 require formatter hunks to become deterministic, GitHub-commentable same-PR suggestion payloads while skipping unsafe/unmappable ranges and exposing capped/skipped counts for S03/S04.

Steps:
1. Extend `src/execution/formatter-suggestions.test.ts` with RED tests for `buildPrDiffCommentabilityIndex()` and `mapFormatterDiffToSuggestions()`: one-line replacement maps to `line` only; multi-line replacement maps to `startLine` plus `line`; replacement with different old/new line counts is allowed when every old target line exists in the PR diff RIGHT-side index; pure insertions and pure deletions are skipped; formatter hunks outside the PR diff are skipped; mixed safe/unsafe input returns partial success; `maxSuggestions` keeps first N safe candidates and records `max-suggestions-exceeded` skips.
2. Run `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` and confirm the mapper tests fail before implementation.
3. Implement `buildPrDiffCommentabilityIndex(prDiffText)` in `src/execution/formatter-suggestions.ts` by parsing PR diff hunks and recording RIGHT-side line numbers for context (` `) and additions (`+`), excluding deletions (`-`). Return a path-keyed index suitable for exact line-range checks.
4. Implement changed-block extraction from formatter hunks. For each contiguous changed group, target the formatter old/current `-` line range on PR RIGHT side and put the formatter new/formatted `+` lines in `suggestionBody`. Skip pure insertion (`oldCount=0`) and pure deletion (`newCount=0`) groups for S02.
5. Implement `mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex, maxSuggestions })` returning `suggestions`, `skipped`, `counts`, and `capped`. Suggestion payload body must contain a GitHub markdown block exactly shaped as ```suggestion\n...\n```, with `path`, `line`, optional `startLine`, `side: "RIGHT"`, `suggestionBody`, and source metadata (`oldStart`, `oldEnd`, `newStart`, `hunkHeader`). Enforce maxSuggestions after safety validation and record every dropped safe candidate as `max-suggestions-exceeded`.
6. Run targeted formatter tests, then run the broader S01+S02 regression command: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000`.

Must-haves:
- The mapper never invents PR line mappings: every target old/current line in the formatter replacement range must be present in the RIGHT-side PR diff index for that path.
- The returned payload shape is directly batchable by S03 into `pulls.createReview({ comments: [...] })` after field-name conversion (`startLine` => `start_line`, `side`/`start_side`).
- Result counts distinguish generated suggestions, skipped unsafe/unmappable hunks, capped suggestions, no-op/empty parsed output, and parser skip reasons for S04 reporting.

Failure Modes (Q5): dependency PR diff index lacks target path/range => skip `target-range-not-in-pr-diff`; dependency parsed diff contains unsupported groups => skip with group-level reason; malformed PR diff => index misses ranges and mapper safely skips rather than guessing.

Load Profile (Q6): shared resources are memory/CPU for diff parsing and mapping; per-operation cost is O(PR diff lines + formatter diff lines + candidate groups); 10x breakpoint is very large diffs, mitigated by maxSuggestions cap and no API calls.

Negative Tests (Q7): empty PR diff index, path mismatch, off-by-one target range, pure insertion, pure deletion, mixed safe/unsafe hunks, maxSuggestions = 1 with multiple safe candidates, blank replacement lines, and malformed PR diff hunk.

## Inputs

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestions.test.ts`
- `src/execution/config.test.ts`
- `src/handlers/formatter-suggestion-intent.test.ts`
- `src/handlers/mention.test.ts`
- `src/execution/mcp/inline-review-server.ts`

## Expected Output

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestions.test.ts`

## Verification

bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000

## Observability Impact

Adds structured suggestion, skipped, and capped counts plus per-skip reasons/details for downstream reporting and operator diagnostics.
