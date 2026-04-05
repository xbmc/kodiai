---
id: S02
parent: M037
milestone: M037
provides:
  - scoreFindings() — async batch scorer returning ScoredFindings<T> with suppression/boost signals per finding
  - applyClusterScoreAdjustment() — exported from feedback/index.ts; merges cluster signals into a finding with safety guard and clamping
  - isModelEligibleForScoring() — cold-start guard checking minimum centroid membership
  - scoreFindingEmbedding() — pure sync scorer for testing and harness use without embedding I/O
  - verify:m037:s02 proof harness with 3 machine-checkable checks
requires:
  - slice: S01
    provides: SuggestionClusterStore (getModel/saveModel), suggestion_cluster_models migration, cluster model shape (positiveCentroids/negativeCentroids/memberCount), buildClusterModel for integration context
affects:
  - S03 — staleness handling and fail-open verification build on top of the cluster scoring pipeline established here; the S03 verifier will cover both S01 cached-reuse and S02 scoring-changes-findings behaviors together
key_files:
  - src/knowledge/suggestion-cluster-scoring.ts
  - src/knowledge/suggestion-cluster-scoring.test.ts
  - src/feedback/confidence-adjuster.ts
  - src/feedback/confidence-adjuster.test.ts
  - src/handlers/review.ts
  - src/feedback/index.ts
  - scripts/verify-m037-s02.ts
  - scripts/verify-m037-s02.test.ts
  - package.json
key_decisions:
  - Safety guard extended to block both suppression AND confidence boosting for CRITICAL/MAJOR-security/MAJOR-correctness findings (D033)
  - Cluster scoring applied after feedback-adjustment map so boosts build on user-adjusted confidence, not raw base (D034)
  - Already-suppressed findings skip cluster pass — cluster cannot unsuppress
  - Suppression and boosting are mutually exclusive paths; suppression takes precedence
  - applyClusterScoreAdjustment centralized in confidence-adjuster.ts alongside the existing feedback-adjustment path
  - gate=cluster-scoring structured log emits clusterSuppressedCount and clusterBoostedCount for ops observability
patterns_established:
  - Sequential EmbeddingProvider stub pattern for multi-finding scoreFindings() tests (queue of pre-computed embeddings dispatched per call)
  - Safety guard symmetry: single guard checkpoint blocks both suppress and boost paths — not two independent checks
  - cluster scoring ordering: feedback-adjust first, then cluster-adjust
observability_surfaces:
  - gate=cluster-scoring info log with clusterSuppressedCount and clusterBoostedCount on every review that runs cluster scoring
  - gate=cluster-model-load debug log with model TTL remaining when a model is loaded
  - Machine-verifiable harness scripts/verify-m037-s02.ts with JSON output mode for CI integration
drill_down_paths:
  - .gsd/milestones/M037/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M037/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M037/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T08:07:18.135Z
blocker_discovered: false
---

# S02: Thematic Finding Scoring and Review Integration

**Ephemeral cluster-scoring layer wired into the review pipeline: suppressions and confidence boosts from cached centroid models with safety guards for CRITICAL/protected findings, 82 tests passing, and a 3-check machine-verifiable proof harness.**

## What Happened

S02 built the ephemeral scoring layer that sits between cluster model loading and review comment creation. Three tasks in sequence:

**T01 — suggestion-cluster-scoring.ts:** Built the pure-function scoring core. Three exported tiers: `isModelEligibleForScoring()` (cold-start guard requiring MIN_CENTROID_MEMBERS=5), `scoreFindingEmbedding()` (pure sync scorer — centroid similarity lookup against positive/negative clusters), and `scoreFindings<T>()` (async batch scorer with full fail-open). Reused `cosineSimilarity` from cluster-pipeline.ts and `isFeedbackSuppressionProtected` from safety-guard.ts. Extended the safety guard to block both suppression AND boosting on CRITICAL and MAJOR-security/correctness findings — not just suppression. The conservative threshold constants (SUPPRESSION_THRESHOLD ≥ 0.80, BOOST_THRESHOLD < SUPPRESSION_THRESHOLD) and the `noOpResult()` consistency helper were established here. 36 tests covering all boundary conditions, fail-open paths, and threshold guards.

**T02 — review pipeline integration:** Added `applyClusterScoreAdjustment()` to confidence-adjuster.ts as the merge point for cluster-derived signals. Wired `clusterModelStore` as an optional dep in `createReviewHandler`, loaded fail-open after `evaluateFeedbackSuppressions`. Key ordering decision: cluster scoring runs after the initial `processedFindings` feedback-adjustment map so boosts apply to feedback-adjusted confidence, not raw base confidence. Already-suppressed findings skip the cluster pass (cluster cannot unsuppress). Structured log gate at `gate=cluster-scoring` emits suppressed/boosted counts. Re-exported `applyClusterScoreAdjustment` from feedback/index.ts. 22 tests including CRITICAL bypass, MAJOR security bypass, lower-severity suppression, confidence boost, fail-open, boost-wins path, and clamping.

**T03 — proof harness:** Built `scripts/verify-m037-s02.ts` with three machine-checkable checks: `M037-S02-SCORING-CHANGES-FINDINGS` (suppression and boosting vs naive path with deterministic fixture), `M037-S02-SAFETY-GUARD-CRITICAL` (CRITICAL protected at threshold boundary using `scoreFindingEmbedding()` directly), and `M037-S02-FAIL-OPEN` (null model preserves all findings unchanged). 24 tests cover each check's pass/fail semantics. Also added `verify:m037:s01` to package.json (was missing). Harness follows the `verify-m037-s01.ts` pattern with injectable `_runFn` overrides, `evaluateM037S02()`, `buildM037S02ProofHarness()`, text/JSON output modes.

## Verification

bun test ./src/knowledge/suggestion-cluster-scoring.test.ts ./src/feedback/confidence-adjuster.test.ts ./scripts/verify-m037-s02.test.ts — 82/82 pass (187ms). bun run verify:m037:s02 -- --json — exits 0, all three checks PASS: SCORING-CHANGES-FINDINGS (suppressed=true, boostedConfidence=70), SAFETY-GUARD-CRITICAL (suppressed=false, boosted=false at threshold boundary), FAIL-OPEN (modelUsed=false, allUnsuppressed=true, confidenceUnchanged=true). bun run tsc --noEmit — exit 0, no output.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T01 extended the safety guard to block confidence boosting on CRITICAL/protected findings, not just suppression — the M037 milestone context only mentioned suppression bypass, but boosting is equally unsafe and the conservative interpretation is correct. T02 applied cluster scoring after the feedback-adjustment map (ordering was unspecified in the plan but is the correct sequence). T03 added verify:m037:s01 to package.json which was missing from T01 delivery.

## Known Limitations

Cluster scoring in the review pipeline requires clusterModelStore to be wired into createReviewHandler at instantiation time. The store is optional (nil = fail-open), but any deployment that wants cluster scoring must pass the store dep. This is a deliberate design: the store is optional so the pipeline is always non-blocking, but the dep must be explicitly wired.

## Follow-ups

S03 adds staleness handling, background refresh integration, and the S02+S03 combined fail-open verification.

## Files Created/Modified

- `src/knowledge/suggestion-cluster-scoring.ts` — New: ephemeral thematic scoring layer — isModelEligibleForScoring, scoreFindingEmbedding, scoreFindings, SUPPRESSION_THRESHOLD, BOOST_THRESHOLD constants
- `src/knowledge/suggestion-cluster-scoring.test.ts` — New: 36 tests covering all scoring paths, safety guards, fail-open, and threshold boundary conditions
- `src/feedback/confidence-adjuster.ts` — Added applyClusterScoreAdjustment() — merge point for cluster suppress/boost signals with safety guard and clamping
- `src/feedback/confidence-adjuster.test.ts` — Added 10 tests for applyClusterScoreAdjustment covering CRITICAL bypass, severity-conditional suppression, boost, fail-open, and clamping
- `src/handlers/review.ts` — Wired clusterModelStore optional dep; loadClusterModel fail-open after evaluateFeedbackSuppressions; cluster scoring pass with applyClusterScoreAdjustment per-finding; structured logging
- `src/feedback/index.ts` — Re-exported applyClusterScoreAdjustment for external consumers
- `scripts/verify-m037-s02.ts` — New: 3-check proof harness (SCORING-CHANGES-FINDINGS, SAFETY-GUARD-CRITICAL, FAIL-OPEN) with injectable _runFn, text/JSON output modes
- `scripts/verify-m037-s02.test.ts` — New: 24 tests covering each check's pass/fail semantics and evaluateM037S02/buildM037S02ProofHarness
- `package.json` — Added verify:m037:s01 and verify:m037:s02 npm scripts
