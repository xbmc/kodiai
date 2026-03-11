# S03: Knowledge Store Explicit Learning

**Goal:** Create the SQLite-backed knowledge store that persists review findings, metrics, and suppression history.
**Demo:** Create the SQLite-backed knowledge store that persists review findings, metrics, and suppression history.

## Must-Haves


## Tasks

- [x] **T01: 28-knowledge-store-explicit-learning 01** `est:9min`
  - Create the SQLite-backed knowledge store that persists review findings, metrics, and suppression history. This is the storage foundation for Phase 28.

Purpose: All other Phase 28 features (suppression tracking, confidence scoring, metrics display, CLI reporting) need a place to persist and query data. The knowledge store follows the exact same factory pattern as the existing telemetry store.

Output: `createKnowledgeStore()` factory function with types, schema, and comprehensive tests.
- [x] **T02: 28-knowledge-store-explicit-learning 02** `est:6min`
  - Add suppression pattern config schema and confidence scoring engine. These are the two configuration and computation primitives that the handler and prompt will consume.

Purpose: Users need to configure what findings to suppress (LEARN-02) and what confidence threshold to apply (LEARN-03). The confidence engine computes scores from deterministic signals per the locked decision.

Output: Extended config schema with `review.suppressions` and `review.minConfidence`, plus `computeConfidence()` and `matchesSuppression()` pure functions with tests.
- [x] **T03: 28-knowledge-store-explicit-learning 03** `est:7min`
  - Wire the knowledge store, suppression matching, confidence scoring, and review metrics into the review pipeline. This is the integration plan that connects Plans 01 and 02 to the live review flow.

Purpose: The storage and computation primitives exist; now they need to flow through the prompt (so Claude respects suppressions and outputs structured data) and through the handler (so findings are persisted and metrics are collected). This delivers LEARN-01 through LEARN-04.

Output: Enriched review prompt with suppression/confidence/metrics sections, handler integration with knowledge store writes, and app-level initialization.
- [x] **T04: 28-knowledge-store-explicit-learning 04** `est:5min`
  - Create CLI query scripts for operators to inspect knowledge store data on demand. These mirror the existing `scripts/usage-report.ts` pattern.

Purpose: Users need to query review statistics and trends for their repos (LEARN-04 and locked decision about CLI query commands). The scripts are self-contained -- they open the SQLite database directly without importing from src/.

Output: Two standalone CLI scripts: `kodiai-stats.ts` and `kodiai-trends.ts`.
- [x] **T05: 28-knowledge-store-explicit-learning 07** `est:5 min`
  - Close unresolved Phase 28 verification gaps by wiring runtime finding extraction, deterministic suppression/confidence behavior, and enforced quantitative review-details output.

Purpose: Phase 28 infrastructure exists, but LEARN-01..LEARN-04 remain blocked because runtime currently uses placeholder findings and model-only formatting compliance. This plan completes the runtime loop so learning behavior is deterministic and persistently queryable.

Output: Review-handler extraction/filtering/persistence pipeline plus tests that lock suppression, minConfidence soft filtering, and required Review Details metrics/time-saved output.

## Files Likely Touched

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/knowledge/confidence.ts`
- `src/knowledge/confidence.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/index.ts`
- `scripts/kodiai-stats.ts`
- `scripts/kodiai-trends.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
