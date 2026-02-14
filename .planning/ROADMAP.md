# Roadmap: Kodiai

## Milestones

- ✅ **v0.1 MVP** — Phases 1-10 (shipped 2026-02-09)
- ✅ **v0.2 Write Mode** — Phases 11-21 (shipped 2026-02-10)
- ✅ **v0.3 Configuration & Observability** — Phases 22-25 (shipped 2026-02-11)
- ✅ **v0.4 Intelligent Review System** — Phases 26-29 (shipped 2026-02-12)
- ✅ **v0.5 Advanced Learning & Language Support** — Phases 30-33 (shipped 2026-02-13)
- ✅ **v0.6 Review Output Formatting & UX** — Phases 34-38 (shipped 2026-02-14)
- 🚧 **v0.7 Intelligent Review Content** — Phases 39-41 (in progress)

## Phases

<details>
<summary>✅ v0.1 MVP (Phases 1-10) — SHIPPED 2026-02-09</summary>

See `.planning/milestones/v0.1-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.2 Write Mode (Phases 11-21) — SHIPPED 2026-02-10</summary>

See `.planning/milestones/v0.2-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.3 Configuration & Observability (Phases 22-25) — SHIPPED 2026-02-11</summary>

See `.planning/milestones/v0.3-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.4 Intelligent Review System (Phases 26-29) — SHIPPED 2026-02-12</summary>

See `.planning/milestones/v0.4-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.5 Advanced Learning & Language Support (Phases 30-33) — SHIPPED 2026-02-13</summary>

**Milestone Goal:** Expand review intelligence with embedding-backed memory, SHA-accurate incremental re-review, and language-aware output while preserving low-noise, fail-open behavior.

- [x] Phase 30: State, Memory, and Isolation Foundation (3/3 plans) — completed 2026-02-12
- [x] Phase 31: Incremental Re-review with Retrieval Context (3/3 plans) — completed 2026-02-13
- [x] Phase 32: Multi-Language Context and Localized Output (3/3 plans) — completed 2026-02-13
- [x] Phase 33: Explainable Learning and Delta Reporting (3/3 plans) — completed 2026-02-13

See `.planning/milestones/v0.5-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v0.6 Review Output Formatting & UX (Phases 34-38) — SHIPPED 2026-02-14</summary>

**Milestone Goal:** Make review outputs maintainer-friendly, merge-confident, and low-drama by restructuring comment format, adding explicit merge recommendations, and removing noise.

- [x] Phase 34: Structured Review Template (2/2 plans) — completed 2026-02-13
- [x] Phase 35: Findings Organization & Tone (2/2 plans) — completed 2026-02-13
- [x] Phase 36: Verdict & Merge Confidence (2/2 plans) — completed 2026-02-13
- [x] Phase 37: Review Details Embedding (2/2 plans) — completed 2026-02-13
- [x] Phase 38: Delta Re-Review Formatting (2/2 plans) — completed 2026-02-13

See `.planning/milestones/v0.6-ROADMAP.md` for full phase details.

</details>

### 🚧 v0.7 Intelligent Review Content (In Progress)

**Milestone Goal:** Improve review content quality through language-aware severity enforcement that eliminates linter-catchable noise, risk-weighted file prioritization that focuses large PR reviews where they matter, and feedback-driven learning that auto-suppresses patterns users consistently reject.

- [ ] **Phase 39: Language-Aware Enforcement** — Suppress auto-fixable findings, enforce safety-critical severity floors
- [ ] **Phase 40: Large PR Intelligence** — Risk-score files and prioritize review attention for oversized PRs
- [ ] **Phase 41: Feedback-Driven Learning** — Auto-suppress patterns with consistent negative feedback

## Phase Details

### Phase 39: Language-Aware Enforcement
**Goal**: Reviews enforce language-specific severity rules -- auto-fixable formatting/import violations are suppressed when tooling config exists, and safety-critical patterns (null deref, unchecked errors, bare exceptions) are elevated to appropriate severity regardless of LLM judgment.
**Depends on**: Nothing (extends existing LANGUAGE_GUIDANCE; no v0.7 dependencies)
**Requirements**: LANG-01, LANG-02, LANG-03, LANG-04, LANG-05, LANG-06, LANG-07, LANG-08, LANG-09, LANG-10
**Success Criteria** (what must be TRUE):
  1. When a repo has a `.prettierrc`, `.clang-format`, `.black.toml`, or `.editorconfig`, the bot produces zero inline comments about formatting style in that language
  2. When a repo has a linter config (e.g., `.eslintrc`, `setup.cfg` with flake8), the bot produces zero inline comments about import ordering in that language
  3. C++ null dereference and uninitialized member findings appear as CRITICAL severity in published reviews, even if the LLM classified them lower
  4. Go unchecked error and Python bare except findings appear as MAJOR severity in published reviews, even if the LLM classified them lower
  5. A repo owner can override built-in language rules via `.kodiai.yml` `languageRules` config, and unknown languages receive generic review without errors
**Plans**: TBD

Plans:
- [ ] 39-01: TBD
- [ ] 39-02: TBD
- [ ] 39-03: TBD

### Phase 40: Large PR Intelligence
**Goal**: When a PR exceeds the file threshold, the bot computes per-file risk scores and applies tiered analysis -- full review for highest-risk files, abbreviated review for medium-risk, mention-only for the rest -- with transparent disclosure of what was prioritized and why.
**Depends on**: Phase 39 (benefits from language-aware severity for scoring accuracy; not a hard blocker)
**Requirements**: LARGE-01, LARGE-02, LARGE-03, LARGE-04, LARGE-05, LARGE-06, LARGE-07, LARGE-08
**Success Criteria** (what must be TRUE):
  1. For a PR with 100+ files, the bot publishes inline comments concentrated on the highest-risk files (not random or alphabetical selection)
  2. The review summary discloses exactly how many files were reviewed out of the total and states they were prioritized by risk (e.g., "Reviewed 50/312 files, prioritized by risk")
  3. Skipped/deprioritized files are listed with their risk scores so the PR author can see what was not fully reviewed
  4. The bot applies tiered depth -- full analysis for top-risk files, abbreviated analysis for mid-tier, mention-only for the rest -- not binary include/exclude
  5. A repo owner can configure the file limit threshold and risk scoring weights via `.kodiai.yml`
**Plans**: TBD

Plans:
- [ ] 40-01: TBD
- [ ] 40-02: TBD
- [ ] 40-03: TBD

### Phase 41: Feedback-Driven Learning
**Goal**: The bot learns from thumbs-down reactions on its review comments -- tracking rejection patterns by finding fingerprint, auto-suppressing patterns that cross configurable thresholds, and adjusting confidence scores -- while enforcing hard safety floors that prevent suppression of critical/security findings.
**Depends on**: Phase 39 (language severity floors inform safety floor enforcement), Phase 40 (independent, but benefits from more structured review data)
**Requirements**: FEED-01, FEED-02, FEED-03, FEED-04, FEED-05, FEED-06, FEED-07, FEED-08, FEED-09, FEED-10
**Success Criteria** (what must be TRUE):
  1. After 3+ thumbs-down reactions from 3+ distinct reactors across 2+ PRs on a finding pattern, the bot auto-suppresses that pattern in future reviews (when opt-in enabled)
  2. CRITICAL findings and MAJOR findings in security/correctness categories are never auto-suppressed regardless of feedback volume
  3. The Review Details section reports how many patterns were auto-suppressed based on prior feedback (e.g., "3 patterns auto-suppressed based on prior feedback")
  4. Feedback-driven suppression requires explicit opt-in via `.kodiai.yml` and suppression thresholds are configurable per-repo
  5. A repo owner can view and clear feedback-based suppressions, and confidence scores reflect feedback history (thumbs-up boosts, thumbs-down reduces)
**Plans**: TBD

Plans:
- [ ] 41-01: TBD
- [ ] 41-02: TBD
- [ ] 41-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 39 → 40 → 41

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-10 | v0.1 | 27/27 | ✓ Complete | 2026-02-09 |
| 11-21 | v0.2 | 30/30 | ✓ Complete | 2026-02-10 |
| 22-25 | v0.3 | 7/7 | ✓ Complete | 2026-02-11 |
| 26-29 | v0.4 | 17/17 | ✓ Complete | 2026-02-12 |
| 30-33 | v0.5 | 12/12 | ✓ Complete | 2026-02-13 |
| 34-38 | v0.6 | 10/10 | ✓ Complete | 2026-02-14 |
| 39. Language-Aware Enforcement | v0.7 | 0/TBD | Not started | - |
| 40. Large PR Intelligence | v0.7 | 0/TBD | Not started | - |
| 41. Feedback-Driven Learning | v0.7 | 0/TBD | Not started | - |
