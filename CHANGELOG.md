# Changelog

All notable changes to this project are documented in this file.

## v0.23 (2026-03-01)

Interactive Troubleshooting.

### Added

- State-filtered vector search and resolution-focused thread assembler for troubleshooting retrieval from closed issues
- Troubleshooting agent with LLM synthesis, provenance citations, and keyword-based intent classification
- Issue outcome capture via `issues.closed` webhook with resolution classification and delivery-ID dedup
- Beta-Binomial Bayesian duplicate threshold auto-tuning per repo with sample gate and [50,95] clamping
- Nightly reaction sync polling thumbs up/down on triage comments as secondary feedback signal for threshold learning

## v0.22 (2026-02-27)

Issue Intelligence.

### Added

- Historical issue corpus population via backfill script with Voyage AI embeddings, HNSW-indexed vectors, PR filtering, and cursor-based resume
- Nightly incremental sync via GitHub Actions cron job for issues and comments updated since last sync
- High-confidence duplicate detection with top-3 candidate formatting, fail-open design, and comment-only policy (never auto-closes)
- Auto-triage on `issues.opened` with config gate (`autoTriageOnOpen`), four-layer idempotency, and duplicate detection integration
- PR-issue linking via explicit reference parsing (fixes/closes/relates-to regex) and semantic search fallback, with linked issue context injected into review prompts
- Issue corpus wired as 5th source in unified cross-corpus RRF retrieval with `[issue: #N] Title (status)` citations

## v0.21 (2026-02-27)

Issue Triage Foundation.

### Added

- Issue corpus with PostgreSQL `issues` and `issue_comments` tables, HNSW vector indexes, and weighted tsvector GIN indexes
- `github_issue_label` MCP tool with label pre-validation, partial application, closed-issue warning, and rate limit retry
- `github_issue_comment` MCP tool with raw markdown and structured input, update-by-ID, and max length enforcement
- Issue template parser extracting YAML frontmatter and section headers from `.github/ISSUE_TEMPLATE/` templates
- Triage validation agent with missing-section guidance, `needs-info:{slug}` label recommendations, and per-issue cooldown

## v0.20 (2026-02-26)

Multi-Model & Active Intelligence.

### Added

- Multi-LLM task routing via Vercel AI SDK with task-type-based model selection, per-repo `.kodiai.yml` overrides, and automatic provider fallback
- Per-invocation cost tracking logging model, provider, token counts, and estimated USD to Postgres
- Contributor profiles with GitHub/Slack identity linking via slash commands, expertise inference with exponential decay, and 4-tier adaptive review depth
- Wiki staleness detection with two-tier evaluation (cheap heuristic pass then LLM), file-path evidence, and scheduled Slack reports
- HDBSCAN-based review pattern clustering with UMAP dimensionality reduction, auto-generated theme labels, and footnote injection in PR reviews

## v0.19 (2026-02-25)

Intelligent Retrieval Enhancements.

### Added

- Language-aware retrieval boosting with 61-extension classification map and related-language affinity
- Specialized `[depends]` deep-review pipeline for dependency bump PRs with changelog fallback, consumer impact analysis, and hash verification
- CI failure recognition using Checks API base-branch comparison with flakiness history tracking and structured annotation comments
- Hunk-level code snippet embedding as 4th retrieval corpus with content-hash SHA-256 deduplication
- Cross-corpus retrieval expanded from 3 to 4 sources with unified RRF ranking and `[snippet]` labels

## v0.18 (2026-02-25)

Knowledge Ingestion.

### Added

- 18 months of PR review comment history backfilled with thread-aware chunking and Voyage AI embeddings
- kodi.wiki fully exported via MediaWiki API with section-based chunking, scheduled incremental sync, and wiki citations
- Hybrid BM25+vector search per corpus using tsvector GIN indexes with Reciprocal Rank Fusion merging
- Unified cross-corpus retrieval pipeline: single call fans out to code, review comments, and wiki with source-aware re-ranking
- All consumers wired to unified retrieval with `[wiki: Page]` / `[review: PR #]` / `[code]` citations

## v0.17 (2026-02-24)

Infrastructure Foundation.

### Added

- Graceful shutdown with SIGTERM handling, in-flight request drain, and webhook queue for replay on restart
- Zero-downtime deploys with PostgreSQL health probes and rolling deploy config
- Unified `src/knowledge/` module with `createRetriever()` factory replacing duplicate retrieval paths

### Changed

- PostgreSQL + pgvector replaces all SQLite storage -- HNSW vector indexes, tsvector columns, single DATABASE_URL connection pool
- SQLite fully removed -- zero sqlite-vec/better-sqlite3 dependencies in application code

## v0.16 (2026-02-24)

Review Coverage & Slack UX.

### Added

- Draft PRs now reviewed with soft suggestive tone, memo badge, and draft framing
- Non-blocking VoyageAI embeddings smoke test on container boot
- Generic InMemoryCache utility with TTL and maxSize eviction, eliminating 4 unbounded memory leak vectors

### Changed

- Slack responses rewritten for conciseness -- answer-first opening, banned preamble/closing phrases, length calibration
- Dockerfile switched from Alpine to Debian for sqlite-vec glibc compatibility

## v0.15 (2026-02-19)

Slack Write Workflows.

### Added

- Deterministic Slack write-intent routing with explicit prefix detection and ambiguous read-only fallback
- Guarded PR-only write execution with Slack-to-GitHub publish flow mirroring comment links into threads
- High-impact confirmation gating for destructive/migration/security requests with 15-minute timeout and exact confirm commands

## v0.14 (2026-02-19)

Slack Integration.

### Added

- Slack ingress with fail-closed v0 signature/timestamp verification on `/webhooks/slack/events`
- Safety rails enforcing `#kodiai`-only, thread-only replies, and mention-only thread bootstrap
- Deterministic thread session semantics: `@kodiai` bootstrap starts threads, follow-ups auto-route without repeated mentions
- Read-only assistant routing with default repo context, explicit override, and one-question ambiguity handling

## v0.13 (2026-02-18)

Reliability Follow-Through.

### Added

- Deterministic live telemetry verification tooling and OPS75 preflight evidence gates
- Degraded retrieval contract hardening with exact-sentence disclosure enforcement
- Reliability regression gate CLI with deterministic check-ID diagnostics and release-blocking semantics
- Live OPS evidence capture runbook and smoke matrix for reproducible closure runs

## v0.12 (2026-02-17)

Operator Reliability & Retrieval Quality.

### Added

- Repository-scoped Search API caching with deterministic keys, TTL reuse, and in-flight de-duplication
- Rate-limit handling with retry, graceful degradation, and consistent partial analysis disclosure
- Multi-query retrieval across review and mention paths with deterministic merge/rerank and fail-open behavior
- Retrieval evidence with snippet anchors, strict prompt-budget trimming, and path-only fallback
- Conversational UX unified across issue/PR/review surfaces with one targeted clarifying-question fallback

### Changed

- Telemetry `cacheHitRate` now reports true Search cache behavior

## v0.11 (2026-02-16)

Issue Workflows.

### Added

- In-thread issue Q&A with code-aware file-path pointers and targeted clarifying questions
- Issue `@kodiai apply:` / `change:` PR creation against the default branch
- Idempotent replay, in-flight de-dupe, and rate-limit safety for issue write-mode
- Write policy guardrails: allow/deny path rules and secret-scan refusals with actionable remediation
- Permission remediation guidance with `.kodiai.yml` enablement and same-command retry

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
