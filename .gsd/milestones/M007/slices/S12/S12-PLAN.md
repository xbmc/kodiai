# S12: Feedback Driven Learning

**Goal:** Create the foundation types, config schema, and knowledge store query methods for feedback-driven learning.
**Demo:** Create the foundation types, config schema, and knowledge store query methods for feedback-driven learning.

## Must-Haves


## Tasks

- [x] **T01: 41-feedback-driven-learning 01** `est:4min`
  - Create the foundation types, config schema, and knowledge store query methods for feedback-driven learning.

Purpose: Establish the data contracts and storage layer that the aggregator, safety guard, and pipeline integration will build upon in subsequent plans.
Output: `src/feedback/types.ts` with all shared types, KnowledgeStore with aggregation + clear methods, and `.kodiai.yml` feedback config section.
- [x] **T02: 41-feedback-driven-learning 02** `est:3min`
  - Build the feedback aggregator, safety guard, confidence adjuster, and barrel export using TDD.

Purpose: Create the core business logic that decides which finding patterns to auto-suppress based on feedback, with safety floors preventing suppression of critical/security findings.
Output: Tested pure-function modules in `src/feedback/` with a public `evaluateFeedbackSuppressions()` orchestrator.
- [x] **T03: 41-feedback-driven-learning 03** `est:4min`
  - Integrate feedback-driven suppression and confidence adjustment into the review pipeline with transparent disclosure in Review Details.

Purpose: Connect the feedback evaluation logic from plan 02 into the live review handler so that consistently-rejected patterns are auto-suppressed, confidence reflects feedback history, and Review Details reports the suppression count.
Output: review.ts with feedback suppression in the post-enforcement pipeline, feedback-adjusted confidence scores, and Review Details disclosure line.

## Files Likely Touched

- `src/feedback/types.ts`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/execution/config.ts`
- `src/feedback/aggregator.ts`
- `src/feedback/aggregator.test.ts`
- `src/feedback/safety-guard.ts`
- `src/feedback/safety-guard.test.ts`
- `src/feedback/confidence-adjuster.ts`
- `src/feedback/confidence-adjuster.test.ts`
- `src/feedback/index.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
