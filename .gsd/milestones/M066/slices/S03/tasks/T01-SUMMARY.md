---
id: T01
parent: S03
milestone: M066
key_files:
  - src/execution/formatter-suggestion-publisher.test.ts
  - src/execution/formatter-suggestion-publisher.ts
key_decisions:
  - Defined a narrow `FormatterSuggestionPublisherOctokit` port around `rest.pulls.createReview` so tests and S04 callers depend only on the one GitHub operation this publisher is allowed to perform.
  - Kept T01 implementation scoped to the core posted path; no-op, idempotency, outgoing safety, and rejection conversion remain for later planned tasks.
duration: 
verification_result: passed
completed_at: 2026-05-05T00:42:07.243Z
blocker_discovered: false
---

# T01: Added the formatter suggestion publisher contract and batched GitHub createReview payload tests.

**Added the formatter suggestion publisher contract and batched GitHub createReview payload tests.**

## What Happened

Created `src/execution/formatter-suggestion-publisher.test.ts` test-first to pin the public `publishFormatterSuggestionReview()` contract against a fake Octokit. The RED run failed because the module was missing, then `src/execution/formatter-suggestion-publisher.ts` was added with exported publisher options/result/status types, a minimal Octokit port, review body construction, optional review-output marker inclusion, and deterministic mapping from S02 `FormatterSuggestionPayload[]` to one GitHub Pull Request Review `comments` array. The implementation passes through `commitId` as `commit_id`, uses `event: "COMMENT"`, preserves single-line and multi-line RIGHT-side mappings, and returns a structured posted result with posted/skipped counts and review id/url fields for downstream S04 inspection.

## Verification

Ran the targeted publisher test, the formatter mapper plus publisher slice check, and the configured S01/S02/S03 regression bundle. All verification commands exited 0. LSP diagnostics were attempted for the new TypeScript files, but no language server was available in this harness; Bun test execution provided the effective TypeScript/runtime check.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` | 0 | ✅ pass | 8ms |
| 2 | `bun test ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` | 0 | ✅ pass | 15ms |
| 3 | `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` | 0 | ✅ pass | 6450ms |

## Deviations

None.

## Known Issues

`memory_query` failed before implementation with `database disk image is malformed`; this did not affect source changes or test verification. TypeScript LSP diagnostics were unavailable (`No language server found`).

## Files Created/Modified

- `src/execution/formatter-suggestion-publisher.test.ts`
- `src/execution/formatter-suggestion-publisher.ts`
