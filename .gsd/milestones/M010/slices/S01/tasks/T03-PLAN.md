# T03: 56-foundation-layer 03

**Slice:** S01 — **Milestone:** M010

## Description

Surface unrecognized bracket tags as component/platform focus hints in the review prompt and Review Details output (INTENT-01).

Purpose: Unrecognized bracket tags should guide attention ("focus hints") rather than being labeled as "ignored", improving intent UX without changing core behavior.
Output: Prompt builder accepts focus hints, handler threads them through, and Review Details keyword parsing renders them as focus hints.

## Must-Haves

- [ ] "When PR titles contain unrecognized bracket tags (e.g. [Auth], [iOS]), the review prompt includes them as focus hints"
- [ ] "Review Details keyword parsing no longer labels unrecognized tags as 'ignored'"
- [ ] "No behavior changes occur when there are no unrecognized bracket tags"

## Files

- `src/lib/pr-intent-parser.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
