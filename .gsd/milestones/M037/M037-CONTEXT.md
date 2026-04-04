---
depends_on: [M036]
---

# M037: Embedding-Based Suggestion Clustering & Reinforcement Learning

**Gathered:** 2026-04-04
**Status:** Queued — pending auto-mode execution
**Depends on:** M036

## Project Description

Kodiai's current feedback suppression is fingerprint-based: a specific finding title must appear N times with thumbsDown reactions before it's suppressed. This misses thematically similar findings worded differently. kodus-ai's `KodyFineTuningService` (37kb NestJS service) solves this via k-means clustering on suggestion embeddings — findings in the same cluster share suppression fate and, more importantly, the system uses **both positive and negative signals**. Positive signals (accepted, implemented) reinforce which suggestion types this team values; negative signals (thumbsDown, suppressed) identify what to reduce.

## Why This Milestone

The learning_memories table (added incrementally over prior milestones) now contains per-finding embeddings with outcome labels. M036 uses this data to generate rules. M037 uses the same data for a different purpose: real-time filtering and boosting during review generation. Before the agent produces final findings for a PR, we:
1. Embed the current draft findings
2. Compare against the cluster model of past positive/negative outcomes for this repo
3. Filter out findings similar to persistently-negative clusters
4. Boost confidence for findings similar to persistently-positive clusters
5. Use this as a pre-LLM filter, not a post-LLM comment filter

This is qualitatively different from M036 — M036 generates durable rules (persist between runs). M037 produces ephemeral per-run adjustments (no DB write, just scoring).

## User-Visible Outcome

### When this milestone is complete:
- Findings similar to patterns this team consistently dismisses are filtered before reaching the LLM's output stage
- Findings similar to patterns this team consistently acts on appear with boosted confidence
- Both positive and negative historical signals influence what the reviewer sees
- The suppression model is thematic (embedding similarity), not just exact-fingerprint

### Entry point / environment
- Entry point: `src/handlers/review.ts` review pipeline
- Environment: production
- Live dependencies: PostgreSQL (learning_memories with embeddings), Voyage AI (embedding generation for draft findings)

## Completion Class

- Contract complete means: cluster model built from learning memories; draft findings scored against model; filtering/boosting logic wired into review pipeline before comment creation
- Integration complete means: end-to-end review with sufficient learning history shows different comment set vs. naive unfiltered run
- Operational complete means: cluster model is refreshed on a schedule (not recomputed per-request); fail-open on cluster model unavailability

## Final Integrated Acceptance

- Given a repo with 50+ learning memories where a recurring pattern has 10+ thumbsDown outcomes, a new PR whose findings include a thematically similar finding (>0.75 cosine similarity to the negative cluster centroid) suppresses that finding
- Given a repo where a pattern has 10+ accepted/thumbsUp outcomes, a new PR with a similar finding gets its confidence_band elevated from `low` to `medium` or `high`
- Cluster model refresh does not block the review pipeline (computed async, cached in DB)

## Risks and Unknowns

- **Cold start** — repos with <50 learning memories have no meaningful cluster model. Must fail gracefully (no scoring, proceed normally).
- **Cluster model staleness** — model must be refreshed periodically, not on every review. Cache with TTL or background refresh job.
- **False suppression** — thematic similarity does not mean the finding is wrong. The suppression threshold needs to be conservative to avoid hiding real bugs. Use a higher threshold (e.g., 0.85) for suppression than for boosting (0.70).
- **Positive reinforcement of bad patterns** — if the team consistently accepts a bad practice (e.g., no error handling), the positive signal will start boosting findings that encourage that practice. Need safety guard: do not boost CRITICAL severity findings regardless of cluster signal (similar to existing safety guard in feedback/safety-guard.ts).

## Existing Codebase / Prior Art

- `src/knowledge/cluster-matcher.ts` — dual-signal cluster matching with cosine similarity; established pattern to extend
- `src/knowledge/cluster-pipeline.ts` — `cosineSimilarity` helper; clustering utilities
- `src/knowledge/memory-store.ts` — `LearningMemoryStore`; pgvector HNSW index for ANN queries
- `src/feedback/aggregator.ts` — threshold-based suppression pattern; extend for embedding-based suppression
- `src/feedback/safety-guard.ts` — `isFeedbackSuppressionProtected`; must be respected in new suppression path too
- `src/feedback/confidence-adjuster.ts` — `adjustConfidenceForFeedback`; extend for cluster-based confidence adjustment
- `src/handlers/review.ts` — `evaluateFeedbackSuppressions` call site; new cluster-based scoring wires in here

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions.

## Scope

### In Scope

- `buildClusterModel(repo, store, logger)` — builds positive/negative cluster sets from learning memories for a repo; cached in DB with TTL
- New DB table: `suggestion_cluster_models` (repo, positive_centroids JSONB, negative_centroids JSONB, member_count, built_at, expires_at)
- `scoreFindings(draftFindings, clusterModel, embeddingProvider, logger)` — embeds each draft finding, scores against positive/negative centroids, returns adjusted confidence and suppression flags
- Wire into review pipeline: after draft findings generated, before comment creation, score and filter
- `adjustClusterConfidence` — extends existing `adjustConfidenceForFeedback` with cluster signal
- Safety guard: CRITICAL findings cannot be suppressed regardless of cluster signal
- Cluster model refresh: background job (reuses wiki-update-generator sweep pattern), TTL 24h
- Tests: cluster model building, scoring, safety guard, fail-open behavior

### Out of Scope / Non-Goals

- Positive signal reinforcing changes to the LLM prompt (that's M036's territory)
- UI for cluster visualization
- Cross-repo cluster aggregation
- Fine-tuning weights between positive/negative cluster signals (use fixed defaults)
- Real-time cluster model update on each review (batch refresh only)

## Technical Constraints

- Scoring must be fail-open: unavailable cluster model → skip scoring, proceed with original findings
- Suppression threshold: 0.85 cosine similarity to negative centroid (conservative)
- Boost threshold: 0.70 cosine similarity to positive centroid
- Safety guard: CRITICAL severity findings bypass suppression
- Cluster model must have ≥5 members before it participates in scoring

## Integration Points

- `src/handlers/review.ts` — wire scoreFindings call after draft findings collected
- `src/feedback/confidence-adjuster.ts` — extend with cluster-based adjustment
- `src/feedback/safety-guard.ts` — reuse safety guard logic
- `src/knowledge/store.ts` — add cluster model cache read/write to KnowledgeStore interface
- `src/db/migrations/` — add suggestion_cluster_models table

## Open Questions

- None — approach is clear from codebase inspection and kodus-ai reference implementation.
