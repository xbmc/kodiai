# Roadmap: Kodiai

## Milestones

- ✅ **v0.1 MVP** — Phases 1-10 (shipped 2026-02-09)
- ✅ **v0.2 Write Mode** — Phases 11-21 (shipped 2026-02-10)
- ✅ **v0.3 Configuration & Observability** — Phases 22-25 (shipped 2026-02-11)
- ✅ **v0.4 Intelligent Review System** — Phases 26-29 (shipped 2026-02-12)
- ✅ **v0.5 Advanced Learning & Language Support** — Phases 30-33 (shipped 2026-02-13)
- ✅ **v0.6 Review Output Formatting & UX** — Phases 34-38 (shipped 2026-02-14)
- ✅ **v0.7 Intelligent Review Content** — Phases 39-41 (shipped 2026-02-14)
- **v0.8 Conversational Intelligence** — Phases 42-46 (in progress)

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

**Milestone Goal:** Improve review content quality through language-aware enforcement, large PR intelligence, and feedback-driven learning

- [x] Phase 39: Language-Aware Enforcement (4/4 plans) -- completed 2026-02-14
- [x] Phase 40: Large PR Intelligence (4/4 plans) -- completed 2026-02-14
- [x] Phase 41: Feedback-Driven Learning (3/3 plans) -- completed 2026-02-14

</details>

### v0.8 Conversational Intelligence (In Progress)

**Milestone Goal:** Transform Kodiai from one-shot reviewer to conversational partner, enabling dialog-based refinement of reviews and intelligent adaptation to PR context.

- [x] **Phase 42: Commit Message Keywords & PR Intent** — Parse PR metadata to detect review intent signals
- [x] **Phase 43: Auto-Profile Selection** — Adapt review depth based on PR size and keyword signals
- [x] **Phase 44: Smart Finding Prioritization** — Rank findings by multi-factor scoring for intelligent comment selection
- [ ] **Phase 45: Author Experience Adaptation** — Detect contributor experience level and adjust review tone
- [ ] **Phase 46: Conversational Review** — Enable dialog-based follow-up on review findings via @kodiai mentions

## Phase Details

### Phase 42: Commit Message Keywords & PR Intent
**Goal**: Users can signal review intent through PR title keywords and body markers, giving Kodiai structured context before the review begins
**Depends on**: Nothing (first phase of v0.8; pure parsing, no side effects)
**Requirements**: KEY-01, KEY-02, KEY-03, KEY-04, KEY-05, KEY-06, KEY-07, KEY-08
**Success Criteria** (what must be TRUE):
  1. Bracket tags in PR title (`[WIP]`, `[security-review]`, `[no-review]`, `[style-ok]`) are detected and influence review behavior
  2. Conventional commit prefixes in PR title (`fix:`, `feat:`, `docs:`) are recognized and parsed into structured intent
  3. "Breaking change" keyword in PR body triggers elevated review attention
  4. `[no-review]` in PR title causes the bot to skip auto-review entirely
  5. Keyword parsing results appear in Review Details appendix for transparency
**Plans**: 2 plans

Plans:
- [x] 42-01-PLAN.md — TDD: PR intent parser (bracket tags, conventional commits, breaking change detection, commit sampling, section builder)
- [x] 42-02-PLAN.md — Wire parser into review handler ([no-review] fast check, commit fetching, profile/focus/style overrides, Review Details transparency, conventional commit prompt context)

### Phase 43: Auto-Profile Selection
**Goal**: The bot automatically selects an appropriate review depth profile based on PR size and keyword overrides, so small PRs get thorough reviews and large PRs get focused ones
**Depends on**: Phase 42 (keyword-based profile overrides depend on keyword parsing)
**Requirements**: PROF-01, PROF-02, PROF-03, PROF-04, PROF-05, PROF-06
**Success Criteria** (what must be TRUE):
  1. A small PR (100 lines or fewer) receives a strict-profile review with detailed findings
  2. A large PR (over 500 lines) receives a minimal-profile review focused on critical issues
  3. A `.kodiai.yml` profile setting overrides the auto-selected profile
  4. A `[strict-review]` keyword in the PR title overrides both auto-selection and config
**Plans**: 2 plans

Plans:
- [x] 43-01-PLAN.md — TDD: deterministic auto-profile resolver (threshold bands + keyword/manual precedence metadata)
- [x] 43-02-PLAN.md — Integrate auto-profile into review handler and Review Details with runtime regression coverage

### Phase 44: Smart Finding Prioritization
**Goal**: When the bot has more findings than the comment cap allows, it selects the most important findings using a multi-factor score rather than severity alone
**Depends on**: Phase 43 (profile determines comment caps that trigger prioritization)
**Requirements**: PRIOR-01, PRIOR-02, PRIOR-03, PRIOR-04
**Success Criteria** (what must be TRUE):
  1. Findings are scored using a composite of severity, file risk, category, and recurrence
  2. When comment cap is reached, the highest-scored findings are published (not just highest severity)
  3. Review Details appendix shows prioritization stats: findings scored, top score, threshold applied
**Plans**: 2 plans

Plans:
- [x] 44-01-PLAN.md — TDD: deterministic composite finding prioritizer (severity + file risk + category + recurrence) with top-N selection stats
- [x] 44-02-PLAN.md — Wire prioritization into review handler with configurable weights, cap enforcement, and Review Details prioritization transparency

### Phase 45: Author Experience Adaptation
**Goal**: The bot adapts its review tone based on the PR author's experience level, providing more educational context for newcomers and concise feedback for core contributors
**Depends on**: Phase 42 (benefits from keyword parsing being in place; no hard dependency on 43-44)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07
**Success Criteria** (what must be TRUE):
  1. A first-time contributor receives review comments with gentler language and more explanation of why findings matter
  2. A core contributor (MEMBER/OWNER) receives terse review comments that assume context
  3. Author classification is cached in SQLite with a 24-hour TTL to avoid redundant API calls
  4. If the GitHub Search API or classification logic fails, the review proceeds normally (fail-open)
**Plans**: 2 plans

Plans:
- [ ] 45-01-PLAN.md — TDD: author classifier (three-tier mapping from author_association + PR count) and prompt tone section builder
- [ ] 45-02-PLAN.md — Wire classification into review pipeline (SQLite cache, Search API enrichment, prompt injection, Review Details, fail-open)

### Phase 46: Conversational Review
**Goal**: Users can mention @kodiai in a reply to a review finding and receive a contextual follow-up response, turning one-shot reviews into dialog
**Depends on**: Phase 42 (benefits from all prior phases; extends the mention handler)
**Requirements**: CONV-01, CONV-02, CONV-03, CONV-04, CONV-05, CONV-06
**Success Criteria** (what must be TRUE):
  1. User can reply to a review finding comment with @kodiai and receive a response that references the original finding, code snippet, and reasoning
  2. The bot loads the original finding context (not just the comment text) when responding to a reply
  3. Conversation threads are rate-limited (max N turns per PR) to prevent runaway token costs
  4. The bot does not trigger itself when responding (outgoing mention sanitization works)
  5. Context budget caps the total characters assembled per turn to prevent context window explosion
**Plans**: 3 plans

Plans:
- [ ] 46-01-PLAN.md — TDD: thread-aware context building and finding lookup (inReplyToId, getFindingByCommentId, thread context, finding-specific prompt)
- [ ] 46-02-PLAN.md — TDD: outgoing mention sanitization and conversation config schema (sanitizeOutgoingMentions, maxTurnsPerPr, contextBudgetChars)
- [ ] 46-03-PLAN.md — Wire conversational review into mention handler (rate limiting, sanitization, context budget, finding lookup integration)

## Progress

**Total shipped:** 7 milestones, 44 phases, 113 plans

**Execution Order:**
Phases execute in numeric order: 42 -> 43 -> 44 -> 45 -> 46

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-10 | v0.1 | 27/27 | Complete | 2026-02-09 |
| 11-21 | v0.2 | 30/30 | Complete | 2026-02-10 |
| 22-25 | v0.3 | 7/7 | Complete | 2026-02-11 |
| 26-29 | v0.4 | 17/17 | Complete | 2026-02-12 |
| 30-33 | v0.5 | 12/12 | Complete | 2026-02-13 |
| 34-38 | v0.6 | 10/10 | Complete | 2026-02-14 |
| 39-41 | v0.7 | 11/11 | Complete | 2026-02-14 |
| 42. Keywords & PR Intent | v0.8 | 2/2 | Complete | 2026-02-14 |
| 43. Auto-Profile Selection | v0.8 | 2/2 | Complete | 2026-02-14 |
| 44. Smart Prioritization | v0.8 | 2/2 | Complete | 2026-02-14 |
| 45. Author Adaptation | v0.8 | 0/TBD | Not started | - |
| 46. Conversational Review | v0.8 | 0/TBD | Not started | - |

---

*Roadmap updated: 2026-02-14 -- phases 42-44 completed and verified*
