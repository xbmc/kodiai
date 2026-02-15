# Changelog

All notable changes to this project are documented in this file.

## v0.9 (2026-02-15)

Smart Dependencies & Resilience.

### Added

- Dynamic timeout scaling based on PR complexity (file count, LOC, language) with configurable `timeout.dynamicScaling` and `timeout.autoReduceScope` settings
- Auto scope reduction for high-risk PRs: escalates to minimal profile and caps file count when auto-profile selected
- Informative timeout messages showing what was reviewed and what was skipped, replacing generic error messages
- Multi-signal retrieval query builder using PR intent, detected languages, diff risk signals, and author tier (capped at 800 chars)
- Language-aware post-retrieval re-ranking with mild multipliers (0.85/1.15) boosting same-language historical findings
- Three-stage dependency bump detection pipeline: detect (title + label/branch signals), extract (package, versions, ecosystem), classify (major/minor/patch)
- Support for Dependabot and Renovate PR detection across npm, Go, Rust, and Python ecosystems
- Hand-rolled semver parser (~15 lines) for version comparison without external dependencies
- Security advisory lookup via GitHub Advisory Database for old and new dependency versions
- Changelog fetching with three-tier fallback: GitHub Releases API, CHANGELOG.md file, compare URL
- Breaking change detection from changelog content (BREAKING CHANGE markers, headings, bold patterns)
- Composite merge confidence scoring (high/moderate/low/critical) synthesizing semver, advisory, and breaking change signals
- Merge confidence badge displayed prominently in dependency bump review sections with human-readable rationale
- Silent approval body includes confidence line for dependency bump PRs

### Changed

- `timeout_partial` telemetry category distinguishes partial reviews (published before timeout) from full timeouts
- Dep bump prompt section injected after author tier, before path instructions in review prompt
- Advisory sections capped at 3 advisories max with informational framing (not alarm language)
- Changelog context bounded to 1500 chars to prevent prompt bloat

## v0.8 (2026-02-14)

Conversational Intelligence.

### Added

- PR intent parser extracting bracket tags (`[Component]`, `[WIP]`), conventional commit prefixes, and breaking change signals from PR metadata
- Review mode override via keywords in PR title/body (`[strict-review]`, `[quick-review]`, `[security-review]`, `[style-ok]`, `[no-review]`)
- Deterministic auto-profile selection: strict (<=100 lines), balanced (101-500), minimal (>500 lines)
- Multi-factor finding prioritization with composite scoring (severity + file risk + category + recurrence) and configurable weights
- Author experience adaptation classifying contributors into three tiers (first-time/regular/core) with tone-adjusted review feedback
- Author tier SQLite caching for fast lookup across reviews
- Conversational review via `@kodiai` follow-up replies to review findings with thread context and rate limiting
- Finding lookup callback decoupling knowledge store from mention context
- Defense-in-depth mention sanitization across all 12 outbound publish paths preventing self-trigger loops
- `botHandles` threaded through ExecutionContext to all MCP servers

## v0.7 (2026-02-14)

Intelligent Review Content.

### Added

- Language-aware enforcement pipeline with 10-pattern severity floor catalog
- Auto-suppress formatting/import violations when tooling configs detected (.prettierrc, .clang-format, .black, etc.) across 7 languages
- Elevation of safety-critical patterns to CRITICAL/MAJOR severity (C++ null deref/uninitialized, Go unchecked errors, Python bare except)
- Risk-weighted file prioritization for large PRs with 5-dimension scoring (lines changed + path risk + category + language + executable)
- Tiered large PR analysis: top 30 full review, next 20 abbreviated, rest mention-only
- Feedback-driven auto-suppression after 3+ thumbs-down from 3+ users across 2+ PRs
- Safety floors preventing suppression of CRITICAL and MAJOR security/correctness findings regardless of feedback volume
- Composable config schema for enforcement rules with per-language overrides

## v0.6 (2026-02-14)

Review Output Formatting & UX.

### Added

- Structured five-section review template: What Changed, Strengths, Observations, Suggestions, Verdict
- Impact vs Preference subsections separating real risks from style nits
- Inline severity tags (`[CRITICAL]`, `[MAJOR]`, etc.) on finding lines
- Explicit merge recommendations using blocker-driven verdict logic (Ready to merge / Ready with minor / Address before merging)
- Review Details as compact 4-line factual appendix (files, lines changed, findings, timestamp)
- Embed-or-standalone Review Details: published reviews embed in summary, clean reviews use standalone
- Delta re-review template showing only new/resolved/still-open findings
- Transition-based delta verdicts (green=improved, blue=unchanged, yellow=worsened)
- Discriminator chain pattern for composable output sanitization

## v0.5 (2026-02-13)

Advanced Learning & Language Support.

### Added

- SHA-keyed run state for idempotent webhook redelivery deduplication (base+head SHA pair)
- Embedding-backed learning memory with Voyage AI and sqlite-vec for semantic retrieval
- Repo-isolated vector storage with owner-level shared pool via partition key iteration
- Incremental re-review focusing on changed hunks with fingerprint-based finding deduplication
- Bounded retrieval context: topK=5, distanceThreshold=0.3, maxContextChars=2000 (all configurable)
- Multi-language classification for 20 languages with language-specific guidance for 9 major languages
- Configurable `outputLanguage` for localized review output preserving code snippet integrity
- Explainable delta reporting with new/resolved/still-open labels and learning provenance citations
- Distance-based provenance confidence labels (<=0.15 high, <=0.25 moderate, else low)

### Changed

- `onSynchronize` defaults to false (opt-in) to prevent expensive reviews on frequent pushes

## v0.4 (2026-02-12)

Intelligent Review System.

### Added

- Review mode, severity floor, focus areas, and enforced comment caps via `.kodiai.yml`
- Profile presets (strict/balanced/minimal) for review depth control
- Context-aware review pipeline with deterministic diff analysis and path-scoped instructions
- Persistent knowledge store with explicit suppressions and confidence threshold filtering
- Review Details metrics contract and persistence for review quality analysis
- Reaction-based feedback capture (thumbs-up/down) linked to stored findings with idempotent persistence

## v0.3 (2026-02-11)

Configuration & Observability.

### Added

- Forward-compatible config parsing with two-pass safeParse and section-level graceful degradation
- Enhanced config controls: review/mention/write-mode guardrails
- Persistent telemetry storage with SQLite WAL mode, 90-day retention, concurrent read/write
- Fire-and-forget telemetry capture pipeline (tokens, cost, duration, model) for every execution
- Telemetry opt-out and cost warning thresholds (nested under telemetry gate)
- CLI reporting tool (`scripts/`) with time/repo filtering and multiple output formats (table/JSON/CSV)
- Deployment infrastructure: `/app/data` directory with automatic startup maintenance

## v0.2 (2026-02-10)

Write Mode.

### Added

- Code modification via `@kodiai` mention: branch creation, commit, push with guardrails
- Write-mode reliability: clearer failure messages, safer retries, plan-only mode

## v0.1 (2026-02-09)

Initial shipped milestone.

### Added

- GitHub webhook server (`/webhooks/github`) with signature verification, delivery-id deduplication, and bot filtering
- Job infrastructure: per-installation queue + ephemeral shallow-clone workspaces with cleanup
- Execution engine: Claude Code via Agent SDK `query()` with MCP servers for GitHub interactions
- PR auto-review: inline comments with suggestion blocks, conditional summary comment, silent approvals for clean PRs, fork PR support
- Mention handling: `@kodiai` across issue/PR/review surfaces with tracking comment workflow
- Content safety: sanitization and TOCTOU protections for comment context
- Ops: timeouts and user-visible error reporting, Azure Container Apps deployment script, runbooks
- Review-request reliability: `review_requested` correlation by `deliveryId` and idempotent output publication on redelivery/retry
