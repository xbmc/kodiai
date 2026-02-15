# Kodiai

## What This Is

Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews and conversational code assistance via `@kodiai` mentions. It replaces the current approach of forking `anthropics/claude-code-action` and maintaining workflow YAML files in every repo — instead, repos just install the app and optionally drop a `.kodiai.yml` config file.

## Core Value

When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback — inline review comments with suggestion blocks, or contextual answers to questions — without requiring any workflow setup in the target repo.

## Latest Release: v0.9 Smart Dependencies & Resilience

**Shipped:** 2026-02-15
**Phases:** 51-55 (5 phases, 11 plans)

**Delivered:**
- Dynamic timeout scaling and auto scope reduction for large PRs, with informative partial review messages instead of generic errors
- Multi-signal retrieval query builder incorporating PR intent, languages, diff patterns, and author tier with language-aware re-ranking
- Three-stage dependency bump detection pipeline (detect, extract, classify) identifying Dependabot/Renovate PRs with semver analysis
- Security advisory lookup via GitHub Advisory Database and changelog fetching with three-tier fallback and breaking change detection
- Composite merge confidence scoring synthesizing semver, advisory status, and breaking change signals into actionable guidance
- 865 tests passing (100% pass rate)

<details>
<summary>Previous Release: v0.8 Conversational Intelligence (2026-02-14)</summary>

**Delivered:**
- PR intent parser extracting bracket tags, conventional commit prefixes, and breaking change signals from PR metadata
- Deterministic auto-profile selection adapting review depth to PR size (strict/balanced/minimal)
- Multi-factor finding prioritization with composite scoring and configurable weights
- Author experience adaptation classifying contributors into tiers with tone-adjusted review feedback
- Conversational review enabling @kodiai follow-up responses on review findings with thread context and rate limiting
- Defense-in-depth mention sanitization across all 12 outbound publish paths preventing self-trigger loops

</details>

<details>
<summary>v0.7 Intelligent Review Content (2026-02-14)</summary>

**Delivered:**
- Language-aware enforcement with 10-pattern safety catalog (auto-suppress tooling noise, elevate C++ null deref/Go unchecked errors)
- Risk-weighted file prioritization for large PRs (5-dimension scoring, tiered analysis for top 50 files)
- Feedback-driven suppression with safety floors (auto-suppress after 3+ thumbs-down from 3+ users across 2+ PRs)
- Fail-open enforcement pipeline with composable config schema

</details>


## Requirements

### Validated

- ✓ Webhook server receives GitHub events and verifies signatures — v0.1
- ✓ GitHub App authenticates via JWT and mints installation tokens — v0.1
- ✓ Event router classifies webhooks and dispatches to handlers — v0.1
- ✓ Per-repo `.kodiai.yml` config loaded with sensible defaults (zero-config works) — v0.1
- ✓ PR auto-review on open/ready + manual re-request (`review_requested`) — v0.1
- ✓ Inline review comments with suggestion blocks — v0.1
- ✓ Fork PR support works natively — v0.1
- ✓ `@kodiai` mention handling across issue/PR/review surfaces — v0.1
- ✓ Tracking comments show progress and update on completion/error — v0.1
- ✓ Content sanitization + TOCTOU protections — v0.1
- ✓ Bot ignores its own comments (no infinite loops) — v0.1
- ✓ Job queue with per-installation concurrency limits + ephemeral workspaces — v0.1
- ✓ Review UX improvements (eyes reaction, `<details>` wrapping, conditional summaries) — v0.1
- ✓ Production deployment to Azure Container Apps (Docker + probes + secrets) — v0.1
- ✓ Review-request reliability hardening (delivery correlation, runbook, output idempotency) — v0.1
- ✓ Code modification via @mention (branch creation, commit, push) with guardrails — v0.2
- ✓ Write-mode reliability (clearer failures, safer retries, plan-only mode) — v0.2
- ✓ Forward-compatible config parsing with graceful degradation — v0.3
- ✓ Enhanced config controls (review/mention/write-mode guardrails) — v0.3
- ✓ Usage telemetry collection with persistent SQLite storage — v0.3
- ✓ CLI reporting tool with filtering and multiple output formats — v0.3
- ✓ Telemetry opt-out and cost warning thresholds — v0.3
- ✓ Review mode/severity/focus controls with noise suppression and bounded comment output — v0.4
- ✓ Context-aware review pipeline with path instructions and deterministic risk analysis — v0.4
- ✓ Repo-scoped knowledge persistence with explicit suppressions and confidence threshold filtering — v0.4
- ✓ Review Details metrics contract and persistence for review quality analysis — v0.4
- ✓ Feedback capture from human thumbs reactions with deterministic finding linkage — v0.4
- ✓ Embedding-backed learning memory with repo isolation and semantic retrieval — v0.5
- ✓ SHA-keyed run state for idempotent webhook redelivery deduplication — v0.5
- ✓ Incremental re-review focusing on changed hunks with finding deduplication — v0.5
- ✓ Bounded retrieval context with configurable top-K and distance thresholds — v0.5
- ✓ Multi-language classification and language-specific guidance for 20 languages — v0.5
- ✓ Configurable output language localization preserving code snippet integrity — v0.5
- ✓ Explainable delta reporting with new/resolved/still-open labels and learning provenance — v0.5

- ✓ Structured review output formatting with predictable sections and explicit merge verdicts — v0.6

- ✓ Language-aware enforcement with per-language severity rules — v0.7
- ✓ Auto-suppress formatting violations flagged by linters/formatters — v0.7
- ✓ Risk-weighted file prioritization for large PRs (>50 files) — v0.7
- ✓ Thumbs-down reaction feedback with confidence recalibration — v0.7
- ✓ Auto-suppression after N ignored occurrences — v0.7

- ✓ Conversational review with @kodiai follow-up responses on review findings — v0.8
- ✓ Thread context tracking with rate limiting for conversational mode — v0.8
- ✓ Auto-profile selection based on PR size (≤100 lines strict, 500+ minimal) — v0.8
- ✓ Smart finding prioritization using multi-factor scoring (severity + file risk + category + recurrence) — v0.8
- ✓ Author experience detection and tone adaptation (first-time vs regular vs core contributors) — v0.8
- ✓ Commit message keyword parsing for review intent (PR title/body analysis) — v0.8
- ✓ Bracket tag extraction (`[Component]`, `[WIP]`, etc.) — v0.8
- ✓ Breaking change detection from PR metadata — v0.8
- ✓ Review mode override via keywords (`[strict-review]`, `[quick-review]`, `[security-review]`, `[style-ok]`, `[no-review]`) — v0.8
- ✓ Defense-in-depth mention sanitization across all outbound publish paths — v0.8

- ✓ Dynamic timeout scaling from PR complexity with auto scope reduction for high-risk PRs — v0.9
- ✓ Informative partial review messages replacing generic timeout errors — v0.9
- ✓ Multi-signal retrieval queries using PR intent, languages, diff patterns, and author tier — v0.9
- ✓ Language-aware post-retrieval re-ranking boosting same-language findings — v0.9
- ✓ Three-stage dependency bump detection (detect, extract, classify) for Dependabot/Renovate PRs — v0.9
- ✓ Security advisory lookup via GitHub Advisory Database with severity and remediation info — v0.9
- ✓ Changelog fetching with three-tier fallback (GitHub Releases, CHANGELOG.md, compare URL) — v0.9
- ✓ Breaking change detection from changelog content and release notes — v0.9
- ✓ Composite merge confidence scoring synthesizing semver, advisory, and breaking change signals — v0.9

### Active

#### Current Milestone: v0.10 Advanced Signals

**Goal:** Deepen Kodiai's dependency analysis with usage-aware breaking change detection, improve timeout resilience with checkpoint publishing and retry, and sharpen retrieval with adaptive thresholds, recency weighting, and cross-language equivalence.

- [ ] Dependency usage analysis, trend tracking, and multi-package correlation
- [ ] Checkpoint publishing on timeout and retry with reduced file scope
- [ ] Adaptive retrieval thresholds, recency weighting, quality telemetry, and cross-language equivalence

### Out of Scope

- Direct SDK agent loop for non-Claude LLMs — Phase 2+ after v1 is stable
- Bedrock / Vertex / API key auth backends — OAuth only for v1
- Public GitHub Marketplace listing — small group of known users for now
- Real-time streaming UI or dashboard — GitHub comments are the interface
- CI/CD pipeline automation — deployment is manual or separate

## Context

- **GitHub App:** Registered (App ID 2822869, slug `kodiai`)
- **Production:** Deployed on Azure Container Apps
  - FQDN: `ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io`
  - Webhook: `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github`
- **Test repo:** `kodiai/xbmc` (public fork) used to validate PR review + mention flows
- **Core stack:** Bun + Hono, Octokit, Agent SDK (`query()`), in-process MCP servers, in-process queue (p-queue)
- **Execution model:** clone workspace -> build prompt -> invoke Claude Code -> publish outputs via MCP tools
- **Storage:** SQLite WAL databases (`./data/kodiai-telemetry.db`, `./data/kodiai-knowledge.db`) with sqlite-vec extension for vector retrieval
- **Embedding provider:** Voyage AI (optional, VOYAGE_API_KEY required for semantic retrieval)
- **Codebase:** ~62,385 lines of TypeScript, 865 tests passing (100% pass rate)

## Current State

v0.9 ships an installable GitHub App that:
- Automatically reviews PRs with inline comments, suggestions, and optional silent approvals
- Responds to `@kodiai` mentions across GitHub comment surfaces with write-mode support
- Adapts review behavior via per-repo mode/severity/focus/profile/path-instruction controls
- Applies deterministic diff/risk context before LLM review for targeted findings
- Persists review findings and suppression context in a SQLite knowledge store
- Filters low-confidence and explicitly suppressed findings from visible inline output
- Captures thumbs-up/down feedback reactions for future learning analysis
- Records usage telemetry (tokens, cost, duration) for every execution
- Deduplicates webhook redeliveries using SHA-keyed run state for idempotent processing
- Learns from past reviews using embedding-backed semantic retrieval with repo isolation
- Performs incremental re-reviews focusing only on changed code hunks
- Enriches review context with bounded top-K similar findings from learning memory
- Classifies and adapts to 20 programming languages with language-specific guidance
- Supports localized output language while preserving code snippet integrity
- Reports finding deltas (new/resolved/still-open) with explainable learning provenance
- Formats initial reviews with five predictable sections (What Changed → Strengths → Observations → Suggestions → Verdict)
- Categorizes findings by Impact (real risks) vs Preference (style nits) with inline severity tags
- Delivers explicit merge recommendations using blocker-driven verdict logic
- Embeds Review Details as minimal 4-line appendix in summary comments
- Shows delta-focused re-reviews highlighting only new/resolved/still-open findings with transition verdicts
- Auto-suppresses formatting/import violations when tooling configs detected (7 languages)
- Elevates safety-critical patterns to CRITICAL/MAJOR severity (C++ null deref, Go unchecked errors, Python bare except)
- Applies risk-weighted file prioritization for large PRs (>50 files) with tiered analysis (top 30 full, next 20 abbreviated)
- Learns from thumbs-down reactions and auto-suppresses patterns after 3+ rejections from 3+ users across 2+ PRs
- Enforces safety floors preventing suppression of CRITICAL and MAJOR security/correctness findings
- Parses PR title keywords and conventional commit prefixes for structured review intent signaling
- Auto-selects review depth profile based on PR size (strict ≤100, balanced 101-500, minimal >500 lines)
- Prioritizes findings using multi-factor composite scoring (severity + file risk + category + recurrence)
- Adapts review tone based on author experience tier (first-time/regular/core contributors)
- Enables conversational follow-up via @kodiai replies to review findings with thread context and rate limiting
- Sanitizes outgoing mentions across all 12 publish paths to prevent self-trigger loops
- **Estimates timeout risk and dynamically scales timeouts based on PR complexity (file count, LOC, language)**
- **Auto-reduces review scope for high-risk PRs (minimal profile + capped files) when auto-profile selected**
- **Replaces generic timeout errors with informative messages showing what was/was not reviewed**
- **Constructs multi-signal retrieval queries using PR intent, languages, diff patterns, and author tier**
- **Applies language-aware post-retrieval re-ranking to boost same-language historical findings**
- **Detects dependency bump PRs from title patterns, labels, and branch prefixes (Dependabot/Renovate)**
- **Extracts and classifies version bumps (major/minor/patch) with semver analysis**
- **Queries GitHub Advisory Database for known CVEs affecting dependency versions**
- **Fetches changelog/release notes with three-tier fallback (releases, CHANGELOG.md, compare URL)**
- **Detects breaking changes from changelog content and surfaces them in reviews**
- **Produces composite merge confidence scores with human-readable rationale**
- Provides per-repo configuration via `.kodiai.yml` (review control, mention allowlists, write-mode guardrails, telemetry opt-out, retrieval tuning, output language, language rules, large PR thresholds, feedback suppression, prioritization weights, conversation limits, timeout settings)
- Includes CLI reporting tool for operators to query usage metrics
- Is production-deployed with observability, cost warnings, and operational runbooks

## Constraints

- **Runtime:** Bun — used for both dev and production
- **Framework:** Hono for the HTTP server
- **Auth:** Claude Max OAuth token only for v1
- **Deployment:** Azure Container Apps (needs provisioning)
- **Audience:** Private use — small group of known users, not public marketplace
- **Compute:** Self-hosted (our Azure infra), not GitHub Actions runners

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Bun + Hono over Node + Express | Bun is fast, has native TypeScript support, Hono is lightweight and runs anywhere | ✓ Good |
| Claude Code CLI over direct API calls | Gets full Claude Code toolchain for free — file editing, MCP, tool use | ✓ Good |
| In-process p-queue over external queue | Simpler to start; can migrate to durable queue later if needed | ✓ Good |
| Shallow clone per job | Avoids large repo downloads; 50 commits gives enough diff context | ✓ Good |
| `.kodiai.yml` config over env vars | Per-repo customization without touching the app server | ✓ Good |
| Two-pass safeParse for config | Fast path tries full schema, fallback parses sections independently for surgical error handling | ✓ Good — v0.3 |
| SQLite WAL mode for telemetry | Allows concurrent reads (CLI) while server writes; simpler than external DB | ✓ Good — v0.3 |
| Fire-and-forget telemetry capture | Non-blocking writes prevent telemetry failures from breaking critical path | ✓ Good — v0.3 |
| Cost warnings nested in telemetry gate | Disabling telemetry suppresses both recording and warnings (user expectation) | ✓ Good — v0.3 |
| Self-contained CLI scripts in scripts/ | No src/ imports, zero coupling, prevents accidental server startup | ✓ Good — v0.3 |
| SHA-keyed run state for idempotency | Keyed by base+head SHA pair, not delivery ID; catches GitHub retries and force-push supersession | ✓ Good — v0.5 |
| Fail-open run state checks | Run state errors log warning and proceed with review; never block publication | ✓ Good — v0.5 |
| Fixed 1024-dim vec0 embeddings | Voyage AI default dimension; changing requires table recreation | — Pending — v0.5 |
| Owner-level shared pool via partition iteration | Query up to 5 repos via partition key rather than separate unpartitioned table | ✓ Good — v0.5 |
| Fire-and-forget learning memory writes | Async writes never block review completion; errors logged but non-fatal | ✓ Good — v0.5 |
| onSynchronize defaults false (opt-in) | Frequent pushes could generate expensive reviews; explicit opt-in required | ✓ Good — v0.5 |
| Conservative retrieval defaults | topK=5, distanceThreshold=0.3, maxContextChars=2000 prevents prompt bloat | ✓ Good — v0.5 |
| State-driven incremental mode | Based on prior completed review existence, not event type; works for both synchronize and review_requested | ✓ Good — v0.5 |
| Fingerprint-based finding deduplication | filePath + titleFingerprint composite key for O(1) suppression lookup | ✓ Good — v0.5 |
| Free-form outputLanguage config | z.string() not enum; LLMs understand both ISO codes and full language names | ✓ Good — v0.5 |
| Language guidance capped at top 5 | Prevents prompt bloat in multi-language PRs | ✓ Good — v0.5 |
| Distance thresholds for provenance relevance | <=0.15 high, <=0.25 moderate, else low; provides explainable confidence labels | ✓ Good — v0.5 |
| Five-section review template | Predictable structure: What Changed → Strengths → Observations → Suggestions → Verdict | ✓ Good — v0.6 |
| Impact/Preference subsections | Separates real risks from style nits; CRITICAL/MAJOR only under Impact | ✓ Good — v0.6 |
| Inline severity tags on findings | [SEVERITY] prefix on finding lines, not headings; keeps format flat and scannable | ✓ Good — v0.6 |
| Blocker-driven verdict logic | CRITICAL/MAJOR under Impact = blockers; verdict must match blocker count | ✓ Good — v0.6 |
| FORMAT-13 minimal Review Details | Exactly 4 data lines: files, lines changed, findings, timestamp; removed time-saved metric | ✓ Good — v0.6 |
| Embed-or-standalone Review Details | Published reviews embed in summary, clean reviews use standalone; fallback on append failure | ✓ Good — v0.6 |
| Conditional delta template | When deltaContext present, use delta template; standard path unchanged | ✓ Good — v0.6 |
| Transition-based delta verdict | Green=improved, blue=unchanged, yellow=worsened; distinct from initial review verdicts | ✓ Good — v0.6 |
| Discriminator chain pattern | Each sanitizer checks its tag and returns body unchanged if no match; composable | ✓ Good — v0.6 |
| 10-pattern severity floor catalog | C++ null deref/uninitialized, Go unchecked error, Python bare except, etc. with configurable overrides | ✓ Good — v0.7 |
| Tooling detection for suppression | Auto-suppress formatting when .prettierrc/.clang-format/.black exists | ✓ Good — v0.7 |
| Post-LLM deterministic enforcement | Enforcement runs after LLM extraction, not prompt-driven; ensures guarantees | ✓ Good — v0.7 |
| 5-dimension risk scoring | Lines changed + path risk + category + language + executable for composite file risk | ✓ Good — v0.7 |
| Tiered large PR analysis | Top 30 full review, next 20 abbreviated, rest mention-only; not binary include/exclude | ✓ Good — v0.7 |
| Feedback aggregation thresholds | 3+ thumbs-down from 3+ reactors across 2+ PRs triggers auto-suppression | ✓ Good — v0.7 |
| Safety floors for feedback | CRITICAL and MAJOR security/correctness never auto-suppressed regardless of feedback volume | ✓ Good — v0.7 |
| Pure-function PR intent parser | Stateless parsing enables easy testing and composition with downstream resolvers | ✓ Good — v0.8 |
| Keyword override > manual > auto precedence | Clear, deterministic profile resolution chain | ✓ Good — v0.8 |
| Normalized weighted composite scoring | Runtime-normalized weights with stable tie-breaking by original index | ✓ Good — v0.8 |
| Three-tier author classification | first-time/regular/core with definite association short-circuit before enrichment | ✓ Good — v0.8 |
| Optional finding enrichment via callback | Decoupled knowledge store from mention context via findingLookup callback | ✓ Good — v0.8 |
| Narrow fail-open guards on enrichment | Catch only enrichment failures, not structural errors; preserves degraded response path | ✓ Good — v0.8 |
| Defense-in-depth publish-path sanitization | botHandles threaded through ExecutionContext to all MCP servers for self-trigger prevention | ✓ Good — v0.8 |
| Dynamic timeout scaling formula | base*(0.5+complexity), clamped [30,1800]; opt-out via config | ✓ Good — v0.9 |
| Scope reduction respects explicit profiles | Auto-reduce only when profileSelection.source === "auto" | ✓ Good — v0.9 |
| Retrieval query 800-char cap | Prevents embedding quality degradation from long queries | ✓ Good — v0.9 |
| Mild language reranking multipliers (0.85/1.15) | Tiebreaker not dominant factor; unknown-language neutral | ✓ Good — v0.9 |
| Two-signal dep bump detection | Requires both title pattern AND (label OR branch prefix) to prevent false positives | ✓ Good — v0.9 |
| Hand-rolled semver parser | ~15 lines vs 376KB npm semver package; sufficient for comparison | ✓ Good — v0.9 |
| Both advisory calls failing = null (fail-open) | One failing returns partial data; never blocks review | ✓ Good — v0.9 |
| Advisory cap at 3 + informational framing | Prevents prompt bloat; avoids false alarm language | ✓ Good — v0.9 |
| Changelog three-tier fallback | GitHub Releases → CHANGELOG.md → compare URL; bounded to 1500 chars | ✓ Good — v0.9 |
| Severity numeric map for O(1) comparison | Avoids indexOf in confidence scoring hot path | ✓ Good — v0.9 |
| Confidence badge before package details | Prominent placement for quick scanning of merge safety | ✓ Good — v0.9 |

---
*Last updated: 2026-02-15 after v0.10 milestone start*
