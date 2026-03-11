# T01: 41-feedback-driven-learning 01

**Slice:** S12 — **Milestone:** M007

## Description

Create the foundation types, config schema, and knowledge store query methods for feedback-driven learning.

Purpose: Establish the data contracts and storage layer that the aggregator, safety guard, and pipeline integration will build upon in subsequent plans.
Output: `src/feedback/types.ts` with all shared types, KnowledgeStore with aggregation + clear methods, and `.kodiai.yml` feedback config section.

## Must-Haves

- [ ] "FeedbackPattern type exists with fingerprint, thumbsDownCount, thumbsUpCount, distinctReactors, distinctPRs, severity, category, sampleTitle fields"
- [ ] "FeedbackSuppressionConfig type mirrors the .kodiai.yml feedback.autoSuppress schema shape"
- [ ] "KnowledgeStore has aggregateFeedbackPatterns() method that returns FeedbackPattern[] grouped by title fingerprint"
- [ ] "KnowledgeStore has clearFeedbackSuppressions() method that deletes feedback_reactions for a repo"
- [ ] ".kodiai.yml accepts a feedback.autoSuppress section with enabled (default false) and thresholds (minThumbsDown=3, minDistinctReactors=3, minDistinctPRs=2)"
- [ ] "Invalid feedback config falls back to defaults with a config warning, not a crash"

## Files

- `src/feedback/types.ts`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/execution/config.ts`
