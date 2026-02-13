# Roadmap: Kodiai

## Overview

v0.6 restructures Kodiai's review output from free-form LLM commentary into a predictable, maintainer-friendly format with explicit merge verdicts, severity-tagged findings, and noise-free delta re-reviews. The milestone is sequenced to establish the structural template first, then refine how findings and verdicts are presented, then consolidate Review Details, and finally reshape re-review output for delta-only delivery.

## Milestones

- ✅ **v0.1 MVP** - Phases 1-10 (shipped 2026-02-09)
  - Archive: `.planning/milestones/v0.1-ROADMAP.md`
- ✅ **v0.2 Write Mode** - Phases 11-21 (shipped 2026-02-10)
  - Archive: `.planning/milestones/v0.2-ROADMAP.md`
- ✅ **v0.3 Configuration & Observability** - Phases 22-25 (shipped 2026-02-11)
  - Archive: `.planning/milestones/v0.3-ROADMAP.md`
- ✅ **v0.4 Intelligent Review System** - Phases 26-29 (shipped 2026-02-12)
  - Archive: `.planning/milestones/v0.4-ROADMAP.md`
- ✅ **v0.5 Advanced Learning & Language Support** - Phases 30-33 (shipped 2026-02-13)
  - Archive: `.planning/milestones/v0.5-ROADMAP.md`
- 🚧 **v0.6 Review Output Formatting & UX** - Phases 34-38 (in progress)

## Phases

<details>
<summary>✅ v0.1 MVP (Phases 1-10) - SHIPPED 2026-02-09</summary>

See `.planning/milestones/v0.1-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.2 Write Mode (Phases 11-21) - SHIPPED 2026-02-10</summary>

See `.planning/milestones/v0.2-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.3 Configuration & Observability (Phases 22-25) - SHIPPED 2026-02-11</summary>

See `.planning/milestones/v0.3-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.4 Intelligent Review System (Phases 26-29) - SHIPPED 2026-02-12</summary>

See `.planning/milestones/v0.4-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.5 Advanced Learning & Language Support (Phases 30-33) - SHIPPED 2026-02-13</summary>

**Milestone Goal:** Expand review intelligence with embedding-backed memory, SHA-accurate incremental re-review, and language-aware output while preserving low-noise, fail-open behavior.

- [x] Phase 30: State, Memory, and Isolation Foundation (3/3 plans) -- completed 2026-02-12
- [x] Phase 31: Incremental Re-review with Retrieval Context (3/3 plans) -- completed 2026-02-13
- [x] Phase 32: Multi-Language Context and Localized Output (3/3 plans) -- completed 2026-02-13
- [x] Phase 33: Explainable Learning and Delta Reporting (3/3 plans) -- completed 2026-02-13

See `.planning/milestones/v0.5-ROADMAP.md` for full phase details.

</details>

### 🚧 v0.6 Review Output Formatting & UX (In Progress)

**Milestone Goal:** Make review outputs maintainer-friendly, merge-confident, and low-drama by restructuring comment format, adding explicit merge recommendations, and removing noise.

- [ ] **Phase 34: Structured Review Template** - Establish predictable section layout for initial reviews
- [ ] **Phase 35: Findings Organization & Tone** - Categorize findings by impact, scope to PR intent, enforce precise language
- [ ] **Phase 36: Verdict & Merge Confidence** - Deliver explicit merge recommendations with blocker/suggestion separation
- [ ] **Phase 37: Review Details Embedding** - Consolidate Review Details into summary comment and remove noise metrics
- [ ] **Phase 38: Delta Re-Review Formatting** - Reshape re-review output to show only what changed since last review

## Phase Details

### Phase 34: Structured Review Template
**Goal**: Initial PR reviews follow a predictable, scannable structure that maintainers can navigate without reading everything
**Depends on**: Nothing (first phase of v0.6)
**Requirements**: FORMAT-01, FORMAT-02, FORMAT-05
**Success Criteria** (what must be TRUE):
  1. Initial review summary comment renders with distinct What Changed, Strengths, Observations, Suggestions, and Verdict sections in that order
  2. What Changed section includes a progress checklist showing which categories the bot reviewed (e.g., "Reviewed: core logic, error handling, tests")
  3. Strengths section uses checkmark formatting for each verified positive (e.g., "Null checks added for all nullable returns")
  4. The new template is applied consistently regardless of PR size or language
**Plans**: 2 plans

Plans:
- [ ] 34-01-PLAN.md -- Rewrite standard-mode summary prompt with five-section template and reviewed-categories helper
- [ ] 34-02-PLAN.md -- Rewrite sanitizeKodiaiReviewSummary() for five-section template validation

### Phase 35: Findings Organization & Tone
**Goal**: Findings are categorized by real impact vs preference, scoped to PR intent, and expressed with specific, low-drama language
**Depends on**: Phase 34 (section layout must exist)
**Requirements**: FORMAT-06, FORMAT-07, FORMAT-08, FORMAT-17, FORMAT-18
**Success Criteria** (what must be TRUE):
  1. Observations section separates findings into Impact (correctness, security, performance) and Preference (style, naming, organization) subsections
  2. Each finding includes a severity tag in its header ([CRITICAL], [MAJOR], [MEDIUM], [MINOR])
  3. Findings are scoped to the PR's stated intent -- a CI-fix PR does not receive style nits as top-level findings
  4. Finding language specifies concrete conditions and consequences ("causes X when Y") rather than hedged possibilities ("could potentially cause issues")
  5. Low-risk changes are called out with stabilizing language ("preserves existing behavior", "backward compatible", "minimal impact")
**Plans**: 2 plans

Plans:
- [ ] 35-01-PLAN.md -- Rewrite Observations template with Impact/Preference subsections, PR intent scoping, tone guidelines, and PR labels threading
- [ ] 35-02-PLAN.md -- Update sanitizer for Impact/Preference validation with severity-tagged finding lines

### Phase 36: Verdict & Merge Confidence
**Goal**: Maintainers can read the verdict section and know immediately whether to merge, what blocks merging, and what is optional
**Depends on**: Phase 35 (severity tagging needed for blocker identification)
**Requirements**: FORMAT-03, FORMAT-04, FORMAT-09, FORMAT-10
**Success Criteria** (what must be TRUE):
  1. Verdict section shows one of three states: "Ready to merge" (no blockers), "Ready to merge with minor items" (suggestions only), or "Address before merging" (blockers present)
  2. Blockers are labeled with severity (CRITICAL/MAJOR) and visually distinct from minor items and suggestions
  3. Suggestions are explicitly labeled "Optional" or "Future consideration" and are never counted against merge readiness
  4. A PR with zero blockers never shows a warning verdict regardless of how many suggestions exist
**Plans**: 2 plans

Plans:
- [ ] 36-01-PLAN.md -- Rewrite Verdict/Suggestions templates, add Verdict Logic section, update hard requirements for blocker-driven merge recommendations
- [ ] 36-02-PLAN.md -- Add sanitizer verdict-observations cross-check and update all test data for new verdict labels

### Phase 37: Review Details Embedding
**Goal**: Review Details appear as a compact, factual appendix inside the summary comment rather than as a separate standalone comment
**Depends on**: Phase 34 (summary comment structure must exist)
**Requirements**: FORMAT-11, FORMAT-12, FORMAT-13
**Success Criteria** (what must be TRUE):
  1. Review Details renders as a collapsible `<details>` block at the bottom of the summary comment, never as a standalone comment
  2. Review Details contains only: files reviewed, lines changed (+/-), findings by severity, and review timestamp
  3. No "Estimated review time saved" metric appears anywhere in the output
**Plans**: TBD

Plans:
- [ ] 37-01: TBD

### Phase 38: Delta Re-Review Formatting
**Goal**: Re-reviews show only what changed since the last review, giving maintainers a focused update rather than a full repeat
**Depends on**: Phase 34 (initial review structure), Phase 36 (verdict logic)
**Requirements**: FORMAT-14, FORMAT-15, FORMAT-16
**Success Criteria** (what must be TRUE):
  1. Re-review comment uses a distinct delta template: "Re-review" header with reference to previous review SHA, followed by What Changed, New Findings, Resolved Findings, Still Open, Verdict Update
  2. Delta verdict reflects the transition: "New blockers found", "Blockers resolved -- Ready to merge", or "Still ready -- No new issues"
  3. Resolved findings are shown with checkmark badges; new findings are shown with "NEW" badges; still-open findings appear as a count with expandable list
  4. Findings that have not changed since the previous review are not repeated in the main body
**Plans**: TBD

Plans:
- [ ] 38-01: TBD
- [ ] 38-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 34 -> 35 -> 36 -> 37 -> 38

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 34. Structured Review Template | v0.6 | 0/2 | Planned | - |
| 35. Findings Organization & Tone | v0.6 | 0/TBD | Not started | - |
| 36. Verdict & Merge Confidence | v0.6 | 0/2 | Planned | - |
| 37. Review Details Embedding | v0.6 | 0/TBD | Not started | - |
| 38. Delta Re-Review Formatting | v0.6 | 0/TBD | Not started | - |
