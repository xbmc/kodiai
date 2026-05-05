---
id: T03
parent: S03
milestone: M066
key_files:
  - src/execution/formatter-suggestion-publisher.ts
  - src/execution/formatter-suggestion-publisher.test.ts
key_decisions:
  - Preserved the review-output idempotency marker by avoiding the full inbound sanitizeContent pipeline on outgoing review bodies; outgoing protection uses raw secret scanning plus targeted bot mention sanitization instead.
  - Blocked review-body secret results omit reviewOutput marker/key metadata to avoid leaking unsafe generated body content, while comment-secret blocks can retain safe idempotency metadata.
duration: 
verification_result: passed
completed_at: 2026-05-05T00:51:04.219Z
blocker_discovered: false
---

# T03: Added outgoing secret blocking, bot-mention sanitization, and whole-batch GitHub rejection reporting for formatter suggestion reviews.

**Added outgoing secret blocking, bot-mention sanitization, and whole-batch GitHub rejection reporting for formatter suggestion reviews.**

## What Happened

Implemented T03 with test-first coverage through the public publishFormatterSuggestionReview interface. Added negative tests for configured bot handle sanitization in the review body and inline suggestion body, credential-like literals in comment and generated review bodies, and GitHub 422 whole-batch rejection with long secret-bearing messages. The publisher now resolves idempotency first, scans raw review/comment bodies for outgoing secrets before any GitHub write, strips configured bot mentions while preserving suggestion fences and the idempotency marker, returns blocked results with posted: 0 and safe pattern/location fields, and catches createReview rejection into failed results with posted: 0, failed: true, rejection.status, and a bounded redacted rejection message. Optional logger calls are best-effort and emit only safe structured fields. Non-obvious implementation note: the full inbound sanitizeContent pipeline strips HTML comments, so outgoing review bodies intentionally use raw secret scanning plus targeted mention sanitization to preserve the review-output idempotency marker.

## Verification

Ran the slice-required verification command after the final code change. The targeted S02/S03 tests passed with 34 tests and 117 assertions. The regression command passed with 279 tests and 1289 assertions across config, formatter intent, mention, formatter suggestions, and formatter suggestion publisher tests. Observability/result surfaces verified by tests include status values, posted zero for blocked/failed batches, blocked pattern/location, rejection status/message redaction/truncation, and no createReview call on blocked content.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` | 0 | ✅ pass | 20ms |
| 2 | `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` | 0 | ✅ pass | 6490ms |

## Deviations

Memory lookup and capture failed because the memory database/store is unavailable; the reusable sanitizer marker gotcha is documented in this task summary instead. No implementation deviations from the task plan.

## Known Issues

The GSD memory store reported errors during memory_query and capture_thought, so reusable knowledge could not be persisted there from this task. No code issues discovered.

## Files Created/Modified

- `src/execution/formatter-suggestion-publisher.ts`
- `src/execution/formatter-suggestion-publisher.test.ts`
