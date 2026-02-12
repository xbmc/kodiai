# Roadmap: Kodiai

## Milestones

- ✅ **v0.1 MVP** — Phases 1-10 (shipped 2026-02-09)
  - Archive: `.planning/milestones/v0.1-ROADMAP.md`
- ✅ **v0.2 Write Mode** — Phases 11-21 (shipped 2026-02-10)
  - Archive: `.planning/milestones/v0.2-ROADMAP.md`
- ✅ **v0.3 Configuration & Observability** — Phases 22-25 (shipped 2026-02-11)
  - Archive: `.planning/milestones/v0.3-ROADMAP.md`
- 🚧 **v0.4 Intelligent Review System** — Phases 26-29 (in progress)

## Phases

<details>
<summary>✅ v0.1 MVP (Phases 1-10) — SHIPPED 2026-02-09</summary>

- [x] Phase 1: Webhook Foundation — completed 2026-02-09
- [x] Phase 2: Job Infrastructure — completed 2026-02-09
- [x] Phase 3: Execution Engine — completed 2026-02-09
- [x] Phase 4: PR Auto-Review — completed 2026-02-09
- [x] Phase 5: Mention Handling — completed 2026-02-09
- [x] Phase 6: Content Safety — completed 2026-02-09
- [x] Phase 7: Operational Resilience — completed 2026-02-09
- [x] Phase 8: Deployment — completed 2026-02-09
- [x] Phase 9: Review UX Improvements — completed 2026-02-09
- [x] Phase 10: Review Request Reliability — completed 2026-02-09

See `.planning/milestones/v0.1-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.2 Write Mode (Phases 11-21) — SHIPPED 2026-02-10</summary>

- [x] Phase 11: Mention UX Parity — completed 2026-02-10
- [x] Phase 12: Fork PR Robustness — completed 2026-02-10
- [x] Phase 13: XBMC Cutover — completed 2026-02-10
- [x] Phase 14: Write Mode Foundations — completed 2026-02-10
- [x] Phase 15: Write Pipeline — completed 2026-02-10
- [x] Phase 16: Write Guardrails — completed 2026-02-10
- [x] Phase 17: Write Mode Reliability — completed 2026-02-10
- [x] Phase 18: Observability & Verification — completed 2026-02-10
- [x] Phase 19: Write Confirmation — completed 2026-02-10
- [x] Phase 20: Next Improvements — completed 2026-02-10
- [x] Phase 21: Polish — completed 2026-02-10

See `.planning/milestones/v0.2-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.3 Configuration & Observability (Phases 22-25) — SHIPPED 2026-02-11</summary>

- [x] Phase 22: Config Validation Safety (1/1 plans) — completed 2026-02-11
- [x] Phase 23: Telemetry Foundation (3/3 plans) — completed 2026-02-11
- [x] Phase 24: Enhanced Config Fields (2/2 plans) — completed 2026-02-11
- [x] Phase 25: Reporting Tools (1/1 plan) — completed 2026-02-11

See `.planning/milestones/v0.3-ROADMAP.md` for full phase details.

</details>

### 🚧 v0.4 Intelligent Review System (In Progress)

**Milestone Goal:** Improve review quality through smarter analysis, repo-specific learning, and configurable strictness. Reduce noise and false positives while catching real issues.

- [x] **Phase 26: Review Mode & Severity Control** — Configurable review strictness with structured output and noise suppression (completed 2026-02-11)
- [ ] **Phase 27: Context-Aware Reviews** — Path-scoped instructions, profile presets, and deterministic diff analysis
- [ ] **Phase 28: Knowledge Store & Explicit Learning** — SQLite-backed learning, suppression patterns, and review metrics
- [ ] **Phase 29: Feedback Capture** — Implicit learning via comment reaction tracking

## Phase Details

### Phase 26: Review Mode & Severity Control
**Goal**: Users can control review strictness and receive structured, noise-free feedback with severity-tagged comments
**Depends on**: Phase 25 (existing config infrastructure from v0.3)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06
**Success Criteria** (what must be TRUE):
  1. User sets `review.mode: enhanced` in `.kodiai.yml` and receives reviews with severity/category-tagged inline comments; omitting the field preserves current "standard" behavior
  2. User sets `review.severity.minLevel: major` and review output contains only major/critical findings, suppressing medium/minor noise
  3. User sets `review.focusAreas: [security, bugs]` and review concentrates on those categories, ignoring style and trivial maintainability nits
  4. PR review produces at most 7 inline comments regardless of PR size, with each comment prefixed by severity level and issue category
  5. Review never flags style-only issues, trivial renamings, or cosmetic preferences — noise suppression rules are enforced in the prompt
**Plans**: 2 plans

Plans:
- [x] 26-01-PLAN.md — Config schema extension (review mode, severity, focus areas, comment cap)
- [x] 26-02-PLAN.md — Prompt enrichment with mode-aware instructions and handler wiring

### Phase 27: Context-Aware Reviews
**Goal**: Reviews understand repo-specific conventions and assess risk using path-scoped instructions, profile presets, and deterministic diff analysis
**Depends on**: Phase 26 (review mode and config schema)
**Requirements**: CTX-01, CTX-02, CTX-03, CTX-04
**Success Criteria** (what must be TRUE):
  1. User defines `review.pathInstructions` with glob patterns in `.kodiai.yml` and review applies different rules per directory (e.g., stricter security checks for `src/api/**`)
  2. User sets `review.profile: strict` (or `balanced` or `minimal`) and gets a named preset that configures severity threshold, focus areas, and noise rules as a bundle
  3. Before invoking Claude, system classifies changed files by category (source/test/config/docs) and detects risk signals (auth changes, new dependencies, error handling) deterministically without an LLM call
  4. Review prompt contains diff analysis context (file classifications, risk signals, scale) and any applicable path-scoped instructions, producing more targeted findings
**Plans**: 4 plans

Plans:
- [x] 27-01-PLAN.md — Config schema extension (pathInstructions, profile, fileCategories) and deterministic diff analysis module
- [x] 27-02-PLAN.md — Prompt enrichment with path instruction matching, diff analysis sections, and handler wiring with profile resolution
- [x] 27-03-PLAN.md — Gap closure: resilient shallow-clone diff collection and no-merge-base fallback for live review execution
- [ ] 27-04-PLAN.md — Gap closure: elapsed-time budget guardrails with graceful truncation in deterministic diff analysis

### Phase 28: Knowledge Store & Explicit Learning
**Goal**: System persists review knowledge per-repo and users can teach the bot what to ignore via explicit configuration and confidence thresholds
**Depends on**: Phase 27 (prompt enrichment infrastructure)
**Requirements**: LEARN-01, LEARN-02, LEARN-03, LEARN-04
**Success Criteria** (what must be TRUE):
  1. System stores review findings (issue type, severity, file, resolution) in a SQLite knowledge store alongside existing telemetry database, following the same WAL mode and factory pattern
  2. User defines `review.suppressions` patterns in `.kodiai.yml` (e.g., "ignore missing error handling in test files") and matching findings are excluded from future reviews
  3. User sets `review.minConfidence: medium` and review output excludes low-confidence findings where false positives concentrate
  4. Every review summary includes quantitative metrics: files reviewed, lines analyzed, issues found by severity level, and estimated review time saved
**Plans**: 4 plans

Plans:
- [ ] 28-01-PLAN.md — Knowledge store schema and factory function (SQLite WAL, reviews/findings/suppression_log tables)
- [ ] 28-02-PLAN.md — Suppression patterns config schema and confidence scoring engine
- [ ] 28-03-PLAN.md — Prompt enrichment with suppression rules, confidence display, metrics, and handler wiring
- [ ] 28-04-PLAN.md — CLI query scripts for review stats and trend analysis

### Phase 29: Feedback Capture
**Goal**: System captures implicit user feedback on review quality through comment reactions, building a feedback corpus for future learning improvements
**Depends on**: Phase 28 (knowledge store schema)
**Requirements**: LEARN-05
**Success Criteria** (what must be TRUE):
  1. When a user adds a thumbs-up or thumbs-down reaction to a Kodiai review comment, the system captures that feedback and correlates it with the original finding in the knowledge store
  2. Captured feedback is stored per-repo with the finding context (issue type, severity, file pattern) for future analysis, without automatically changing review behavior in v0.4
**Plans**: TBD

Plans:
- [ ] 29-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 26 → 27 → 28 → 29

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Webhook Foundation | v0.1 | 3/3 | Complete | 2026-02-09 |
| 2. Job Infrastructure | v0.1 | 2/2 | Complete | 2026-02-09 |
| 3. Execution Engine | v0.1 | 3/3 | Complete | 2026-02-09 |
| 4. PR Auto-Review | v0.1 | 2/2 | Complete | 2026-02-09 |
| 5. Mention Handling | v0.1 | 2/2 | Complete | 2026-02-09 |
| 6. Content Safety | v0.1 | 2/2 | Complete | 2026-02-09 |
| 7. Operational Resilience | v0.1 | 2/2 | Complete | 2026-02-09 |
| 8. Deployment | v0.1 | 2/2 | Complete | 2026-02-09 |
| 9. Review UX Improvements | v0.1 | 5/5 | Complete | 2026-02-09 |
| 10. Review Request Reliability | v0.1 | 4/4 | Complete | 2026-02-09 |
| 11. Mention UX Parity | v0.2 | 4/4 | Complete | 2026-02-10 |
| 12. Fork PR Robustness | v0.2 | 3/3 | Complete | 2026-02-10 |
| 13. XBMC Cutover | v0.2 | 3/3 | Complete | 2026-02-10 |
| 14. Write Mode Foundations | v0.2 | 1/1 | Complete | 2026-02-10 |
| 15. Write Pipeline | v0.2 | 1/1 | Complete | 2026-02-10 |
| 16. Write Guardrails | v0.2 | 1/1 | Complete | 2026-02-10 |
| 17. Write Mode Reliability | v0.2 | 2/2 | Complete | 2026-02-10 |
| 18. Observability & Verification | v0.2 | 2/2 | Complete | 2026-02-10 |
| 19. Write Confirmation | v0.2 | 1/1 | Complete | 2026-02-10 |
| 20. Next Improvements | v0.2 | 1/1 | Complete | 2026-02-10 |
| 21. Polish | v0.2 | 4/4 | Complete | 2026-02-10 |
| 22. Config Validation Safety | v0.3 | 1/1 | Complete | 2026-02-11 |
| 23. Telemetry Foundation | v0.3 | 3/3 | Complete | 2026-02-11 |
| 24. Enhanced Config Fields | v0.3 | 2/2 | Complete | 2026-02-11 |
| 25. Reporting Tools | v0.3 | 1/1 | Complete | 2026-02-11 |
| 26. Review Mode & Severity Control | v0.4 | 2/2 | Complete | 2026-02-11 |
| 27. Context-Aware Reviews | v0.4 | 3/4 | In Progress | - |
| 28. Knowledge Store & Explicit Learning | v0.4 | 0/4 | Not started | - |
| 29. Feedback Capture | v0.4 | 0/? | Not started | - |

---

*Last updated: 2026-02-11 after Phase 28 planning*
