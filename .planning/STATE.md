# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-13)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.5 Phase 32 in progress (Multi-Language Context and Localized Output)

## Current Position

Phase: 32 of 33 (Multi-Language Context and Localized Output)
Plan: 2 of 3 (COMPLETE)
Status: In Progress
Last activity: 2026-02-13 - Completed 32-02 (prompt language guidance and output localization)

Progress: [#######░░░] 67% (v0.5 - 8/12 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 66
- Average duration: 5 min
- Total execution time: 321 min

**By latest shipped milestone:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 26-review-mode-severity-control | 2 | 4 min | 2 min |
| 27-context-aware-reviews | 4 | 11 min | 3 min |
| 28-knowledge-store-explicit-learning | 4 | 9 min | 2 min |
| 29-feedback-capture | 2 | 6 min | 3 min |
| 30-state-memory-and-isolation-foundation | 3 | 10 min | 3 min |
| 31-incremental-re-review-with-retrieval-context | 3 | 11 min | 4 min |
| 32-multi-language-context-and-localized-output | 2 | 5 min | 3 min |

## Accumulated Context

### Decisions

Decisions are logged in `.planning/PROJECT.md`.
Recent decisions relevant to v0.5:

- Preserve deterministic-first review flow; learning/retrieval is additive and fail-open.
- Keep repo-scoped learning isolation as the default behavior.
- Keep canonical severity/category taxonomy even when adding language-aware guidance.
- Run identity keyed by SHA pair (not delivery ID) for idempotent webhook processing (30-01).
- Fail-open run state checks: SQLite errors do not block review publication (30-01).
- Fixed vec0 embedding dimension at 1024 for v0.5; changing requires table recreation (30-02).
- Owner-level shared pool via partition iteration over up to 5 repos, not separate unpartitioned table (30-02).
- Learning memory store uses separate DB connection to shared knowledge DB; safe with WAL concurrent readers (30-03).
- Memory writes are fire-and-forget async; never block review completion (30-03).
- computeIncrementalDiff accepts function param instead of full KnowledgeStore for loose coupling (31-02).
- Fail-open git operations: all errors degrade to mode=full rather than blocking review (31-02).
- Finding dedup uses filePath:titleFingerprint composite key in a Set for O(1) suppression lookup (31-02).
- Duplicated FNV-1a fingerprint in store.ts to avoid circular import from review.ts (31-01).
- onSynchronize trigger defaults false; opt-in to avoid costly frequent-push reviews (31-01).
- Retrieval config enabled by default with conservative topK=5, distanceThreshold=0.3, maxContextChars=2000 (31-01).
- Incremental mode is state-driven (prior completed review existence), not event-driven -- works for both synchronize and review_requested (31-03).
- reviewFiles filtered subset for prompt, changedFiles preserved for metrics and diff analysis (31-03).
- Combined suppression: config-based AND dedup-based fingerprint suppression checked per finding (31-03).
- Extension map covers ~30 extensions across 20 languages; Unknown files omitted from filesByLanguage (32-01).
- outputLanguage is free-form z.string() not an enum -- LLMs understand both ISO codes and full names (32-01).
- h files default to C per research decision; C++ guidance also covers C headers (32-01).
- TypeScript/JavaScript excluded from LANGUAGE_GUIDANCE -- already covered by base review rules (32-02).
- Language guidance capped at top 5 by file count to prevent prompt bloat (32-02).
- Output language section placed at end of prompt for recency bias compliance (32-02).
- Mention prompt uses simpler localization instruction without taxonomy preservation (32-02).

### Pending Todos

None yet.

### Blockers/Concerns

None currently.

## Session Continuity

Last session: 2026-02-13
Stopped at: Completed 32-02-PLAN.md
Resume file: None
