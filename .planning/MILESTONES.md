# Milestones

## v0.1 MVP (Shipped: 2026-02-09)

**Scope:** 10 phases, 27 plans

**Key accomplishments:**
- GitHub webhook foundation: signature verification, delivery dedup, bot filtering, and async dispatch
- Job infrastructure: per-installation concurrency + ephemeral shallow-clone workspaces with cleanup
- Execution engine: Claude Code CLI via Agent SDK with MCP servers for GitHub interactions
- PR auto-review: inline diff comments with suggestions, fork PR support, and silent approvals for clean PRs
- Mention handling: @kodiai across issue/PR/review surfaces with tracking comment workflow
- Production deployment: Docker + Azure Container Apps, probes/secrets, operational runbooks, and review_requested idempotency hardening

---

## v0.3 Configuration & Observability (Shipped: 2026-02-11)

**Scope:** 4 phases (22-25), 7 plans

**Key accomplishments:**
- Forward-compatible config parsing with graceful section-level degradation and structured warnings
- Persistent telemetry storage with SQLite WAL mode, 90-day retention, and concurrent read/write safety
- Fire-and-forget telemetry capture pipeline recording every execution (tokens, cost, duration, model)
- Enhanced config controls: review/mention/write-mode guardrails, telemetry opt-out, cost warning thresholds
- CLI reporting tool with time/repo filtering and multiple output formats (table/JSON/CSV)
- Deployment-ready infrastructure with /app/data directory and automatic startup maintenance

---


## v0.4 Intelligent Review System (Shipped: 2026-02-12)

**Scope:** 4 phases (26-29), 17 plans

**Key accomplishments:**
- Configurable review strictness with mode, severity floor, focus areas, and enforced comment caps
- Context-aware reviews with deterministic diff analysis, path-scoped instructions, and profile presets
- Persistent knowledge store and explicit learning controls (suppressions, confidence thresholds, Review Details metrics)
- Runtime output filtering that removes suppressed/low-confidence inline findings while preserving deterministic reporting
- Reaction-based feedback capture linked to stored findings with idempotent per-repo persistence

---

## v0.5 Advanced Learning & Language Support (Shipped: 2026-02-13)

**Scope:** 4 phases (30-33), 12 plans

**Key accomplishments:**
- SHA-keyed run state idempotency for deterministic webhook redelivery deduplication
- Embedding-backed learning memory with Voyage AI and sqlite-vec for semantic retrieval with repo isolation
- Incremental re-review focusing on changed hunks with fingerprint-based finding deduplication
- Bounded retrieval context enriching review prompts with top-K similar findings and configurable thresholds
- Multi-language support for 20 languages with language-specific guidance for 9 major languages
- Explainable delta reporting showing new/resolved/still-open findings with learning provenance citations

---


## v0.6 Review Output Formatting & UX (Shipped: 2026-02-14)

**Scope:** 5 phases (34-38), 10 plans

**Key accomplishments:**
- Structured five-section review template with predictable What Changed → Strengths → Observations → Suggestions → Verdict sections
- Impact vs preference categorization separating real risks from style nits with inline severity tags
- Explicit merge recommendations using blocker-driven verdict logic (Ready to merge / Ready with minor / Address before merging)
- Embedded Review Details as compact 4-line factual appendix in summary comments (removed time-saved estimates)
- Delta re-review formatting showing only what changed (new/resolved/still-open findings) with transition-based verdicts

---


## v0.7 Intelligent Review Content (Shipped: 2026-02-14)

**Scope:** 3 phases (39-41), 11 plans
**Timeline:** 2026-02-14
**Tests:** 616 passing

**Key accomplishments:**
- Language-aware enforcement with 10-pattern severity floor catalog (auto-suppress tooling noise, elevate C++ null deref/Go unchecked errors)
- Risk-weighted file prioritization for large PRs with 5-dimension scoring and tiered analysis (top 30 full, next 20 abbreviated)
- Feedback-driven auto-suppression after 3+ thumbs-down from 3+ users across 2+ PRs with safety floors for CRITICAL/MAJOR

---


## v0.8 Conversational Intelligence (Shipped: 2026-02-14)

**Scope:** 9 phases (42-50), 19 plans
**Timeline:** 2026-02-14
**Tests:** 736 passing
**Git range:** feat(42-01) → docs(phase-50)

**Key accomplishments:**
- PR intent parser extracting bracket tags, conventional commit prefixes, and breaking change signals from PR metadata
- Deterministic auto-profile selection adapting review depth to PR size (strict ≤100, balanced 101-500, minimal >500 lines)
- Multi-factor finding prioritization with composite scoring (severity + file risk + category + recurrence) and configurable weights
- Author experience adaptation classifying contributors into tiers with tone-adjusted review feedback and SQLite caching
- Conversational review enabling @kodiai follow-up responses on review findings with thread context, rate limiting, and context budgets
- Defense-in-depth mention sanitization across all 12 outbound publish paths preventing self-trigger loops

---


## v0.9 Smart Dependencies & Resilience (Shipped: 2026-02-15)

**Scope:** 5 phases (51-55), 11 plans
**Timeline:** 2026-02-14 → 2026-02-14
**Tests:** 865 passing
**Git range:** feat(51-01) → feat(55-02)

**Key accomplishments:**
- Dynamic timeout scaling and auto scope reduction for large PRs, with informative partial review messages instead of generic errors
- Multi-signal retrieval query builder incorporating PR intent, languages, diff patterns, and author tier with language-aware re-ranking
- Three-stage dependency bump detection pipeline (detect, extract, classify) identifying Dependabot/Renovate PRs with semver analysis
- Security advisory lookup via GitHub Advisory Database and changelog fetching with three-tier fallback and breaking change detection
- Composite merge confidence scoring synthesizing semver, advisory status, and breaking change signals into actionable guidance

---


## v0.11 Issue Workflows (Shipped: 2026-02-16)

**Scope:** 6 phases (60-65), 15 plans

**Key accomplishments:**
- In-thread issue Q&A now returns concrete answers with code-aware file-path pointers and targeted clarifying questions when context is missing.
- Issue `@kodiai apply:` / `change:` requests can open PRs against the default branch with deterministic write-output identities and branch naming.
- Issue write-mode now enforces idempotent replay behavior, in-flight de-dupe, and rate-limit safety to prevent duplicate PR churn.
- Issue write policy guardrails enforce allow/deny path rules and secret-scan refusals with actionable, non-sensitive remediation guidance.
- Permission and disabled-write failures now return deterministic minimum-scope permission remediation and `.kodiai.yml` enablement guidance with same-command retry.

---
