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
- ✅ **v0.12 Operator Reliability & Retrieval Quality** — Phases 66-71 (shipped 2026-02-17)
- ✅ **v0.13 Reliability Follow-Through** — Phases 72-76 (force-closed 2026-02-18; accepted debt)
- ✅ **v0.14 Slack Integration** — Phases 77-80 (shipped 2026-02-19)
- ✅ **v0.15 Slack Write Workflows** — Phase 81 (shipped 2026-02-19)
- [ ] **v0.16 Review Coverage & Slack UX** — Phases 82-83 (in progress)

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

See `.planning/milestones/v0.10-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.11 Issue Workflows (Phases 60-65) -- SHIPPED 2026-02-16</summary>

See `.planning/milestones/v0.11-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.12 Operator Reliability & Retrieval Quality (Phases 66-71) -- SHIPPED 2026-02-17</summary>

See `.planning/milestones/v0.12-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.13 Reliability Follow-Through (Phases 72-76) -- FORCE-CLOSED 2026-02-18</summary>

See `.planning/milestones/v0.13-ROADMAP.md` for full phase details, accepted gaps, and deferred follow-up scope.

</details>

<details>
<summary>v0.14 Slack Integration (Phases 77-80) -- SHIPPED 2026-02-19</summary>

See `.planning/milestones/v0.14-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.15 Slack Write Workflows (Phase 81) -- SHIPPED 2026-02-19</summary>

See `.planning/milestones/v0.15-ROADMAP.md` for full phase details.

</details>

### v0.16 Review Coverage & Slack UX

**Milestone Goal:** Expand review coverage to draft PRs and make Slack responses concise and conversational.

- [x] **Phase 82: Draft PR Review Coverage** - Kodiai reviews draft PRs with draft-aware visual indicators (completed 2026-02-23)
- [x] **Phase 83: Slack Response Conciseness** - Slack responses are direct, concise, and conversational (completed 2026-02-24)

## Phase Details

### Phase 82: Draft PR Review Coverage
**Goal**: Draft PRs receive the same review treatment as non-draft PRs, with clear visual acknowledgment of draft status
**Depends on**: Phase 81
**Requirements**: REV-01, REV-02
**Success Criteria** (what must be TRUE):
  1. When a draft PR is opened, Kodiai posts a review (no skip/ignore behavior)
  2. The review output for a draft PR contains a visible indicator that the PR is in draft state
  3. Non-draft PR review behavior is unchanged (no regressions)
**Plans**: 1 plan
- [ ] 82-01-PLAN.md — Remove draft skip, add draft-aware tone/badge to review prompt and comment validation, with tests

### Phase 83: Slack Response Conciseness
**Goal**: Slack responses read like chat messages from a knowledgeable colleague, not like documentation pages
**Depends on**: Phase 81
**Requirements**: SLK-07, SLK-08, SLK-09, SLK-10
**Success Criteria** (what must be TRUE):
  1. Slack responses begin with the answer directly -- no leading phrases like "Here's what I found" or "Based on the codebase"
  2. Slack responses never include a Sources or References section at the end
  3. Simple factual questions receive 1-3 sentence answers without headers or bullet lists
  4. Complex questions receive proportionally longer answers but still use minimal formatting (no unnecessary headers/structure)
**Plans**: 1 plan
- [ ] 83-01-PLAN.md — Rewrite Slack assistant prompt for conciseness, tone, and formatting rules

## Progress

**Total shipped:** 15 milestones, 81 phases, 198 plans

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
| 56-59 | v0.10 | 11/11 | Complete | 2026-02-16 |
| 60-65 | v0.11 | 14/14 | Complete | 2026-02-16 |
| 66-71 | v0.12 | 11/11 | Complete | 2026-02-17 |
| 72-76 | v0.13 | 6/6 | Complete | 2026-02-18 |
| 77-80 | v0.14 | 8/8 | Complete | 2026-02-19 |
| 81 | v0.15 | 4/4 | Complete | 2026-02-19 |
| 82 | 1/1 | Complete    | 2026-02-23 | - |
| 83 | 1/1 | Complete   | 2026-02-24 | - |
### Phase 84: Azure deployment health — verify embeddings/VoyageAI work on deploy and fix container log errors

**Goal:** Confirm VoyageAI embeddings work in the deployed Azure environment, add a startup smoke test, and ensure clean container startup with no error-level output
**Depends on:** Phase 83
**Plans:** 1/1 plans complete

Plans:
- [ ] 84-01-PLAN.md — Add embeddings smoke test and fix deploy.sh env vars
- [ ] 84-02-PLAN.md — Deploy to Azure, verify health, and triage container logs

### Phase 85: Code review fixes — memory leaks, hardcoded defaults, type mismatches, and missing rate limits

**Goal:** Eliminate memory leak vectors, fix hardcoded defaults, improve type safety, and add operational guardrails identified by code review
**Depends on:** Phase 84
**Plans:** 2/2 plans complete

Plans:
- [ ] 85-01-PLAN.md — InMemoryCache utility + migrate 4 unbounded stores (C-2, C-3, H-1, H-3)
- [ ] 85-02-PLAN.md — Fix hardcoded repo, structured logging, type safety, telemetry purge, Slack timeout/rate limiting (C-1, H-4, H-5, H-8, H-10, M-2)

---

*Roadmap updated: 2026-02-19 -- v0.16 roadmap created*
