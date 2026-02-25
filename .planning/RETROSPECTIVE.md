# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v0.19 — Intelligent Retrieval Enhancements

**Shipped:** 2026-02-25
**Phases:** 4 | **Plans:** 14

### What Was Built
- Language-aware retrieval boosting with 61-extension classification and proportional multi-language boost
- Specialized [depends] deep-review pipeline for Kodi dependency bump PRs with changelog analysis, impact assessment, and structured review comments
- CI failure recognition via Checks API with base-branch comparison and flakiness tracking
- Hunk-level code snippet embedding as 4th retrieval corpus with content-hash dedup

### What Worked
- TDD-first approach for the diff hunk parser (28 tests) caught edge cases early
- Fail-open pattern consistently applied across all new features — no new failure modes
- Content-hash deduplication design avoided the need for complex cache invalidation
- Fire-and-forget async pattern for hunk embedding kept review response times unchanged
- Sequential mutual-exclusion detection ([depends] vs Dependabot) prevented false-positive routing

### What Was Inefficient
- Milestone audit was run before phases 94-96 were built, making it stale by completion — should audit after all phases ship
- REQUIREMENTS.md SNIP traceability was left as "Pending" despite phase completion — need to update traceability as part of phase verification

### Patterns Established
- 4th corpus pattern: adding new knowledge sources follows a repeatable recipe (types -> migration -> store -> retrieval -> pipeline integration)
- Optional dependency injection in createRetriever() — backward-compatible corpus additions
- Fire-and-forget embedding with .catch() for non-blocking knowledge writes

### Key Lessons
1. Run milestone audit after all phases complete, not during development
2. The "corpus addition recipe" (types/migration/store/retrieval/pipeline) is now a proven pattern — future corpora should follow the same structure
3. Checks API is the correct choice over Actions API for CI visibility across external systems
4. Content-hash deduplication is simpler and more reliable than timestamp-based or reference-counting approaches

### Cost Observations
- Model mix: quality profile (opus for planning/execution, sonnet for verification)
- Notable: All 4 phases completed in a single day

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v0.19 | 4 | 14 | 4th corpus addition pattern established; TDD-first for parsers |

### Cumulative Quality

| Milestone | Tests | Key Addition |
|-----------|-------|-------------|
| v0.19 | 1,494 | +37 snippet tests, +72 review handler tests stable |

### Top Lessons (Verified Across Milestones)

1. Fail-open philosophy prevents new features from degrading existing functionality
2. Optional dependency injection enables backward-compatible feature additions
3. Content-hash dedup is the right default for idempotent writes (ON CONFLICT DO NOTHING)
