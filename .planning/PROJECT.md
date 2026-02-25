# Kodiai

## What This Is

Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation. It replaces the current approach of forking `anthropics/claude-code-action` and maintaining workflow YAML files in every repo — instead, repos just install the app and optionally drop a `.kodiai.yml` config file.

## Core Value

When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback — inline review comments with suggestion blocks, contextual answers to questions, or PR creation from Slack write requests — without requiring any workflow setup in the target repo.

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

## Current Milestone: v0.19 Intelligent Retrieval Enhancements

**Goal:** Make retrieval smarter with language-aware boosting and sub-function granularity, add specialized deep-review pipelines for dependency bumps, and recognize unrelated CI failures.

**Target features:**
- Language-aware boosting — schema extension + retrieval ranking boost by language
- Code snippet embedding — hunk-level embedding for sub-function granularity (exploratory)
- `[depends]` PR deep review — specialized in-depth pipeline for dependency bump PRs
- Unrelated CI failure recognition — detect and annotate CI failures unrelated to PR scope

**Source:** [Issue #42](https://github.com/xbmc/kodiai/issues/42)

## Current State

v0.18 shipped. Three knowledge corpora (code, PR review comments, wiki) unified under a single retrieval call with hybrid BM25+vector search and RRF merging:
- All persistent data in Azure PostgreSQL with pgvector HNSW indexes and tsvector columns
- Three knowledge corpora: code (learning_memories), PR review comments (review_comments), wiki pages (wiki_pages)
- Unified retrieval: single `createRetriever()` call fans out to all three corpora with source-aware RRF ranking
- Hybrid search: BM25 full-text + vector similarity per corpus, merged via Reciprocal Rank Fusion
- Source attribution: every chunk labeled [code], [review], or [wiki] with inline citations in responses
- All consumers wired: @mention, PR review (primary + retry), Slack — all get unified cross-corpus context
- Incremental sync: webhooks for review comments, scheduled job for wiki pages
- Automatically reviews all PRs including drafts (with soft suggestive tone and draft badge)
- Responds to `@kodiai` mentions across GitHub issue/PR/review surfaces with write-mode support
- Operates as a Slack assistant in `#kodiai` with concise, chat-native responses and write-mode PR creation
- ~65,000 lines of TypeScript, 1,200+ tests passing

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

### Active

- [ ] Language-aware boosting with schema extension and retrieval ranking
- [ ] Code snippet embedding for sub-function granularity
- [ ] `[depends]` PR deep review pipeline with changelog analysis and impact assessment
- [ ] Unrelated CI failure recognition with reasoning annotations

### Out of Scope

- Direct SDK agent loop for non-Claude LLMs — Phase 2+ after v1 is stable
- Bedrock / Vertex / API key auth backends — OAuth only for v1
- Public GitHub Marketplace listing — small group of known users for now
- Real-time streaming UI or dashboard — GitHub comments are the interface
- CI/CD pipeline automation — deployment is manual or separate
- Slack DM support — v1 is intentionally channel-scoped
- Multi-workspace Slack support — single workspace for now
- Slack interactive controls (buttons/modals) — text-based for v1

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
- **Codebase:** ~56,000 lines of TypeScript, 1,100+ tests passing

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

## Constraints

- **Runtime:** Bun — used for both dev and production
- **Framework:** Hono for the HTTP server
- **Auth:** Claude Max OAuth token only for v1
- **Deployment:** Azure Container Apps (needs provisioning)
- **Audience:** Private use — small group of known users, not public marketplace
- **Compute:** Self-hosted (our Azure infra), not GitHub Actions runners
- **Slack:** Single workspace, single channel (`#kodiai`), bot token auth

---
*Last updated: 2026-02-25 after v0.19 milestone start*
