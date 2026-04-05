---
id: M037
title: "Embedding-Based Suggestion Clustering & Reinforcement Learning"
status: complete
completed_at: 2026-04-05T09:48:28.566Z
key_decisions:
  - D031 — Keep suggestion-cluster builder isolated from the live review-path modules and query `learning_memories` directly via SQL.
  - D032 — Store positive/negative cluster centroids as JSONB `number[][]` in `suggestion_cluster_models` rather than pgvector.
  - D033 — Apply the safety guard symmetrically so protected findings receive neither cluster suppression nor confidence boosts.
  - D034 — Apply cluster scoring after feedback adjustment so user feedback remains upstream of thematic confidence changes.
  - S03 stale-policy decision — allow a bounded 4-hour grace window beyond the 24-hour TTL and route live scoring through a centralized stale-aware resolver.
key_files:
  - src/db/migrations/036-suggestion-cluster-models.sql
  - src/knowledge/suggestion-cluster-store.ts
  - src/knowledge/suggestion-cluster-builder.ts
  - src/knowledge/suggestion-cluster-refresh.ts
  - src/knowledge/suggestion-cluster-scoring.ts
  - src/knowledge/suggestion-cluster-staleness.ts
  - src/knowledge/suggestion-cluster-degradation.ts
  - src/feedback/confidence-adjuster.ts
  - src/handlers/review.ts
  - scripts/verify-m037-s01.ts
  - scripts/verify-m037-s02.ts
  - scripts/verify-m037-s03.ts
  - package.json
lessons_learned:
  - For ephemeral ML-like caches, a dual-read store surface plus a single stale-policy resolver prevents runtime drift between strict freshness and graceful degradation behavior.
  - Verifier-driven closure found a real integration mismatch in the live review path; keeping proof harnesses authoritative is better than weakening them when they expose runtime bugs.
  - Safety guards for review findings must block confidence boosts as well as suppressions on protected findings; one-sided protection is incomplete.
  - JSONB centroid storage is sufficient and simpler than pgvector when the workload is bounded per-repo cache reads with no ANN retrieval requirement.
---

# M037: Embedding-Based Suggestion Clustering & Reinforcement Learning

**Delivered cached suggestion-cluster models, safety-guarded thematic review scoring, and stale-aware fail-open refresh behavior with machine-verifiable proof across all milestone slices.**

## What Happened

M037 shipped the full embedding-based suggestion clustering path in three slices. S01 added the persistence and build substrate: migration 036, a standalone SuggestionClusterStore with fresh and stale read surfaces, a cluster-model builder that derives positive and negative centroids from learning memories, a bounded background refresh entrypoint, and a deterministic verifier. S02 built the thematic scoring layer, centralized cluster-score adjustment in the confidence adjuster, wired the review handler to load cached models fail-open, and proved both suppression and confidence boosting while extending the safety guard so protected findings never receive cluster-derived suppression or boosts. S03 hardened the system operationally by centralizing stale-model policy, adding a never-throwing degradation wrapper, routing the live review path through the stale-aware loader, and proving cached reuse, bounded stale grace, refresh-sweep behavior, and naive-path fallback. Verification for milestone closure confirmed there are real non-.gsd code changes in the milestone diff, all slice summaries and task summaries exist, all roadmap slice outcomes were delivered, and the machine-verifiable harnesses for S01, S02, and S03 all pass.

## Success Criteria Results

- **Cached cluster-model substrate delivered:** Met. S01 added `src/db/migrations/036-suggestion-cluster-models.sql`, `src/knowledge/suggestion-cluster-store.ts`, `src/knowledge/suggestion-cluster-builder.ts`, `src/knowledge/suggestion-cluster-refresh.ts`, and `scripts/verify-m037-s01.ts`. Fresh verification: `bun run verify:m037:s01 -- --json` passed all three checks (`M037-S01-BUILD-AND-CACHE`, `M037-S01-REFRESH-SWEEP`, `M037-S01-FAIL-OPEN`).
- **Review-time thematic scoring is conservative, thematic, and safety-guarded:** Met. S02 added `src/knowledge/suggestion-cluster-scoring.ts`, wired `src/handlers/review.ts`, and added `applyClusterScoreAdjustment()` in `src/feedback/confidence-adjuster.ts`. Fresh verification: `bun run verify:m037:s02 -- --json` passed all three checks, including `M037-S02-SAFETY-GUARD-CRITICAL`, proving protected findings are not suppressed or boosted.
- **Refresh, staleness handling, and non-blocking degradation delivered:** Met. S03 added `src/knowledge/suggestion-cluster-staleness.ts`, `src/knowledge/suggestion-cluster-degradation.ts`, and `scripts/verify-m037-s03.ts`; it also corrected the live review path to use the stale-aware loader. Fresh verification: `bun run verify:m037:s03 -- --json` passed all four checks, including cached reuse, stale-grace enforcement, refresh processing, and naive fail-open fallback.
- **Milestone produced actual code, not only planning artifacts:** Met. `git diff --stat HEAD~1 HEAD -- ':!.gsd/'` shows non-.gsd changes in `package.json`, `scripts/verify-m037-s03.ts`, `scripts/verify-m037-s03.test.ts`, `src/knowledge/suggestion-cluster-degradation.ts`, `src/knowledge/suggestion-cluster-degradation.test.ts`, and `src/knowledge/suggestion-cluster-staleness.ts`.
- **Cross-slice integration works:** Met. S03 verifier shows `getModelIncludingStaleCalls=1` and `getModelCalls=0`, proving the runtime path consumes the stale-aware store contract established by S01 and the scoring path established by S02.

## Definition of Done Results

- **All slices complete:** Met. Roadmap shows S01, S02, and S03 all marked ✅.
- **All slice summaries exist:** Met. Verified on disk: `.gsd/milestones/M037/slices/S01/S01-SUMMARY.md`, `.gsd/milestones/M037/slices/S02/S02-SUMMARY.md`, `.gsd/milestones/M037/slices/S03/S03-SUMMARY.md`.
- **Task summaries exist for delivered slice work:** Met. Verified nine task summaries on disk under `.gsd/milestones/M037/slices/S01/tasks/`, `S02/tasks/`, and `S03/tasks/`.
- **Cross-slice integration points are closed:** Met. S02 consumes S01's `SuggestionClusterStore` and model shape; S03 consumes S01's dual-read store and hardens S02's live review insertion point. Fresh verifier evidence from `verify:m037:s03` shows cached reuse through `getModelIncludingStale()` and review fallback to the naive path when the cluster layer is unavailable.
- **Definition of done verification passed:** Met. The milestone has real code changes, slice artifacts are present, and all three milestone proof harnesses pass on rerun.

## Requirement Outcomes

No numbered requirements changed status during M037. Verification against `.gsd/REQUIREMENTS.md` found no M037-owned active requirements and no supported status transition to record. This milestone delivered enabling review-path infrastructure and verification surfaces, but it did not validate, defer, block, or close any existing requirement entry.

## Deviations

S01 intentionally did not reuse `cluster-pipeline.ts` / `cluster-matcher.ts`; the builder implemented local HDBSCAN/mean wiring to avoid coupling the cache-management substrate to live review-path modules. S02 also extended the planned safety guard to block confidence boosting on protected findings, which was a conservative but correct tightening of the design. M037-VALIDATION recorded a `needs-attention` verdict for partial ops-proof, but milestone completion verification found the roadmap success criteria and definition of done fully satisfied and treated the remaining scheduler-level proof as non-blocking follow-up work.

## Follow-ups

Operational scheduler wiring and production cadence/metrics for cluster refresh remain a follow-up if the team wants scheduler-level proof beyond the in-process verifier coverage already shipped in M037. If thematic scoring is intended to remain a governed product contract, add a dedicated requirement entry so future milestone validation has explicit traceability.
