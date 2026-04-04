---
id: S01
parent: M036
milestone: M036
provides:
  - GeneratedRuleStore with savePendingRule, activateRule, retireRule, getActiveRulesForRepo, listRulesForRepo, getLifecycleCounts
  - generatePendingRuleProposals — deterministic positive-cluster → proposal candidate pipeline
  - createGeneratedRuleSweep — fail-open background sweep entrypoint with dry-run support
  - 035-generated-rules.sql migration — generated_rules table with lifecycle indexes
  - verify-m036-s01.ts proof harness with verify:m036:s01 package script
requires:
  []
affects:
  - S02
  - S03
key_files:
  - src/db/migrations/035-generated-rules.sql
  - src/knowledge/generated-rule-store.ts
  - src/knowledge/generated-rule-store.test.ts
  - src/knowledge/generated-rule-proposals.ts
  - src/knowledge/generated-rule-proposals.test.ts
  - src/knowledge/generated-rule-sweep.ts
  - src/knowledge/generated-rule-sweep.test.ts
  - scripts/verify-m036-s01.ts
  - scripts/verify-m036-s01.test.ts
  - src/knowledge/index.ts
key_decisions:
  - Deduplicate generated rules by (repo, title); pending upserts must not downgrade ACTIVE or RETIRED lifecycle state (D029).
  - Signal score formula: positive_ratio × support, where support ramps 0→1 over minPositiveMembers → 2×minPositiveMembers — keeps sparse clusters pending while letting large clean clusters rise (D030).
  - Keep generated_rules table separate from learning_memories — no lifecycle state mixing.
  - Sweep processes repos sequentially and isolates failures at three boundaries (discovery, generation, persistence) to remain fail-open.
  - Store and proposals export pure TypeScript interfaces usable with injectable sql/store stubs to enable unit testing without a live DB.
patterns_established:
  - Non-downgrading upsert pattern: ON CONFLICT DO UPDATE with CASE status guard preserves lifecycle state past pending.
  - Signal-score formula: positive_ratio × min(1, positiveCount / (threshold * 2)) — deterministic, bounded to [0,1].
  - Three-boundary fail-open sweep: repo-discovery boundary, per-repo generation boundary, per-proposal persistence boundary — each catches independently and logs warn.
  - _fn injectable overrides on sweep (as in prior milestones) allow unit tests to inject failing stubs without module mocking.
  - Pure-code proof harness with two checks: PROPOSAL-CREATED (positive cluster → persist) and FAIL-OPEN (crash + persist-fail → sweep continues).
observability_surfaces:
  - Sweep logs structured info at repo-discovery, per-repo completion, and final summary (repoCount, reposProcessed, reposWithProposals, reposFailed, proposalsGenerated, proposalsPersisted, persistFailures, durationMs).
  - Proposal generator logs structured info per skipped cluster (reason: cluster-too-small, insufficient-positive-members, low-positive-ratio, no-representative-positive-member, insufficient-proposal-text, empty-proposal-text) and per accepted proposal (clusterSize, positiveCount, negativeCount, signalScore, representativeMemoryId).
  - getLifecycleCounts(repo) exposes pending/active/retired/total counts as a per-repo observability surface for operators.
drill_down_paths:
  - .gsd/milestones/M036/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M036/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M036/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-04T22:42:53.806Z
blocker_discovered: false
---

# S01: Generated Rule Schema, Store, and Proposal Candidates

**Delivered generated-rule persistence (migration + store), deterministic positive-cluster proposal generation, a fail-open sweep entrypoint, and a pure-code proof harness — all verified at 19/19 tests passing and tsc clean.**

## What Happened

S01 built the complete substrate for generated-rule lifecycle management from positive feedback clusters.

T01 established the persistence layer: a `generated_rules` PostgreSQL table with `pending`/`active`/`retired` lifecycle states, repo scoping, `signal_score`/`member_count`/`cluster_centroid` signal fields, status-specific partial indexes for efficient per-status queries, and a non-downgrading upsert contract that deduplicates by (repo, title) and refuses to regress ACTIVE or RETIRED rules to pending on reproposal. The `GeneratedRuleStore` interface exposes explicit lifecycle methods: `savePendingRule`, `activateRule`, `retireRule`, `getActiveRulesForRepo`, `listRulesForRepo`, and `getLifecycleCounts`.

T02 built `generatePendingRuleProposals` — a deterministic proposal generator that reads recent embedding-bearing learning memories for a repo, clusters them by cosine similarity (reusing `cosineSimilarity` from `cluster-pipeline.ts`), filters clusters by minimum size, positive-member count, and positive ratio, then selects the most centroid-representative positive member as the source text for each surviving cluster. Text sanitization strips code fences, HTML, markdown decorations, and link syntax before computing title and rule-text candidates. The signal score uses a `positive_ratio × support` formula where support ramps from 0→1 as positive count grows from the minimum threshold to 2× that threshold — this keeps sparse-but-valid clusters pending while allowing larger clean clusters to rise toward activation thresholds.

T03 added `createGeneratedRuleSweep` as the background-oriented orchestration layer: discovers eligible repos from `learning_memories`, runs the proposal generator per repo sequentially, persists pending rules through the store, and isolates failures at repo-discovery, per-repo generation, and per-proposal persistence boundaries so the sweep always logs warnings and continues rather than aborting. Dry-run support prevents persistence during test runs. The `verify-m036-s01.ts` pure-code proof harness proves both the core proposal contract (representative positive cluster → persisted pending rule) and the fail-open contract (one crashing repo and one persistence failure do not stop the sweep) — both checks pass with `overallPassed: true`.

## Verification

Ran all four test files plus the proof harness against the current codebase:

- `bun test ./src/knowledge/generated-rule-store.test.ts` → 9 skip (TEST_DATABASE_URL absent), 0 fail
- `bun test ./src/knowledge/generated-rule-proposals.test.ts` → 6 pass, 0 fail
- `bun test ./src/knowledge/generated-rule-sweep.test.ts` → 4 pass, 0 fail
- `bun test ./scripts/verify-m036-s01.test.ts` → 9 pass, 0 fail
- `bun run verify:m036:s01 -- --json` → exit 0, `overallPassed: true`, M036-S01-PROPOSAL-CREATED ✅, M036-S01-FAIL-OPEN ✅
- `bun run tsc --noEmit` → exit 0 (no output)

Total: 19 pass, 9 skip (DB-gated, expected), 0 fail.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None. T03 added `src/knowledge/index.ts` exports and a `verify:m036:s01` script to `package.json` beyond what the task plan listed — both are minimal glue that downstream slices will need.

## Known Limitations

The `GeneratedRuleStore` tests skip when `TEST_DATABASE_URL` is absent. The non-downgrading upsert path (ACTIVE/RETIRED preservation) is tested only at the SQL logic level — live migration verification requires a real Postgres instance with the pgvector extension. The DB-gated tests cover the full lifecycle once `TEST_DATABASE_URL` is wired in CI.

## Follow-ups

S02 consumes `getActiveRulesForRepo` and `activateRule` — activation thresholds and the prompt-injection surface are the next concern. The signal-score formula uses a `minPositiveMembers × 2` saturation ceiling; that constant may need tuning once real data is available.

## Files Created/Modified

- `src/db/migrations/035-generated-rules.sql` — New migration: generated_rules table with lifecycle states, signal fields, vector centroid column, non-downgrading upsert constraint, and five partial indexes
- `src/knowledge/generated-rule-store.ts` — New GeneratedRuleStore: savePendingRule (non-downgrading upsert), activateRule, retireRule, getActiveRulesForRepo, listRulesForRepo, getLifecycleCounts
- `src/knowledge/generated-rule-store.test.ts` — DB-gated tests for all store methods — skip cleanly without TEST_DATABASE_URL
- `src/knowledge/generated-rule-proposals.ts` — New generatePendingRuleProposals: cosine-similarity clustering, multi-gate filtering, sanitized text extraction, signal-score formula
- `src/knowledge/generated-rule-proposals.test.ts` — Pure-code tests for proposal generation: strong cluster, noisy cluster rejection, text sanitization, proposal count cap, fail-open
- `src/knowledge/generated-rule-sweep.ts` — New createGeneratedRuleSweep: repo discovery, sequential per-repo processing, three-boundary fail-open, dry-run support
- `src/knowledge/generated-rule-sweep.test.ts` — Tests for sweep: repo discovery, proposal persistence, dry run, persist failures, repo-level fail-open
- `scripts/verify-m036-s01.ts` — Pure-code proof harness: PROPOSAL-CREATED and FAIL-OPEN checks with injectable stubs
- `scripts/verify-m036-s01.test.ts` — Tests for the proof harness contract, injected failures, JSON output, exit codes
- `src/knowledge/index.ts` — Added exports for GeneratedRuleStore types, GeneratedRuleProposalCandidate, createGeneratedRuleSweep
- `package.json` — Added verify:m036:s01 script
