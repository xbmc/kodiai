# Project Research Summary

**Project:** Kodiai v0.5 - Advanced Learning & Language Support
**Domain:** AI-powered GitHub PR review enhancement (embedding-assisted learning, incremental re-review, multi-language support)
**Researched:** 2026-02-12
**Confidence:** MEDIUM-HIGH

## Executive Summary

Kodiai v0.5 is a reliability-first evolution of an existing deterministic PR review system, not a greenfield AI architecture rewrite. The combined research is clear: experts keep the current Bun + Hono + SQLite core, add bounded retrieval from repository-scoped learning memory, and shift re-review from full reruns to SHA-accurate incremental deltas. Multi-language support should be introduced through language profiling and localized rendering, while keeping one canonical internal taxonomy for severity and categories.

The recommended approach is progressive activation behind feature flags: ship data contracts and state-machine hardening first, then retrieval with strict latency/token budgets and deterministic arbitration, then language profiles with supported-tier rollouts, then governed adaptive learning. Embedding writes must be asynchronous and non-blocking, retrieval reads synchronous but tightly bounded and fail-open. This preserves current SLA and avoids making review publication dependent on external embedding availability.

The largest risks are silent correctness failures (wrong baseline SHA, embedding index drift), trust erosion (duplicate/contradictory comments, language misinterpretation), and operational regressions (latency/cost spikes, privacy leakage). Mitigation is opinionated: key state by immutable SHAs, enforce embedding schema/version contracts, cap retrieval/prompt budgets, keep repo-scoped isolation by default, and gate each phase with replay-based integration tests rather than model-output spot checks.

## Key Findings

### Recommended Stack

v0.5 should extend the existing runtime instead of adding new infrastructure. The stack recommendation is to keep Bun + SQLite operationally intact and add only the minimum required components for semantic retrieval, language detection, and incremental diff fingerprinting.

**Core technologies:**
- `Voyage Embeddings API (v1 HTTP)`: embeddings for feedback clustering/retrieval - recommended by Anthropic guidance and supports multilingual/code use cases.
- `sqlite-vec@0.1.7-alpha.2`: in-process vector search in existing SQLite - avoids external vector DB for v0.5 scope.
- `bun:sqlite` extension loading on Bun `1.3.8`: unified scalar + vector persistence - keeps single-DB WAL transaction model.
- `linguist-languages@9.3.1`: GitHub-Linguist-aligned language tagging - enables language-aware diff/prompt behavior.
- `git patch-id --stable`: semantic diff fingerprinting - robust incremental re-review keys across line churn.

**Critical version/compatibility constraints:**
- `sqlite-vec` is alpha and platform-sensitive; Linux/container path is preferred for default enablement.
- macOS extension loading may require custom SQLite wiring; ship lexical/brute-force retrieval fallback.
- Upgrade `@anthropic-ai/claude-agent-sdk` to `^0.2.39` during rollout to reduce SDK drift.

### Expected Features

v0.5 launch should prioritize low-noise, high-trust capabilities that users already expect in advanced review tools, and defer risky automation that can degrade correctness.

**Must have (table stakes):**
- Embedding memory from explicit outcomes (accepted/suppressed/correct signals), repo-scoped by default.
- Retrieval-gated prompt enrichment with strict similarity threshold + top-K/token caps.
- Incremental re-review since last reviewed SHA (not full PR reruns).
- Duplicate suppression and resolved-thread awareness for unchanged code.
- Configurable output language (`review.outputLanguage`) with code-safe localization.
- Deterministic fail-open fallback when retrieval/localization is unavailable.

**Should have (competitive):**
- Outcome-weighted retrieval ranking (similarity + recency + acceptance bias).
- Delta summary (`new`, `resolved`, `still-open`) per re-review cycle.
- Mixed-language artifact handling within one PR.
- Explainable learning provenance in comment metadata.

**Defer (v0.6+):**
- Org-level shared learning pools (only with explicit opt-in and tenancy controls).
- Regression detector for reintroduced previously fixed findings.
- Any merge-blocking decision driven by learned confidence alone.

### Architecture Approach

The architecture should remain an orchestrated deterministic pipeline in `handlers/review.ts`: `diff -> language profile -> re-review delta -> bounded retrieval -> prompt build -> executor`, with async post-review indexing for embeddings. New capability modules belong in `src/learning/*` and `src/language/*`, while existing handler/prompt/config/store files are extended behind feature flags. This keeps critical-path behavior testable, preserves existing publish flow, and allows staged rollout with kill-switches.

**Major components:**
1. `Review Handler` - deterministic context assembly and unchanged publish lifecycle.
2. `Re-review Delta Planner` - maps prior findings to changed hunks using SHA-aware state/fingerprints.
3. `Embedding Retrieval Service` - bounded top-K retrieval with deterministic ranking/tie-breaks.
4. `Learning Indexer Worker` - async embedding/upsert path from review + feedback events.
5. `Language Profiler` - file/PR language detection + canonical normalization for prompts/storage.

### Critical Pitfalls

1. **Wrong baseline SHA in incremental mode** - key state by `(repo_id, pr_number, base_sha, head_sha)`, dedupe by delivery ID, and cancel stale runs.
2. **Embedding index drift across model/schema versions** - enforce strict vector metadata contracts and reject mixed-model retrieval.
3. **Cross-language semantic flattening** - use language profiles and supported-tier rollout with per-language quality gates.
4. **Deterministic vs retrieval-LLM contradictions** - add arbitration and precedence (`deterministic > policy > retrieval-LLM`) before publish.
5. **Latency/cost budget overruns** - enforce p95/token/call budgets, two-stage retrieval caps, caching by content hash, and circuit-breaker fallback.

## Implications for Roadmap

Based on combined research, suggested phase structure:

### Phase 1: Data Contracts, State Machine, and Governance Foundation
**Rationale:** This phase removes silent correctness/privacy failure modes before any learning behavior is visible to users.
**Delivers:** embedding/rereview schema contracts, SHA-keyed review state, webhook idempotency, stale-run cancellation, repo-scoped tenancy guards, replay harness.
**Addresses:** prerequisite dependencies for incremental re-review and embedding memory write path.
**Avoids:** wrong baseline SHA, index drift, privacy leakage, weak integration validation.

### Phase 2: Incremental Re-review + Bounded Retrieval in Advisory Mode
**Rationale:** After correctness rails, add user-visible value with strict budgeted retrieval and duplicate suppression.
**Delivers:** changed-hunk-only re-review, duplicate suppression, retrieval-gated prompt context, fail-open degraded mode, contradiction arbitration.
**Uses:** `sqlite-vec` (or lexical fallback), `git patch-id --stable`, Voyage embeddings reads.
**Implements:** `learning/retrieval.ts`, `learning/rereview-delta.ts`, prompt sections for learning/delta context.
**Avoids:** contradictory outputs, full-PR spam, latency/cost blowups.

### Phase 3: Language Support Rollout (Supported Tiers)
**Rationale:** Language expansion should follow stable incremental/retrieval behavior so quality can be measured per language.
**Delivers:** language profiler/normalization, localized prose output, canonical taxonomy preservation, code-safe localization, supported-vs-best-effort language tiers.
**Addresses:** configurable output language and multi-language diff guidance.
**Avoids:** cross-language semantic loss and unsafe identifier/code translation.

### Phase 4: Governed Adaptive Learning Enhancements
**Rationale:** Weighted/adaptive learning should only activate once replay metrics and policy controls are proven in production.
**Delivers:** explicit-outcome weighting, explainable memory provenance, optional delta summaries, controlled policy evolution with critical-category floors.
**Addresses:** differentiators that improve trust and reviewer efficiency beyond baseline v0.5.
**Avoids:** optimization for silence over correctness and uncontrolled behavior drift.

### Phase Ordering Rationale

- Phase 1 first because v0.5 risks are mostly integration/state risks, not model-quality risks.
- Phase 2 next because incremental + dedupe + retrieval are the core user-facing v0.5 value.
- Phase 3 follows to prevent language rollout from masking baseline quality regressions.
- Phase 4 last because adaptive learning is highest policy risk and depends on strong telemetry/replay signals.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** retrieval/arbitration tuning and exact budget thresholds need repo-specific benchmark calibration.
- **Phase 3:** language support tiers and per-language acceptance/dismissal targets need corpus-specific validation.
- **Phase 4:** adaptive-learning policy design needs deeper experimentation and offline replay evidence.

Phases with standard patterns (skip research-phase):
- **Phase 1:** webhook idempotency, SHA-keyed state, schema versioning, and replay harness patterns are well-established.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Strong official sources for Bun/Voyage/package versions; `sqlite-vec` alpha/runtime caveats reduce certainty. |
| Features | MEDIUM | Prioritization is coherent and dependency-driven, but some items rely on inferred product behavior vs direct usage telemetry. |
| Architecture | HIGH | Recommendations map directly to current code boundaries and established deterministic pipeline patterns. |
| Pitfalls | MEDIUM-HIGH | Integration and state pitfalls are strongly evidenced; model-behavior drift risks are directionally strong but less deterministic. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Embedding model/dimension finalization:** choose exact Voyage model/dimensions and migration policy; validate recall@k and cost on golden corpus before default enablement.
- **Runtime extension reliability:** confirm `sqlite-vec` load behavior in production/container and define permanent fallback trigger criteria.
- **Incremental mapping fidelity:** validate line-range/fingerprint remapping under force-push/rebase with deterministic replay gates.
- **Language quality thresholds:** define objective per-language gates (parse success, dismissal rates, precision proxy) before enabling inline comments broadly.
- **Policy UX for explicit feedback:** finalize canonical outcome labels and operator workflow so adaptive behavior remains auditable.

## Sources

### Primary (HIGH confidence)
- Kodiai codebase integration points (`src/handlers/review.ts`, `src/handlers/feedback-sync.ts`, `src/execution/review-prompt.ts`, `src/execution/config.ts`, `src/knowledge/store.ts`, `src/index.ts`) - current architecture constraints and extension points.
- Bun SQLite docs: https://bun.com/docs/runtime/sqlite - extension loading and runtime behavior.
- SQLite WAL docs: https://www.sqlite.org/wal.html - persistence/concurrency pattern baseline.
- Anthropic embeddings guidance: https://docs.anthropic.com/en/docs/build-with-claude/embeddings - Voyage recommendation context.
- Voyage embeddings docs: https://docs.voyageai.com/docs/embeddings - model capabilities for code/multilingual use.
- GitHub webhook best practices: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks - response/idempotency constraints.

### Secondary (MEDIUM confidence)
- sqlite-vec JS docs: https://alexgarcia.xyz/sqlite-vec/js.html - Bun integration details and caveats.
- linguist-languages package/readme: https://registry.npmjs.org/linguist-languages/latest and https://raw.githubusercontent.com/ikatyang-collab/linguist-languages/main/README.md - Linguist-aligned language data mapping.
- Git patch-id docs: https://git-scm.com/docs/git-patch-id - stable semantic patch fingerprinting.
- GitHub REST pulls/comments/files docs: https://docs.github.com/en/rest/pulls/comments and https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files - review/comment mapping and diff metadata usage.

### Tertiary (LOW confidence)
- Operational synthesis notes from prior deterministic+LLM migration patterns (from PITFALLS.md) - useful for prioritization but should be validated with Kodiai telemetry during Phase 1.

---
*Research completed: 2026-02-12*
*Ready for roadmap: yes*
