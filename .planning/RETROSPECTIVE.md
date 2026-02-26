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

## Milestone: v0.20 — Multi-Model & Active Intelligence

**Shipped:** 2026-02-26
**Phases:** 6 | **Plans:** 17

### What Was Built
- Multi-LLM task routing via Vercel AI SDK with per-repo model overrides and provider fallback
- Per-invocation cost tracking for every LLM call logged to Postgres
- Contributor profiles with GitHub/Slack identity linking, expertise scoring, and 4-tier adaptive review
- Wiki staleness detection with two-tier evaluation and scheduled Slack reports
- HDBSCAN-based review pattern clustering with UMAP reduction and PR review footnote injection
- Gap closure phases (101, 102) for executor wiring and documentation

### What Worked
- Milestone audit identified integration gaps (costTracker/taskRouter not wired) before shipping — caught dead code paths
- Gap closure phases (101, 102) cleanly addressed audit findings without scope creep
- Pure TypeScript HDBSCAN + umap-js avoided Python sidecar complexity
- Dual-signal pattern matching (embedding + file path) provides robust cluster relevance filtering
- Fail-open contributor profiles — review pipeline works identically when profile store is unavailable

### What Was Inefficient
- Phase 100 roadmap checkbox wasn't updated to complete status despite all plans having summaries
- Phase 99 progress table row was malformed (missing milestone column)
- Audit ran before Phase 100 completed but correctly identified gaps in already-complete phases (97, 98, 99)
- SUMMARY files across phases 97-99 lacked standardized "What was built" sections, making accomplishment extraction harder

### Patterns Established
- Gap closure pattern: audit identifies gaps -> new phases created -> close gaps -> re-verify
- Scheduled job pattern: detector module + conditional feature guard + fire-and-forget with tracking
- Task routing pattern: TaskType taxonomy with dot hierarchy enables per-task model selection
- Expertise scoring with exponential decay for time-weighted contributor knowledge

### Key Lessons
1. Always run milestone audit after ALL phases complete — gaps from early phases compound
2. Gap closure phases are lightweight and effective for integration issues found by audit
3. The audit's 3-source cross-reference (VERIFICATION + SUMMARY frontmatter + REQUIREMENTS checkbox) catches documentation drift
4. TypeScript-native ML libraries (HDBSCAN, UMAP) are viable for batch processing — no need for Python sidecar

### Cost Observations
- Model mix: quality profile (opus for planning/execution, sonnet for verification)
- 6 phases completed across 2 days including gap closure
- Notable: Auto-advance pipeline (discuss -> plan -> execute) completed Phase 102 end-to-end in a single agent chain

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v0.19 | 4 | 14 | 4th corpus addition pattern established; TDD-first for parsers |
| v0.20 | 6 | 17 | Gap closure pattern established; TypeScript-native ML; multi-model routing |

### Cumulative Quality

| Milestone | Tests | Key Addition |
|-----------|-------|-------------|
| v0.19 | 1,494 | +37 snippet tests, +72 review handler tests stable |
| v0.20 | ~1,650 | +165 clustering/profile/wiki tests |

### Top Lessons (Verified Across Milestones)

1. Fail-open philosophy prevents new features from degrading existing functionality
2. Optional dependency injection enables backward-compatible feature additions
3. Content-hash dedup is the right default for idempotent writes (ON CONFLICT DO NOTHING)
4. Milestone audit after all phases complete catches integration gaps that phase-level verification misses
5. Gap closure phases are a clean pattern for addressing audit findings without scope creep
