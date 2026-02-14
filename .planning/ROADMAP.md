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
- 🚧 **v0.9 Smart Dependencies & Resilience** — Phases 51-55 (in progress)

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

**Milestone Goal:** Transform Kodiai from one-shot reviewer to conversational partner, enabling dialog-based refinement of reviews and intelligent adaptation to PR context.

- [x] Phase 42: Commit Message Keywords & PR Intent (2/2 plans) -- completed 2026-02-14
- [x] Phase 43: Auto-Profile Selection (2/2 plans) -- completed 2026-02-14
- [x] Phase 44: Smart Finding Prioritization (2/2 plans) -- completed 2026-02-14
- [x] Phase 45: Author Experience Adaptation (2/2 plans) -- completed 2026-02-14
- [x] Phase 46: Conversational Review (3/3 plans) -- completed 2026-02-14
- [x] Phase 47: v0.8 Verification Backfill (2/2 plans) -- completed 2026-02-14
- [x] Phase 48: Conversational Fail-Open Hardening (2/2 plans) -- completed 2026-02-14
- [x] Phase 49: Verification Artifacts for Phases 47-48 (2/2 plans) -- completed 2026-02-14
- [x] Phase 50: Publish-Path Mention Sanitization (2/2 plans) -- completed 2026-02-14

</details>

### v0.9 Smart Dependencies & Resilience (In Progress)

**Milestone Goal:** Make Kodiai smarter about dependency bumps, resilient to large PR timeouts, and more precise in knowledge retrieval.

**Phase Numbering:**
- Integer phases (51, 52, 53): Planned milestone work
- Decimal phases (51.1, 51.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 51: Timeout Resilience** — Users get useful partial reviews instead of error messages when large PRs time out (completed 2026-02-14)
- [x] **Phase 52: Intelligent Retrieval** — Users get more relevant historical findings surfaced in reviews through better query construction (completed 2026-02-14)
- [ ] **Phase 53: Dependency Bump Detection** — Users see dependency version changes identified and classified in review output
- [ ] **Phase 54: Security Advisory & Changelog Analysis** — Users see CVE advisories and breaking change context for dependency bumps
- [ ] **Phase 55: Merge Confidence Scoring** — Users see a composite confidence assessment synthesizing all dependency signals

## Phase Details

### Phase 51: Timeout Resilience
**Goal:** Users get useful partial reviews instead of error messages when large PRs exceed execution time limits
**Depends on:** Nothing (first phase, independent of all others)
**Requirements:** TMO-01, TMO-02, TMO-03, TMO-04
**Success Criteria** (what must be TRUE):
  1. When a large PR times out, the user sees an informative summary of what was reviewed and what was skipped, not a generic error
  2. Kodiai estimates timeout risk before starting and auto-reduces review scope for high-risk PRs (fewer files or minimal profile)
  3. PR timeout duration scales with PR complexity instead of using a fixed 600s default for all PRs
  4. A 2000-line PR across 80 files gets a longer timeout and reduced scope compared to a 50-line PR across 3 files
**Plans:** 3 plans (includes 1 gap closure)
Plans:
- [x] 51-01-PLAN.md -- Timeout estimator engine and dynamic timeout wiring
- [x] 51-02-PLAN.md -- Scope reduction and informative timeout messages
- [x] 51-03-PLAN.md -- Gap closure: timeout_partial test coverage

### Phase 52: Intelligent Retrieval
**Goal:** Users get more relevant historical findings surfaced during reviews through multi-signal query construction and language-aware ranking
**Depends on:** Nothing (independent of all other phases)
**Requirements:** RET-01, RET-02
**Success Criteria** (what must be TRUE):
  1. Retrieval queries incorporate PR intent, detected languages, diff risk signals, and author tier instead of just title and file paths
  2. Same-language historical findings rank higher than cross-language results in retrieval output
  3. A TypeScript PR retrieves TypeScript-specific historical findings preferentially over Python findings at similar distance
**Plans:** 2 plans
Plans:
- [x] 52-01-PLAN.md -- TDD: multi-signal query builder + language-aware re-ranker
- [x] 52-02-PLAN.md -- Wire query builder and re-ranker into review.ts retrieval path

### Phase 53: Dependency Bump Detection
**Goal:** Users see dependency version bumps automatically identified, parsed, and classified in Kodiai reviews
**Depends on:** Nothing (independent, but recommended after Phases 51-52 for risk ordering)
**Requirements:** DEP-01, DEP-02, DEP-03
**Success Criteria** (what must be TRUE):
  1. When a Dependabot/Renovate PR is opened, Kodiai recognizes it as a dependency bump from title patterns, labels, or branch prefixes
  2. Kodiai extracts the package name, old version, new version, and ecosystem (npm/go/rust/python) from PR metadata and changed manifest files
  3. Kodiai classifies version bumps as major/minor/patch using semver comparison and flags major bumps as potential breaking changes
  4. Non-dependency PRs are unaffected — detection produces no output and adds no latency
**Plans:** 2 plans
Plans:
- [ ] 53-01-PLAN.md — TDD: dep-bump-detector module (detect, extract, classify pipeline)
- [ ] 53-02-PLAN.md — Wire detection into review.ts and review-prompt.ts

### Phase 54: Security Advisory & Changelog Analysis
**Goal:** Users see CVE/advisory information and changelog context for dependency bumps, enabling informed merge decisions
**Depends on:** Phase 53 (needs bump detection and version extraction)
**Requirements:** SEC-01, SEC-02, SEC-03, CLOG-01, CLOG-02, CLOG-03
**Success Criteria** (what must be TRUE):
  1. For detected dependency bumps, Kodiai queries GitHub Advisory Database and reports any known CVEs affecting old or new versions with severity and remediation info
  2. Kodiai distinguishes security-motivated bumps (old version has advisory, new version patches it) from routine maintenance bumps
  3. Kodiai fetches changelog/release notes between old and new versions from GitHub Releases API with fallback to CHANGELOG.md and compare URL
  4. Kodiai detects breaking changes from changelog content (BREAKING CHANGE markers, release notes) and surfaces them in the review
  5. Changelog context injected into the LLM review prompt is bounded to prevent prompt bloat
**Plans:** TBD

### Phase 55: Merge Confidence Scoring
**Goal:** Users see a clear, composite merge confidence assessment that synthesizes semver analysis, advisory status, and breaking change signals into actionable guidance
**Depends on:** Phases 53 and 54 (needs all dependency analysis signals)
**Requirements:** CONF-01, CONF-02
**Success Criteria** (what must be TRUE):
  1. Kodiai produces a merge confidence score computed from semver classification, advisory presence/absence, and breaking change detection
  2. The merge confidence is displayed prominently in the review summary with human-readable rationale explaining what contributed to the score
  3. A patch bump with no advisories and no breaking changes produces high confidence; a major bump with known CVEs produces low confidence
**Plans:** TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 51 -> 52 -> 53 -> 54 -> 55

**Total shipped:** 8 milestones, 52 phases, 150 plans

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
| 51 | v0.9 | 3/3 | Complete | 2026-02-14 |
| 52 | v0.9 | 2/2 | Complete | 2026-02-14 |
| 53 | v0.9 | 0/TBD | Not started | - |
| 54 | v0.9 | 0/TBD | Not started | - |
| 55 | v0.9 | 0/TBD | Not started | - |

---

*Roadmap updated: 2026-02-14 -- Phase 52 complete (2 plans, verified 8/8)*
