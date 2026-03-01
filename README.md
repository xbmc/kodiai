# Kodiai

Kodiai is an installable GitHub App that delivers knowledge-backed code review, conversational assistance, issue workflows, and Slack integration -- all powered by multi-LLM routing, 4-corpus hybrid retrieval, contributor intelligence, and review pattern clustering. One app installation replaces per-repo workflow YAML with optional `.kodiai.yml` configuration.

## What It Does

### PR Auto-Review

Triggers on `pull_request.opened`, `pull_request.ready_for_review`, and `pull_request.review_requested`.

- Posts inline diff comments with GitHub suggestion blocks for actionable issues
- Submits silent approvals for clean PRs (no comment noise)
- Supports draft PR review with soft suggestive tone and draft framing
- Incremental re-review on changed hunks with fingerprint-based finding deduplication
- Dependency bump deep-review with changelog fallback, consumer impact analysis, and hash verification
- CI failure recognition using Checks API base-branch comparison with flakiness history tracking
- Risk-weighted file prioritization for large PRs (top 30 full analysis, next 20 abbreviated)
- Review pattern clustering footnotes injected from HDBSCAN+UMAP theme detection
- Output idempotency via deterministic `X-GitHub-Delivery` correlation

### @kodiai Mentions

Triggers on `issue_comment.created`, `pull_request_review_comment.created`, and `pull_request_review.submitted`.

- Responds to `@kodiai` across issue, PR, and review comment surfaces
- Conversational follow-ups on review findings with thread context and rate limiting
- Cross-surface support with unified UX and one targeted clarifying-question fallback

### Issue Workflows

- In-thread issue Q&A with code-aware file-path pointers
- `apply:` / `change:` PR creation from issues against the default branch
- Write-mode guardrails: allow/deny path rules, secret-scan refusals, idempotent replay, in-flight de-dupe
- Permission remediation guidance with `.kodiai.yml` enablement and same-command retry

### Slack Integration

- `#kodiai` channel with `@kodiai` thread bootstrap and automatic follow-up routing
- Thread sessions with read-only default and explicit write-mode activation
- High-impact confirmation gating for destructive/migration/security requests (15-minute timeout)
- Answer-first concise responses with banned preamble/closing phrases

### Knowledge System

4-corpus hybrid retrieval with BM25+vector search per corpus and Reciprocal Rank Fusion merging:

- **Code** -- repository search with language-aware boosting (61-extension classification map)
- **Review comments** -- 18 months of PR review history with thread-aware chunking
- **Wiki** -- MediaWiki export with section-based chunking and incremental sync
- **Code snippets** -- hunk-level embeddings with content-hash SHA-256 deduplication

Cross-corpus citations appear as `[code]`, `[review: PR #]`, `[wiki: Page]`, `[snippet]` labels in responses.

### Multi-LLM Routing

- Task-type-based model selection via Vercel AI SDK task router
- Per-repo `.kodiai.yml` model overrides
- Automatic provider fallback
- Per-invocation cost tracking: model, provider, token counts, and estimated USD logged to Postgres

### Contributor Profiles

- GitHub/Slack identity linking via slash commands
- Expertise inference with exponential decay scoring
- 4-tier adaptive review depth (strict, balanced, minimal, trusted)
- Tone-adjusted feedback based on contributor experience level

### Wiki Staleness Detection

- Two-tier evaluation: cheap heuristic pass then LLM deep analysis
- File-path evidence with configurable thresholds
- Scheduled Slack reports to `#kodiai`

### Review Pattern Clustering

- HDBSCAN + UMAP dimensionality reduction on review findings
- Auto-generated theme labels with weekly refresh
- Dual-signal pattern matching injected as footnotes in PR reviews

### Cost Tracking

- Per-invocation model, provider, token count, and estimated USD logging to Postgres
- Supports filtering by repo, time range, and model

## Architecture

- **Runtime:** Bun + Hono HTTP server
- **Database:** PostgreSQL + pgvector (HNSW vector indexes, tsvector GIN indexes)
- **Embeddings:** VoyageAI voyage-code-3, 1024 dimensions, fail-open with null returns
- **LLM:** Multi-model via Vercel AI SDK + Agent SDK (Agent SDK for agentic tasks, AI SDK for non-agentic)
- **Deployment:** Azure Container Apps with ACR remote build, zero-downtime rolling deploys
- **Probes:** Liveness (`/healthz`), readiness (`/readiness`), startup health checks
- **Shutdown:** Graceful SIGTERM handling with in-flight request drain and webhook queue replay

### Internal Components

- Webhook ingress with signature verification and delivery-id dedup
- Router + filters: drop bot noise, dispatch handlers
- Job queue with per-installation concurrency limit
- Workspace manager: ephemeral shallow clone per job with cleanup
- Execution engine: Agent SDK `query()` with in-process MCP servers
- MCP servers: `github_comment`, `github_inline_comment`, `github_ci`
- `createRetriever()` factory: single dependency injection point for all retrieval
- InMemoryCache utility with TTL and maxSize eviction

## Configuration

Per-repo configuration via `.kodiai.yml` supports:

- Review strictness (mode, severity floor, focus areas, comment caps)
- Write-mode enable/disable with allow/deny path rules
- Model overrides per task type
- Telemetry opt-out and cost warning thresholds
- Profile presets and language-specific instructions

## Local Development

### Prerequisites

- Bun installed
- A GitHub App with webhook secret + private key
- A Claude Code OAuth token available as `CLAUDE_CODE_OAUTH_TOKEN`
- PostgreSQL with pgvector extension

### Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Create a local env file:

   ```bash
   cp .env.example .env
   ```

3. Run the server:

   ```bash
   bun run dev
   ```

Endpoints:

- `POST /webhooks/github` -- GitHub webhook receiver
- `POST /webhooks/slack/events` -- Slack events receiver
- `GET /healthz` -- Liveness probe
- `GET /readiness` -- Readiness probe

### Tests

```bash
bun test
```

Note: test discovery is configured in `bunfig.toml` to only scan `src/`.

Typecheck (if available in your environment):

```bash
bunx tsc --noEmit
```

## PR Creation (Avoid Literal \\n Bodies)

When creating or editing PR bodies via `gh`, avoid passing strings with `\n` escapes in shell quotes (they can land as literal `\n` in GitHub).

Use the helper scripts which always send a body file (real newlines):

```bash
# Create a PR with a body from stdin
bash scripts/gh-pr-create.sh --repo xbmc/kodiai --base main --head my-branch --title "My PR" <<'EOF'
## Issues
- ...

## Fix
- ...

## Tests
- bun test
EOF

# Update an existing PR body
bash scripts/gh-pr-set-body.sh --repo xbmc/kodiai 123 <<'EOF'
## Issues
- ...
EOF
```

## Deployment

`deploy.sh` provisions and deploys to Azure Container Apps via ACR remote build.

Details: `deployment.md`

Runbook for diagnosing manual re-request issues: `docs/runbooks/review-requested-debug.md`

## Milestones

22 milestones shipped (v0.1 through v0.23). Per-version release notes are in [MILESTONES.md](.planning/MILESTONES.md).

Archived planning artifacts live in `.planning/milestones/`.
