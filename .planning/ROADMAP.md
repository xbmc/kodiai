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
- ✅ **v0.10 Advanced Signals** — Phases 56-59 (shipped 2026-02-16)
- ✅ **v0.11 Issue Workflows** — Phases 60-65 (shipped 2026-02-16)
- 🎯 **v0.12 Operator Reliability & Retrieval Quality** — Phases 66-70 (planned)

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

<details>
<summary>v0.10 Advanced Signals (Phases 56-59) -- SHIPPED 2026-02-16</summary>

**Milestone Goal:** Deepen dependency analysis with usage-aware breaking change detection, improve timeout resilience with checkpoint publishing and retry, and sharpen retrieval with adaptive thresholds, recency weighting, and quality telemetry.

- [x] **Phase 56: Foundation Layer** - Data infrastructure, retrieval telemetry, and bracket tag focus hints
- [x] **Phase 57: Analysis Layer** - API usage analysis, multi-package correlation, and recency weighting
- [x] **Phase 58: Intelligence Layer** - Adaptive distance thresholds with statistical cutoff
- [x] **Phase 59: Resilience Layer** - Checkpoint publishing on timeout and retry with reduced scope

</details>

<details>
<summary>v0.11 Issue Workflows (Phases 60-65) -- SHIPPED 2026-02-16</summary>

See `.planning/milestones/v0.11-ROADMAP.md` for full phase details.

</details>

### v0.12 Operator Reliability & Retrieval Quality (Planned)

**Milestone Goal:** Improve operator reliability under Search API rate limits, raise retrieval signal quality, and make conversational behavior consistent across issue/PR/review surfaces.

See `.planning/milestones/v0.12-ROADMAP.md` for milestone snapshot.

- [x] **Phase 66: Search Cache Foundation** - Repository-scoped cache keys, de-duplication, and bounded TTL strategy for Search API usage
- [x] **Phase 67: Rate-Limit Resilience + Telemetry** - Graceful degradation, single bounded retry strategy, and production-facing rate-limit metrics
- [x] **Phase 68: Multi-Query Retrieval Core** - Deterministic multi-query expansion and merged ranking pipeline
- [ ] **Phase 69: Snippet Anchors + Prompt Budgeting** - Code-snippet extraction with path anchors and strict prompt-budget controls
- [ ] **Phase 70: Cross-Surface Conversational UX** - Consistent response contracts and clarifying-question fallback across issue/PR/review threads

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
**Plans**: 3 plans

Plans:
- [x] 58-01-PLAN.md — Adaptive threshold computation module (TDD)
- [x] 58-02-PLAN.md — Wire adaptive threshold into retrieval pipeline and telemetry

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
- [x] 59-01-PLAN.md — Checkpoint accumulation infrastructure (MCP tool + knowledge store)
- [x] 59-02-PLAN.md — Partial review formatter, retry scope reducer, and chronic timeout detection
- [x] 59-03-PLAN.md — Wire timeout resilience into review handler (partial publish, retry, merge)

### Phase 66: Search Cache Foundation
**Goal**: Search-based enrichment stays within GitHub Search API budgets by reusing recent equivalent queries and de-duplicating concurrent requests
**Depends on**: Phase 65 (v0.11 complete)
**Requirements**: OPS-01
**Success Criteria** (what must be TRUE):
  1. Equivalent Search API requests within a bounded window are served from cache instead of issuing duplicate remote calls
  2. Cache keys are deterministic for repo + query semantics, and cache scope does not leak across repositories
  3. Cache behavior fails open: cache storage/lookup errors never block review or mention completion
**Plans**: 2 plans

Plans:
- [ ] 66-01-PLAN.md — Implement deterministic search cache module with repo-scoped keys
- [ ] 66-02-PLAN.md — Wire cache into enrichment flows and add concurrency de-dupe tests

### Phase 67: Rate-Limit Resilience + Telemetry
**Goal**: When Search API limits are reached, Kodiai degrades gracefully and provides measurable signals for production tuning
**Depends on**: Phase 66
**Requirements**: OPS-02, OPS-03
**Success Criteria** (what must be TRUE):
  1. On rate-limit responses, Kodiai applies bounded retry/backoff once and then proceeds with reduced context instead of failing hard
  2. User-facing output clearly states that analysis was partial due to API limits when degradation occurs
  3. Telemetry records cache hit rate, skipped queries, retry attempts, and degradation path so operators can validate behavior under load
**Plans**: 2 plans

Plans:
- [x] 67-01-PLAN.md — Implement bounded retry/backoff and degrade-to-partial behavior
- [x] 67-02-PLAN.md — Add rate-limit telemetry schema + regression coverage for degraded messaging

### Phase 68: Multi-Query Retrieval Core
**Goal**: Retrieval quality improves by expanding a single request into multiple focused queries and merging results deterministically
**Depends on**: Phase 67
**Requirements**: RET-07
**Success Criteria** (what must be TRUE):
  1. Retrieval generates multiple bounded query variants (intent, file-path, and code-shape signals) from the same request context
  2. Result merge/rerank is deterministic and stable for equivalent inputs
  3. Multi-query mode keeps latency within current operational budgets and fails open when one variant errors
**Plans**: 2 plans

Plans:
- [x] 68-01-PLAN.md — Build multi-query generation + deterministic merge module (TDD)
- [x] 68-02-PLAN.md — Integrate multi-query retrieval into review and mention pipelines

### Phase 69: Snippet Anchors + Prompt Budgeting
**Goal**: Retrieved context is more actionable by including concise snippet evidence and precise path anchors while preserving prompt size limits
**Depends on**: Phase 68
**Requirements**: RET-08
**Success Criteria** (what must be TRUE):
  1. Retrieval context includes bounded snippet excerpts with `path:line` anchors when evidence exists
  2. Snippet assembly respects strict character/token caps and drops lowest-value context first when over budget
  3. Missing snippet extraction never blocks response generation; output degrades to path-only evidence
**Plans**: 2 plans

Plans:
- [ ] 69-01-PLAN.md — Implement snippet extraction and anchor formatting utilities
- [ ] 69-02-PLAN.md — Wire snippet budgeting into prompt builders with overflow tests

### Phase 70: Cross-Surface Conversational UX
**Goal**: Conversational behavior feels consistent across issue, PR, and review threads while preserving surface-specific expectations
**Depends on**: Phase 69
**Requirements**: CONV-01, CONV-02
**Success Criteria** (what must be TRUE):
  1. Response contracts (direct answer, evidence pointers, next-step framing) are consistent across supported comment surfaces
  2. When context is insufficient, Kodiai asks one targeted clarifying question rather than speculating
  3. Surface-specific safety/UX rules remain intact (no unsolicited responses, no implicit write-mode entry)
**Plans**: 2 plans

Plans:
- [ ] 70-01-PLAN.md — Unify conversational response contract and surface adapters
- [ ] 70-02-PLAN.md — Add cross-surface clarification + safety regression suite

## Progress

**Total shipped:** 11 milestones, 67 phases, 177 plans

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
| 58 | v0.10 | 2/2 | Complete | 2026-02-16 |
| 59 | v0.10 | 3/3 | Complete | 2026-02-16 |
| 60 | v0.11 | 3/3 | Complete | 2026-02-16 |
| 61 | v0.11 | 3/3 | Complete | 2026-02-16 |
| 62 | v0.11 | 2/2 | Complete | 2026-02-16 |
| 63 | v0.11 | 2/2 | Complete | 2026-02-16 |
| 64 | v0.11 | 2/2 | Complete | 2026-02-16 |
| 65 | v0.11 | 2/2 | Complete | 2026-02-16 |
| 66 | v0.12 | 2/2 | Complete | 2026-02-16 |
| 67 | v0.12 | 2/2 | Complete | 2026-02-17 |
| 68 | v0.12 | 2/2 | Complete | 2026-02-17 |
| 69 | v0.12 | 0/2 | Planned | - |
| 70 | v0.12 | 0/2 | Planned | - |

---

*Roadmap updated: 2026-02-17 -- phase 68 completed (Multi-Query Retrieval Core); phases 69-70 planned*
