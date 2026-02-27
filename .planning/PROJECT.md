# Kodiai

## What This Is

Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation. It replaces the current approach of forking `anthropics/claude-code-action` and maintaining workflow YAML files in every repo — instead, repos just install the app and optionally drop a `.kodiai.yml` config file.

## Core Value

When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback — inline review comments with suggestion blocks, contextual answers to questions, or PR creation from Slack write requests — without requiring any workflow setup in the target repo.

<details>
<summary>Previous Release: v0.17 Infrastructure Foundation (2026-02-24)</summary>

**Shipped:** 2026-02-24
**Phases:** 86-88 (3 phases, 8 plans)

**Delivered:**
- PostgreSQL + pgvector replaces all SQLite storage (HNSW indexes, tsvector columns, single DATABASE_URL)
- Graceful shutdown with SIGTERM handling, in-flight drain, and webhook queue replay on restart
- Zero-downtime deploys with health probes, rolling deploy config, and startup webhook replay
- Unified `src/knowledge/` module with `createRetriever()` factory for both GitHub and Slack retrieval
- E2E test proving shared retrieval path; `src/learning/` deleted (17 files removed)

</details>

<details>
<summary>Previous Release: v0.18 Knowledge Ingestion (2026-02-25)</summary>

**Shipped:** 2026-02-25
**Phases:** 89-92 (4 phases, 15 plans)
**Source:** [Issue #65](https://github.com/xbmc/kodiai/issues/65)

**Delivered:**
- 18 months of xbmc/xbmc PR review comments backfilled, embedded, and searchable with inline precedent citations
- kodi.wiki fully exported via MediaWiki API with section-based chunking, scheduled sync, and wiki citations
- Hybrid BM25+vector search per corpus with Reciprocal Rank Fusion merging across all three corpora
- Unified cross-corpus retrieval pipeline with source-aware re-ranking and cosine deduplication
- All consumers wired — @mention includes wiki+review citations, review retry preserves context, code gets hybrid search

</details>

<details>
<summary>Previous Release: v0.19 Intelligent Retrieval Enhancements (2026-02-25)</summary>

**Shipped:** 2026-02-25
**Phases:** 93-96 (4 phases, 14 plans)
**Source:** [Issue #42](https://github.com/xbmc/kodiai/issues/42)

**Delivered:**
- Language-aware retrieval boosting with 61-extension classification, proportional multi-language boost, and schema migration with backfill
- Specialized [depends] deep-review pipeline for Kodi-convention dependency bump PRs with changelog analysis, impact assessment, hash verification, and transitive dependency checks
- Unrelated CI failure recognition using Checks API base-branch comparison with flakiness tracking and annotation comments
- Hunk-level code snippet embedding as 4th retrieval corpus with content-hash dedup and fire-and-forget integration

</details>

<details>
<summary>Previous Release: v0.20 Multi-Model & Active Intelligence (2026-02-26)</summary>

**Shipped:** 2026-02-26
**Phases:** 97-102 (6 phases, 17 plans)
**Source:** [Issue #66](https://github.com/xbmc/kodiai/issues/66)

**Delivered:**
- Multi-LLM task routing via Vercel AI SDK with configurable per-repo model overrides and provider fallback
- Per-invocation cost tracking logging model, token counts, and estimated USD to Postgres
- Contributor profiles with GitHub/Slack identity linking, expertise scoring, and 4-tier adaptive review
- Wiki staleness detection with two-tier evaluation and scheduled Slack reports
- HDBSCAN-based review pattern clustering with UMAP reduction and footnote injection in PR reviews

</details>

<details>
<summary>Previous Release: v0.21 Issue Triage Foundation (2026-02-27)</summary>

**Shipped:** 2026-02-27
**Phases:** 103-105 (3 phases, 9 plans)
**Source:** [Issue #73](https://github.com/xbmc/kodiai/issues/73)

**Delivered:**
- Issue corpus with PostgreSQL `issues`/`issue_comments` tables, HNSW vector indexes, and weighted tsvector GIN indexes
- IssueStore factory with full CRUD and vector/text search interface (15 tests)
- `github_issue_label` and `github_issue_comment` MCP tools with validation, rate limit retry, and config gating
- Issue template parser reading `.md` templates with YAML frontmatter extraction and section diffing
- Triage validation agent with missing-section guidance, label recommendations, allowlist gating, and per-issue cooldown
- Triage wired to `@kodiai` mention path for issues, gated by `.kodiai.yml` `triage.enabled`

</details>

<details>
<summary>Previous Release: v0.22 Issue Intelligence (2026-02-27)</summary>

**Shipped:** 2026-02-27
**Phases:** 106-109 (4 phases, 7 plans)
**Source:** [Issue #74](https://github.com/xbmc/kodiai/issues/74)

**Delivered:**
- Historical issue corpus population via backfill script (xbmc/xbmc) with Voyage AI embeddings, HNSW indexes, and cursor-based resume
- Nightly incremental sync via GitHub Actions cron for issues and comments
- High-confidence duplicate detection with top-3 candidate formatting, similarity scores, and fail-open design
- Auto-triage on `issues.opened` with config gate, four-layer idempotency (delivery dedup, DB claim with cooldown, comment marker scan)
- PR-issue linking via explicit reference parsing (fixes/closes/relates-to) and semantic search fallback
- Linked issue context injected into PR review prompts for richer feedback
- Issue corpus wired as 5th source in unified cross-corpus RRF retrieval with `[issue: #N] Title (status)` citations
- Per-trigger issue weight tuning: pr_review=0.8, issue=1.5, question=1.2, slack=1.0

</details>

## Current State

v0.23 in progress. Interactive Troubleshooting milestone started. Issue intelligence fully operational:
- All persistent data in Azure PostgreSQL with pgvector HNSW indexes and tsvector columns
- Five knowledge corpora: code (learning_memories), PR review comments (review_comments), wiki pages (wiki_pages), code snippets (code_snippets), issues (issues)
- Unified retrieval: single `createRetriever()` call fans out to all five corpora with source-aware RRF ranking and `[issue: #N]` citations
- Hybrid search: BM25 full-text + vector similarity per corpus, merged via Reciprocal Rank Fusion
- Multi-LLM: non-agentic tasks route through Vercel AI SDK with task-based model selection; agentic tasks remain on Claude Agent SDK
- Per-invocation cost tracking: model, provider, token counts, estimated USD logged to Postgres for every LLM call
- Contributor profiles: GitHub/Slack identity linking via slash commands, expertise scoring, 4-tier adaptive review depth
- Wiki staleness: two-tier detection (heuristic + LLM), file-path evidence, scheduled Slack reports
- Review pattern clustering: HDBSCAN + UMAP, weekly batch refresh, dual-signal pattern matcher, footnote injection in PR reviews
- Issue intelligence: historical corpus, nightly sync, duplicate detection, auto-triage on issues.opened, PR-issue linking, retrieval integration
- Language-aware retrieval boosting with proportional multi-language boost and related-language affinity
- Specialized [depends] PR deep review pipeline with changelog, impact, and hash verification
- CI failure recognition: base-branch comparison via Checks API with flakiness tracking
- Automatically reviews all PRs including drafts (with soft suggestive tone and draft badge)
- Responds to `@kodiai` mentions across GitHub issue/PR/review surfaces with write-mode support and issue triage
- Operates as a Slack assistant in `#kodiai` with concise, chat-native responses and write-mode PR creation
- ~86,000 lines of TypeScript

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
- ✓ Auto-profile selection based on PR size — v0.8
- ✓ Smart finding prioritization using multi-factor scoring — v0.8
- ✓ Author experience detection and tone adaptation — v0.8
- ✓ Defense-in-depth mention sanitization across all outbound publish paths — v0.8
- ✓ Dynamic timeout scaling from PR complexity with auto scope reduction — v0.9
- ✓ Multi-signal retrieval queries with language-aware re-ranking — v0.9
- ✓ Three-stage dependency bump detection for Dependabot/Renovate PRs — v0.9
- ✓ Security advisory lookup via GitHub Advisory Database — v0.9
- ✓ Composite merge confidence scoring — v0.9
- ✓ Slack request signature/timestamp validation before processing events — v0.14
- ✓ Slack v1 low-noise: `#kodiai`-only, no DMs, thread-only replies, mention-only bootstrap — v0.14
- ✓ In-thread follow-up messages handled without repeated mentions — v0.14
- ✓ Slack assistant read-only by default (no code modifications, no PR creation) — v0.14
- ✓ Default repo context `xbmc/xbmc` with explicit override and ambiguity handling — v0.14
- ✓ Deterministic smoke/regression checks for Slack channel/thread gating — v0.14
- ✓ Slack write-intent routing with explicit prefix and conversational detection — v0.15
- ✓ Slack write execution with PR-only publish and policy/permission enforcement — v0.15
- ✓ High-impact Slack write confirmation gating with pending timeout — v0.15
- ✓ Phase 81 smoke/regression verification gates for Slack write mode — v0.15
- ✓ Kodiai reviews draft PRs the same as non-draft PRs — v0.16
- ✓ Draft PR reviews include a visible indicator that the PR is a draft — v0.16
- ✓ Slack responses omit preamble phrases — v0.16
- ✓ Slack responses omit Sources/References sections — v0.16
- ✓ Slack responses are concise (1-3 sentences for simple questions) — v0.16
- ✓ Slack responses use conversational tone — v0.16
- ✓ PostgreSQL + pgvector database replacing all SQLite usage — v0.17
- ✓ HNSW index tuning with correct distance operators — v0.17
- ✓ Full-text search columns for hybrid search foundation — v0.17
- ✓ Graceful shutdown with SIGTERM handling and drain logic — v0.17
- ✓ Zero-downtime deploys on Azure Container Apps — v0.17
- ✓ Unified knowledge layer in `src/knowledge/` for GitHub and Slack — v0.17
- ✓ 18 months of xbmc/xbmc PR review comments backfilled, chunked, embedded, and searchable — v0.18
- ✓ Review comments stored with metadata (PR number, file, line range, author, date) — v0.18
- ✓ Semantic chunking with overlapping sliding windows (1024 tokens, 256 overlap) — v0.18
- ✓ Incremental review comment sync via webhook on create/edit/delete — v0.18
- ✓ Review comment vector search with embedding persistence and NULL filtering — v0.18
- ✓ Retrieval integration with inline review precedent citations — v0.18
- ✓ kodi.wiki content exported, markdown-stripped, section-chunked, embedded, and searchable — v0.18
- ✓ Wiki incremental sync via scheduled job detecting changed pages — v0.18
- ✓ Single retrieval call fans out to code, review comments, and wiki simultaneously — v0.18
- ✓ Hybrid search (BM25 + vector) with RRF merging across heterogeneous sources — v0.18
- ✓ Source-aware re-ranking and attribution (code / review / wiki labels) on every chunk — v0.18
- ✓ Near-duplicate deduplication across corpora via cosine similarity threshold — v0.18
- ✓ Language-aware retrieval boosting with 61-extension classification map and proportional boost-only ranking — v0.19
- ✓ `[depends]` PR deep review pipeline with changelog analysis, impact assessment, and hash verification — v0.19
- ✓ Unrelated CI failure recognition with Checks API base-branch comparison and flakiness tracking — v0.19
- ✓ Hunk-level code snippet embedding as 4th retrieval corpus with content-hash dedup and configurable caps — v0.19
- ✓ Task-based model routing via Vercel AI SDK with configurable providers per task type — v0.20
- ✓ Cost tracking with model, token counts, and estimated cost per task logged to Postgres — v0.20
- ✓ Automated wiki staleness detection comparing wiki pages against code changes — v0.20
- ✓ Scheduled staleness reports (Slack message) with evidence snippets — v0.20
- ✓ HDBSCAN-based review pattern clustering with auto-generated theme labels — v0.20
- ✓ Recurring review patterns surfaced in PR review context as footnotes — v0.20
- ✓ Contributor profile table with GitHub/Slack identity linking — v0.20
- ✓ Adaptive review depth based on contributor expertise tier — v0.20
- ✓ Issue schema & vector corpus with HNSW and tsvector indexes — v0.21
- ✓ `github_issue_label` MCP tool for applying labels from agent — v0.21
- ✓ `github_issue_comment` MCP tool for posting comments from agent — v0.21
- ✓ Issue template parser reads `.md` templates and identifies missing fields — v0.21
- ✓ Triage agent validates issue body against template, comments with guidance — v0.21
- ✓ Triage agent applies `needs-info` labels when fields are missing — v0.21
- ✓ Triage wired to `@kodiai` mention path, gated by `.kodiai.yml` — v0.21
- ✓ Historical issue ingestion from xbmc/xbmc with comment threads, embeddings, and cursor-based resume — v0.22
- ✓ Nightly incremental sync via GitHub Actions for issues and comments — v0.22
- ✓ High-confidence duplicate detection with top-3 candidates and fail-open design — v0.22
- ✓ Auto-triage on `issues.opened` with config gate and four-layer idempotency — v0.22
- ✓ PR-issue linking via explicit reference parsing and semantic search fallback — v0.22
- ✓ Issue corpus as 5th source in cross-corpus retrieval with `[issue: #N]` citations — v0.22
- ✓ Per-trigger issue weight tuning in SOURCE_WEIGHTS — v0.22

### Active

v0.23 Interactive Troubleshooting — [Issue #75](https://github.com/xbmc/kodiai/issues/75)

- [ ] **TSHOOT-01**: State-filtered vector search retrieves similar resolved issues
- [ ] **TSHOOT-02**: Resolution-focused thread assembly with tail+semantic priority and per-issue character budget
- [ ] **TSHOOT-03**: Fallback to wiki search then transparent "no match" response when no similar resolved issues exist
- [ ] **TSHOOT-04**: `@kodiai` mention on open issue with troubleshooting intent synthesizes guidance from resolved issues
- [ ] **TSHOOT-05**: Troubleshooting responses cite source resolved issues with provenance disclosure
- [ ] **TSHOOT-06**: Lightweight keyword heuristic intent classification (no LLM call)
- [ ] **TSHOOT-07**: Gated behind `triage.troubleshooting.enabled` config flag (default: false)
- [ ] **TSHOOT-08**: Comment-scoped marker dedup keyed by trigger comment ID
- [ ] **OUTCOME-01**: `issues.closed` events captured with resolution outcome
- [ ] **OUTCOME-02**: Confirmed duplicate from `state_reason` or `duplicate` label (not Kodiai's label)
- [ ] **OUTCOME-03**: Outcome records link to original triage record
- [ ] **OUTCOME-04**: Handler filters out pull requests
- [ ] **OUTCOME-05**: Idempotent via delivery-ID dedup
- [ ] **LEARN-01**: Beta-Binomial Bayesian threshold auto-tuning per repo
- [ ] **LEARN-02**: Minimum 20-outcome sample gate before applying auto-tuned threshold
- [ ] **LEARN-03**: Threshold clamped to [50, 95] range
- [ ] **LEARN-04**: Duplicate detector reads effective threshold (auto-tuned or config fallback)
- [ ] **REACT-01**: Triage comment GitHub ID captured and stored
- [ ] **REACT-02**: Periodic sync job polls reactions on recent triage comments
- [ ] **REACT-03**: Reaction data feeds into outcome feedback as secondary signal

### Out of Scope

- Direct SDK agent loop for non-Claude LLMs — Phase 2+ after v1 is stable
- Bedrock / Vertex / API key auth backends — OAuth only for v1
- Public GitHub Marketplace listing — small group of known users for now
- Real-time streaming UI or dashboard — GitHub comments are the interface
- CI/CD pipeline automation — deployment is manual or separate
- Slack DM support — v1 is intentionally channel-scoped
- Multi-workspace Slack support — single workspace for now
- Slack interactive controls (buttons/modals) — text-based for v1
- YAML issue form schema support — `.md` templates sufficient for current repos

## Context

- **GitHub App:** Registered (App ID 2822869, slug `kodiai`)
- **Production:** Deployed on Azure Container Apps
  - FQDN: `ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io`
  - Webhook: `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github`
  - Slack: `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/slack/events`
- **Test repo:** `kodiai/xbmc` (public fork) used to validate PR review + mention flows
- **Core stack:** Bun + Hono, Octokit, Agent SDK (`query()`), in-process MCP servers, in-process queue (p-queue)
- **Execution model:** clone workspace -> build prompt -> invoke Claude Code -> publish outputs via MCP tools
- **Storage:** Azure PostgreSQL Flexible Server with pgvector extension (HNSW indexes, tsvector columns)
- **Embedding provider:** Voyage AI (optional, VOYAGE_API_KEY required for semantic retrieval)
- **Slack:** Bot token with `chat:write`, `reactions:write` scopes; signing secret for ingress verification
- **Codebase:** ~68,000 lines of TypeScript, 1,494 tests passing

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Bun + Hono over Node + Express | Bun is fast, has native TypeScript support, Hono is lightweight and runs anywhere | ✓ Good |
| Claude Code CLI over direct API calls | Gets full Claude Code toolchain for free — file editing, MCP, tool use | ✓ Good |
| In-process p-queue over external queue | Simpler to start; can migrate to durable queue later if needed | ✓ Good |
| Shallow clone per job | Avoids large repo downloads; 50 commits gives enough diff context | ✓ Good |
| `.kodiai.yml` config over env vars | Per-repo customization without touching the app server | ✓ Good |
| SQLite WAL mode for telemetry | Allows concurrent reads (CLI) while server writes; simpler than external DB | ✓ Good — v0.3 |
| Fire-and-forget telemetry capture | Non-blocking writes prevent telemetry failures from breaking critical path | ✓ Good — v0.3 |
| Five-section review template | Predictable structure: What Changed → Strengths → Observations → Suggestions → Verdict | ✓ Good — v0.6 |
| Post-LLM deterministic enforcement | Enforcement runs after LLM extraction, not prompt-driven; ensures guarantees | ✓ Good — v0.7 |
| Pure-function PR intent parser | Stateless parsing enables easy testing and composition with downstream resolvers | ✓ Good — v0.8 |
| Defense-in-depth publish-path sanitization | botHandles threaded through ExecutionContext to all MCP servers for self-trigger prevention | ✓ Good — v0.8 |
| Dynamic timeout scaling formula | base*(0.5+complexity), clamped [30,1800]; opt-out via config | ✓ Good — v0.9 |
| Two-signal dep bump detection | Requires both title pattern AND (label OR branch prefix) to prevent false positives | ✓ Good — v0.9 |
| Slack fail-closed signature verification | Verify raw body + timestamp before JSON parsing to preserve integrity | ✓ Good — v0.14 |
| Immediate 200 ack for Slack events | Prevents Slack retry storms; async processing after ack | ✓ Good — v0.14 |
| In-process thread session state | Deterministic for v1 single-instance; no persistence layer needed yet | ✓ Good — v0.14 |
| Slack read-only as default | Prevents accidental write operations from Slack surface; explicit intent required | ✓ Good — v0.14 |
| Reactions for Slack progress UX | `hourglass_flowing_sand` add/remove instead of unsupported typing indicators | ✓ Good — v0.14 |
| Medium-confidence conversational write detection | score>=3 heuristics route ambiguous asks to read-only with rerun guidance | ✓ Good — v0.15 |
| High-impact confirmation gating | Destructive/migration/security requests require exact confirm command with 15-min timeout | ✓ Good — v0.15 |
| PR-only Slack write execution | Executor edits workspace, runner handles branch push and PR creation; no direct repo writes from Slack | ✓ Good — v0.15 |
| ready_for_review forces isDraft=false | PR payload may still have draft=true during transition; override ensures correct tone | ✓ Good — v0.16 |
| Inline prompt conciseness rules | All four conciseness dimensions encoded directly in prompt rather than external config | ✓ Good — v0.16 |
| Void Promise smoke test pattern | Non-blocking startup diagnostics that log pass/fail without preventing boot | ✓ Good — v0.16 |
| Debian over Alpine for containers | sqlite-vec ships glibc-linked binaries; Alpine musl cannot load them | ✓ Good — v0.16 |
| Lazy eviction InMemoryCache | No timers/intervals; expired entries evicted on access and insert | ✓ Good — v0.16 |
| Inline Slack rate limiter | Per-channel sliding window (30/60s) using Map instead of external dependency | ✓ Good — v0.16 |
| postgres.js over pg/drizzle/kysely | Zero-dep tagged-template SQL, native Bun support, connection pooling | ✓ Good — v0.17 |
| Single DATABASE_URL connection pool | All stores share one pool; replaced separate TELEMETRY_DB_PATH/KNOWLEDGE_DB_PATH | ✓ Good — v0.17 |
| SIGTERM drain with webhook queue | In-flight work completes, new webhooks queued to PostgreSQL for replay on restart | ✓ Good — v0.17 |
| createRetriever() factory pattern | Single dep injection point for all handlers; fail-open with try/catch returning null | ✓ Good — v0.17 |
| Clean break on src/learning/ deletion | No backward-compat re-exports; all consumers updated to src/knowledge/ | ✓ Good — v0.17 |
| Whitespace-based token counting for chunker | No external tokenizer dependency; good enough for window sizing | ✓ Good — v0.18 |
| ON CONFLICT DO NOTHING for backfill writes | Idempotent re-runs without upsert complexity | ✓ Good — v0.18 |
| DELETE + INSERT for comment edits | Simpler than diffing chunk boundaries; transaction ensures atomicity | ✓ Good — v0.18 |
| Standalone chunk per new comment (no thread re-chunking) | Avoids re-embedding entire threads on each reply | ✓ Good — v0.18 |
| Adaptive rate limiting (1.5s/3s delays) | Stays well within GitHub API 5000 req/hr limit for 18-month backfill | ✓ Good — v0.18 |
| Mutate chunk.embedding in-place | Avoids parallel array tracking; embedding travels with chunk through pipeline | ✓ Good — v0.18 |
| Section-based wiki chunking | Split at heading boundaries; preserves semantic coherence vs fixed-size splits | ✓ Good — v0.18 |
| Reciprocal Rank Fusion (k=60) | Standard RRF constant; merges heterogeneous ranked lists without score normalization | ✓ Good — v0.18 |
| Cosine similarity dedup (0.95 threshold) | Collapse near-duplicates across corpora without losing distinct-but-similar results | ✓ Good — v0.18 |
| Source-aware weight multipliers | Wiki 1.2x, review 1.1x, code 1.0x in re-ranking; domain knowledge slightly preferred | ✓ Good — v0.18 |
| Optional learningMemoryStore in createRetriever | Backward-compatible; code corpus gets hybrid search when store is available | ✓ Good — v0.18 |
| Inline citations [wiki: Page] / [review: PR #] | Differentiated source types in mention responses for user clarity | ✓ Good — v0.18 |
| Boost-only language policy (no penalty) | Non-matching language results keep original score; avoids false negatives from language mismatch | ✓ Good — v0.19 |
| Proportional multi-language boosting | PR language distribution (80% C++ / 20% Python) drives boost weights; reflects actual change volume | ✓ Good — v0.19 |
| Related language affinity at 50% boost | C/C++, TS/JS get partial boost via RELATED_LANGUAGES map; captures ecosystem proximity | ✓ Good — v0.19 |
| Page-level wiki language tagging | All chunks from a page share same tags; avoids per-chunk detection overhead | ✓ Good — v0.19 |
| Sequential [depends] vs Dependabot detection | detectDependsBump() returns null for non-matching; Dependabot runs only if [depends] didn't match | ✓ Good — v0.19 |
| Three-tier changelog fallback | github-releases -> diff-analysis (synthesized) -> unavailable; graceful degradation | ✓ Good — v0.19 |
| Checks API over Actions API for CI | External CI systems (Jenkins) visible; not limited to GitHub Actions | ✓ Good — v0.19 |
| Content-hash dedup for hunk embedding | SHA-256 keyed UPSERT; identical hunks never re-embedded | ✓ Good — v0.19 |
| Fire-and-forget hunk embedding | Async after review completion with .catch(); never blocks review response | ✓ Good — v0.19 |
| Vercel AI SDK for non-agentic tasks | Agent SDK for agentic (reviews, mentions); AI SDK for stateless generation (labels, scoring) | ✓ Good — v0.20 |
| Task-type taxonomy with dot hierarchy | `pr-summary`, `cluster-label`, `staleness-evidence` enable per-task model routing | ✓ Good — v0.20 |
| Separate taskRouter instances for scheduled jobs | Staleness detector and cluster scheduler get own routers; executor shares one | ✓ Good — v0.20 |
| Explicit Slack slash commands for identity linking | `/kodiai link` instead of auto-detection prevents false-positive identity merges | ✓ Good — v0.20 |
| Exponential decay for expertise scoring | Recent activity weighted higher; prevents stale expertise from dominating tier | ✓ Good — v0.20 |
| Two-tier wiki staleness evaluation | Cheap heuristic pass first, LLM only on flagged subset (capped 20/cycle) | ✓ Good — v0.20 |
| Pure TypeScript HDBSCAN + umap-js | No Python sidecar; runs in same Bun process | ✓ Good — v0.20 |
| Dual-signal cluster pattern matching | Embedding similarity + file path overlap; either signal alone may be noise | ✓ Good — v0.20 |
| `.md` template parser over YAML forms | xbmc/xbmc uses markdown templates; defer YAML form support until needed | ✓ Good — v0.21 |
| Mention-triggered triage (not auto-fire) | Gives repos explicit control via `@kodiai`; auto-fire on `issues.opened` deferred to v0.22 | ✓ Good — v0.21 |
| `needs-info:{slug}` label convention | Convention-based labels with allowlist gating; labels must pre-exist in repo | ✓ Good — v0.21 |
| Per-issue cooldown with body-hash reset | Default 30 min prevents comment spam; resets when issue body changes | ✓ Good — v0.21 |
| Issue corpus deferred from retrieval | Schema built now; wiring into cross-corpus search deferred to v0.22 | ✓ Good — v0.21 |
| Embed title+body only (not full body with logs) | Problem summary captures intent; system info/logs add noise to embeddings | ✓ Good — v0.22 |
| ON CONFLICT DO UPDATE with cooldown WHERE clause | Atomic cooldown enforcement in single SQL statement; no in-memory state | ✓ Good — v0.22 |
| Four-layer idempotency for auto-triage | Delivery-ID dedup + DB claim with cooldown + comment marker scan; defense in depth | ✓ Good — v0.22 |
| Per-trigger issue weight tuning | pr_review=0.8 (supplementary), issue=1.5 (primary), question=1.2, slack=1.0 | ✓ Good — v0.22 |
| Separate issue-opened.ts handler | Avoids adding to 2000+ line mention handler; clean separation of concerns | ✓ Good — v0.22 |

## Constraints

- **Runtime:** Bun — used for both dev and production
- **Framework:** Hono for the HTTP server
- **Auth:** Claude Max OAuth token only for v1
- **Deployment:** Azure Container Apps (needs provisioning)
- **Audience:** Private use — small group of known users, not public marketplace
- **Compute:** Self-hosted (our Azure infra), not GitHub Actions runners
- **Slack:** Single workspace, single channel (`#kodiai`), bot token auth

---
*Last updated: 2026-02-27 after v0.23 milestone start*
