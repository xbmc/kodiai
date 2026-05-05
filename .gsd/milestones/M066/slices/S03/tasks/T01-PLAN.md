---
estimated_steps: 5
estimated_files: 6
skills_used:
  - test-driven-development
  - tdd
  - verify-before-complete
---

# T01: Add publisher contract and batched createReview payload tests

Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: R081 needs a concrete batched publisher boundary before idempotency and failure handling can be meaningful. This task should establish the public API and prove the core GitHub Pull Request Review payload shape with a fake Octokit before implementation.

Steps:
1. In `src/execution/formatter-suggestion-publisher.test.ts`, write RED tests for two S02-style suggestions: one single-line and one multi-line. The fake Octokit should capture calls to `rest.pulls.createReview` and return a review `id` plus `html_url`.
2. Assert exactly one `createReview` call with `owner`, `repo`, `pull_number`, provided `commit_id`, `event: "COMMENT"`, a non-empty review `body`, and two `comments` entries.
3. Assert comment mapping preserves `path`, `line`, `side: "RIGHT"`, uses the S02 `suggestionBody` as the comment body, and maps `startLine` to GitHub `start_line` plus `start_side: "RIGHT"` for multi-line suggestions.
4. Create `src/execution/formatter-suggestion-publisher.ts` with exported options/result/status types and `publishFormatterSuggestionReview()` (or a clearly equivalent exported name). The first implementation should build a review summary body, append `buildReviewOutputMarker(reviewOutputKey)` when provided, map comments, and call `octokit.rest.pulls.createReview` once.
5. Run `bun test ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` until the new core payload tests pass.

Must-haves:
- The publisher accepts S02 `FormatterSuggestionPayload[]` directly; do not reparse formatter diffs in S03.
- The publisher uses `event: "COMMENT"`; do not create pending reviews and do not loop over `createReviewComment`.
- The provided `commitId` is passed through as `commit_id`; do not fetch PR state in this module.

Failure Modes (Q5): dependency `octokit.rest.pulls.createReview` throws => later T03 must convert to `failed`; malformed suggestion ranges are not revalidated here and are expected to be caught by GitHub/S02; missing optional `reviewOutputKey` means the review body has no marker but still publishes.

Load Profile (Q6): shared resource is one GitHub Pull Request Review create request per formatter publication; per-operation cost is one API call with N inline comments; 10x breakpoint is GitHub validation/rate/spam limits on batch size, so this publisher should not add per-comment API loops.

Negative Tests (Q7): single-line vs multi-line payload mapping, marker body presence when `reviewOutputKey` is set, and no accidental extra API calls.

## Inputs

- `src/execution/formatter-suggestions.ts`
- `src/handlers/review-idempotency.ts`
- `src/execution/mcp/review-output-publication-gate.ts`
- `src/lib/sanitizer.ts`

## Expected Output

- `src/execution/formatter-suggestion-publisher.ts`
- `src/execution/formatter-suggestion-publisher.test.ts`

## Verification

bun test ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000

## Observability Impact

Adds the result-shape foundation S04 can inspect: status, posted count, review id/url, review output key/marker status, and input skip summaries.
