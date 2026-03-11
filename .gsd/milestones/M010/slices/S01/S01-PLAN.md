# S01: Foundation Layer

**Goal:** Add an additive knowledge-store table and a dedicated merge event handler so Kodiai can record dependency bump merge history for later trend analysis (DEP-05).
**Demo:** Add an additive knowledge-store table and a dedicated merge event handler so Kodiai can record dependency bump merge history for later trend analysis (DEP-05).

## Must-Haves


## Tasks

- [x] **T01: 56-foundation-layer 01** `est:6min`
  - Add an additive knowledge-store table and a dedicated merge event handler so Kodiai can record dependency bump merge history for later trend analysis (DEP-05).

Purpose: Phase 56 requires persistence of dependency bump outcomes after merge, without triggering reviews or posting any comments.
Output: A new `dep_bump_merge_history` table + insert API in the knowledge store, and a `pull_request.closed` handler that records merged dep bump PRs.
- [x] **T02: 56-foundation-layer 02** `est:9m`
  - Extend the telemetry SQLite store and wire retrieval-quality logging after retrieval context generation (RET-05).

Purpose: Phase 56 needs low-risk observability for retrieval behavior to support later adaptive thresholds and tuning.
Output: New telemetry table + insert API, and review handler wiring that records result count, avg adjusted distance, threshold used, and language match ratio.
- [x] **T03: 56-foundation-layer 03** `est:4m`
  - Surface unrecognized bracket tags as component/platform focus hints in the review prompt and Review Details output (INTENT-01).

Purpose: Unrecognized bracket tags should guide attention ("focus hints") rather than being labeled as "ignored", improving intent UX without changing core behavior.
Output: Prompt builder accepts focus hints, handler threads them through, and Review Details keyword parsing renders them as focus hints.

## Files Likely Touched

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/handlers/dep-bump-merge-history.ts`
- `src/handlers/dep-bump-merge-history.test.ts`
- `src/index.ts`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/lib/pr-intent-parser.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
