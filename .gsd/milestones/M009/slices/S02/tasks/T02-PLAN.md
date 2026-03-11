# T02: 52-intelligent-retrieval 02

**Slice:** S02 — **Milestone:** M009

## Description

Wire `buildRetrievalQuery()` and `rerankByLanguage()` into the review handler's retrieval path, replacing the simple title+files query with multi-signal construction and adding post-retrieval language-aware re-ranking.

Purpose: This connects the pure functions from 52-01 to the live review pipeline, completing RET-01 and RET-02. The integration must preserve fail-open semantics — if the new code encounters any issue, the review proceeds without retrieval context.

Output: Updated `review.ts` with enriched retrieval queries and language-aware result ordering.

## Must-Haves

- [ ] "Retrieval queries incorporate PR intent, detected languages, diff risk signals, and author tier instead of just title and file paths"
- [ ] "Same-language historical findings rank higher than cross-language results in retrieval output"
- [ ] "A TypeScript PR retrieves TypeScript-specific historical findings preferentially over Python findings at similar distance"

## Files

- `src/handlers/review.ts`
