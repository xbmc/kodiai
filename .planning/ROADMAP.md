# Roadmap: Kodiai

## Milestones

- ✅ **v0.1 MVP** — Phases 1-10 (shipped 2026-02-09)
- ✅ **v0.2 Write Mode** — Phases 11-21 (shipped 2026-02-10)
- ✅ **v0.3 Configuration & Observability** — Phases 22-25 (shipped 2026-02-11)
- ✅ **v0.4 Intelligent Review System** — Phases 26-29 (shipped 2026-02-12)
- ✅ **v0.5 Advanced Learning & Language Support** — Phases 30-33 (shipped 2026-02-13)
- ✅ **v0.6 Review Output Formatting & UX** — Phases 34-38 (shipped 2026-02-14)
- ✅ **v0.7 Intelligent Review Content** — Phases 39-41 (shipped 2026-02-14)
- ✅ **v0.8 Conversational Intelligence** — Phases 42-50 (shipped 2026-02-14)
- ✅ **v0.9 Smart Dependencies & Resilience** — Phases 51-55 (shipped 2026-02-15)
- [ ] **v0.10 Advanced Signals** — Phases 56-59 (in progress)

## Phases

<details>
<summary>v0.1 MVP (Phases 1-10) -- SHIPPED 2026-02-09</summary>

See `.planning/milestones/v0.1-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.2 Write Mode (Phases 11-21) -- SHIPPED 2026-02-10</summary>

See `.planning/milestones/v0.2-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.3 Configuration & Observability (Phases 22-25) -- SHIPPED 2026-02-11</summary>

See `.planning/milestones/v0.3-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.4 Intelligent Review System (Phases 26-29) -- SHIPPED 2026-02-12</summary>

See `.planning/milestones/v0.4-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.5 Advanced Learning & Language Support (Phases 30-33) -- SHIPPED 2026-02-13</summary>

See `.planning/milestones/v0.5-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.6 Review Output Formatting & UX (Phases 34-38) -- SHIPPED 2026-02-14</summary>

See `.planning/milestones/v0.6-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.7 Intelligent Review Content (Phases 39-41) -- SHIPPED 2026-02-14</summary>

See `.planning/milestones/v0.7-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.8 Conversational Intelligence (Phases 42-50) -- SHIPPED 2026-02-14</summary>

See `.planning/milestones/v0.8-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.9 Smart Dependencies & Resilience (Phases 51-55) -- SHIPPED 2026-02-15</summary>

See `.planning/milestones/v0.9-ROADMAP.md` for full phase details.

</details>

### v0.10 Advanced Signals (In Progress)

**Milestone Goal:** Deepen dependency analysis with usage-aware breaking change detection, improve timeout resilience with checkpoint publishing and retry, and sharpen retrieval with adaptive thresholds, recency weighting, and quality telemetry.

- [x] **Phase 56: Foundation Layer** - Data infrastructure, retrieval telemetry, and bracket tag focus hints
- [x] **Phase 57: Analysis Layer** - API usage analysis, multi-package correlation, and recency weighting
- [ ] **Phase 58: Intelligence Layer** - Adaptive distance thresholds with statistical cutoff
- [ ] **Phase 59: Resilience Layer** - Checkpoint publishing on timeout and retry with reduced scope

## Phase Details

### Phase 56: Foundation Layer
**Goal**: Kodiai has the data infrastructure and low-risk enrichments needed for advanced signals -- new tables for dependency history, retrieval quality telemetry flowing to the existing telemetry store, and unrecognized bracket tags surfaced as useful focus hints instead of being discarded
**Depends on**: Phase 55 (v0.9 complete)
**Requirements**: DEP-05, RET-05, INTENT-01
**Success Criteria** (what must be TRUE):
  1. When a dependency bump PR is reviewed and merged, Kodiai records the package name, version bump, semver classification, merge confidence, and advisory status in the knowledge store for later trend queries
  2. After every review that uses retrieval, Kodiai logs retrieval quality metrics (result count, average distance, threshold used, language match ratio) to the telemetry database
  3. When a PR title contains unrecognized bracket tags like `[Auth]` or `[iOS]`, Kodiai includes those tags as component/platform focus hints in the review prompt rather than silently ignoring them
  4. Schema migrations are additive-only (new tables and nullable columns) with no modifications to existing tables
**Plans**: 3 plans

Plans:
- [x] 56-01-PLAN.md — Record dependency bump merge history in knowledge store
- [x] 56-02-PLAN.md — Log retrieval quality metrics to telemetry store
- [x] 56-03-PLAN.md — Surface unrecognized bracket tags as focus hints in review prompt

### Phase 57: Analysis Layer
**Goal**: Kodiai enriches dependency reviews with workspace-aware usage evidence and multi-package coordination signals, and retrieval results favor recent memories over stale ones
**Depends on**: Phase 56 (dep_bump_history table and retrieval telemetry must exist)
**Requirements**: DEP-04, DEP-06, RET-04
**Success Criteria** (what must be TRUE):
  1. When a dependency bump has documented breaking changes, Kodiai greps the workspace for imports/usage of affected APIs and surfaces specific file:line evidence in the review (e.g., "you import foo.bar() at src/auth.ts:42 which was removed in v3")
  2. When multiple packages sharing a scope prefix are updated together (e.g., @babel/core + @babel/parser), Kodiai detects and notes the coordination in the review context
  3. Retrieval results from the last 30 days score higher than equivalent results from 6+ months ago, with a severity-aware decay floor of 0.3 that prevents CRITICAL/MAJOR findings from being forgotten
  4. Usage analysis completes within a 3-second time budget and fails open (missing usage data never blocks the review)
  5. Recency weighting chains after existing language-aware re-ranking without disrupting existing retrieval quality
**Plans**: 3 plans

Plans:
- [x] 57-01-PLAN.md — Usage analyzer and scope coordinator pure-function modules
- [x] 57-02-PLAN.md — Retrieval recency weighting module
- [x] 57-03-PLAN.md — Wire all analysis modules into review pipeline and prompt

### Phase 58: Intelligence Layer
**Goal**: Kodiai self-tunes retrieval distance thresholds per query using statistical analysis of candidate distances instead of relying on a fixed 0.3 cutoff
**Depends on**: Phase 56 (retrieval telemetry baseline needed to validate improvement)
**Requirements**: RET-03
**Success Criteria** (what must be TRUE):
  1. When retrieval returns 8 or more candidates, Kodiai applies max-gap detection to find the natural distance cutoff between relevant and irrelevant results
  2. When fewer than 8 candidates are returned, Kodiai falls back to a percentile-based threshold rather than attempting unstable gap detection
  3. Adaptive thresholds are bounded by a floor of 0.15 and ceiling of 0.65, preventing pathological cutoffs
  4. The threshold selection (adaptive vs. fallback vs. configured) is logged in retrieval telemetry for observability
**Plans**: 2 plans

Plans:
- [ ] 58-01-PLAN.md — Adaptive threshold computation module (TDD)
- [ ] 58-02-PLAN.md — Wire adaptive threshold into retrieval pipeline and telemetry

### Phase 59: Resilience Layer
**Goal**: Kodiai recovers value from timed-out reviews by publishing accumulated partial results and optionally retrying with a reduced file scope
**Depends on**: Phase 56 (stable foundation), Phase 57 (analysis modules stable), Phase 58 (adaptive thresholds stable)
**Requirements**: TMO-05, TMO-06
**Success Criteria** (what must be TRUE):
  1. During review execution, Kodiai accumulates partial review state (files analyzed, findings generated) and on timeout publishes whatever was completed using buffer-and-flush (no incremental/orphaned inline comments)
  2. When a review times out with no published output, Kodiai retries once with the top 50% of files by risk score and a halved timeout budget
  3. Retry is capped at exactly 1 attempt -- no second retry regardless of outcome
  4. Repos with 3+ recent timeouts skip retry entirely to avoid wasting resources on chronically expensive repos
  5. Checkpoint data and retry metadata are visible in telemetry for operational monitoring
**Plans**: 3 plans

Plans:
- [ ] 59-01-PLAN.md — Checkpoint accumulation infrastructure (MCP tool + knowledge store)
- [ ] 59-02-PLAN.md — Partial review formatter, retry scope reducer, and chronic timeout detection
- [ ] 59-03-PLAN.md — Wire timeout resilience into review handler (partial publish, retry, merge)

## Progress

**Total shipped:** 9 milestones, 56 phases, 159 plans

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-10 | v0.1 | 27/27 | Complete | 2026-02-09 |
| 11-21 | v0.2 | 30/30 | Complete | 2026-02-10 |
| 22-25 | v0.3 | 7/7 | Complete | 2026-02-11 |
| 26-29 | v0.4 | 17/17 | Complete | 2026-02-12 |
| 30-33 | v0.5 | 12/12 | Complete | 2026-02-13 |
| 34-38 | v0.6 | 10/10 | Complete | 2026-02-14 |
| 39-41 | v0.7 | 11/11 | Complete | 2026-02-14 |
| 42-50 | v0.8 | 19/19 | Complete | 2026-02-14 |
| 51-55 | v0.9 | 11/11 | Complete | 2026-02-15 |
| 56 | v0.10 | 3/3 | Complete | 2026-02-15 |
| 57 | v0.10 | 3/3 | Complete | 2026-02-15 |
| 58 | v0.10 | 0/2 | Not started | - |
| 59 | v0.10 | 0/TBD | Not started | - |

---

*Roadmap updated: 2026-02-15 -- Phase 58 plans created*
