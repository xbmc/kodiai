# Roadmap: Kodiai

## Overview

v0.5 advances Kodiai from deterministic review quality controls into adaptive learning, incremental re-review, and language-aware delivery. The milestone is sequenced to harden state and governance first, then deliver incremental and retrieval behavior, then expand language support, and finally expose explainable outputs for trust.

## Milestones

- ✅ **v0.1 MVP** - Phases 1-10 (shipped 2026-02-09)
  - Archive: `.planning/milestones/v0.1-ROADMAP.md`
- ✅ **v0.2 Write Mode** - Phases 11-21 (shipped 2026-02-10)
  - Archive: `.planning/milestones/v0.2-ROADMAP.md`
- ✅ **v0.3 Configuration & Observability** - Phases 22-25 (shipped 2026-02-11)
  - Archive: `.planning/milestones/v0.3-ROADMAP.md`
- ✅ **v0.4 Intelligent Review System** - Phases 26-29 (shipped 2026-02-12)
  - Archive: `.planning/milestones/v0.4-ROADMAP.md`
- 🚧 **v0.5 Advanced Learning & Language Support** - Phases 30-33 (in progress)

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

### 🚧 v0.5 Advanced Learning & Language Support (In Progress)

**Milestone Goal:** Expand review intelligence with embedding-backed memory, SHA-accurate incremental re-review, and language-aware output while preserving low-noise, fail-open behavior.

- [ ] **Phase 30: State, Memory, and Isolation Foundation** - establish durable repo-scoped learning/state contracts for safe incremental behavior.
- [ ] **Phase 31: Incremental Re-review with Retrieval Context** - rerun reviews only where code changed, enrich with bounded similar memory, and stay publish-safe on failure.
- [ ] **Phase 32: Multi-Language Context and Localized Output** - classify language context and localize prose without changing review taxonomy or code snippets.
- [ ] **Phase 33: Explainable Learning and Delta Reporting** - make incremental outcomes and learning influence explicit in user-visible outputs.

## Phase Details

### Phase 30: State, Memory, and Isolation Foundation
**Goal**: Reviews use immutable run identity and repo-only learning memory so incremental behavior is deterministic and tenancy-safe.
**Depends on**: Phase 29
**Requirements**: LEARN-06, REL-01, REL-03
**Success Criteria** (what must be TRUE):
1. Re-running the same webhook delivery for the same base/head SHA pair does not create duplicate published review state.
2. Learning memory writes are stored with embeddings and metadata for accepted/suppressed findings and remain scoped to the originating repository.
3. Retrieval for a repo cannot read memory from any other repo unless explicit sharing is enabled.

### Phase 31: Incremental Re-review with Retrieval Context
**Goal**: Re-reviews focus only on changed code and leverage bounded similar history without blocking publication.
**Depends on**: Phase 30
**Requirements**: LEARN-07, REV-01, REV-02, REL-02
**Success Criteria** (what must be TRUE):
1. On subsequent runs, unchanged hunks are skipped and only changed hunks are reviewed.
2. Prior unresolved findings remain visible as context while duplicate comments on unchanged code are suppressed.
3. Review reasoning includes bounded top-K similar prior findings only when similarity thresholds are met.
4. If retrieval fails, review publication still succeeds with deterministic non-retrieval context.

### Phase 32: Multi-Language Context and Localized Output
**Goal**: Reviews adapt to file language and user output language while preserving canonical severity/category semantics.
**Depends on**: Phase 31
**Requirements**: CTX-05, CTX-06, LANG-01
**Success Criteria** (what must be TRUE):
1. Mixed-language pull requests are analyzed with per-file language classification and language-aware context.
2. Prompt guidance changes by detected language while severity and category labels remain in one canonical taxonomy.
3. Setting `review.outputLanguage` changes explanatory prose language but keeps code identifiers and snippets unchanged.

### Phase 33: Explainable Learning and Delta Reporting
**Goal**: Users can understand what changed between incremental runs and why learned memory influenced suggestions.
**Depends on**: Phase 31, Phase 32
**Requirements**: LEARN-09, REV-03
**Success Criteria** (what must be TRUE):
1. Incremental review summaries label findings as `new`, `resolved`, or `still-open`.
2. Suggestions influenced by retrieved memory include explainable provenance describing the influencing prior memory.
3. Users can reconcile delta status and provenance in the same published review output without separate tooling.

## Progress

| Phase | Milestone | Requirements | Status | Completed |
|-------|-----------|--------------|--------|-----------|
| 30. State, Memory, and Isolation Foundation | v0.5 | 3 | Not started | - |
| 31. Incremental Re-review with Retrieval Context | v0.5 | 4 | Not started | - |
| 32. Multi-Language Context and Localized Output | v0.5 | 3 | Not started | - |
| 33. Explainable Learning and Delta Reporting | v0.5 | 2 | Not started | - |

---

*Last updated: 2026-02-13 for v0.5 roadmap creation*
