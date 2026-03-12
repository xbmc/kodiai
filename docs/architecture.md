# Architecture

This document explains how Kodiai works at the system level. It is written for contributors who want to understand the codebase before making changes. For configuration options, see [configuration.md](configuration.md). For deployment, see [deployment.md](deployment.md).

## Overview

Kodiai is a webhook-driven GitHub App that provides automated code review and conversational assistance on pull requests and issues. It runs as a single Hono HTTP server backed by PostgreSQL with pgvector.

The core loop:

1. GitHub sends a webhook event (PR opened, comment created, etc.)
2. Kodiai validates, deduplicates, filters, and routes the event
3. A handler enqueues a job, clones the repo, loads per-repo config
4. The executor invokes an LLM (Claude via Agent SDK) with tools and context
5. Results are published back to GitHub as comments, inline annotations, or PR reviews

Kodiai also integrates with Slack as a conversational assistant and supports write-mode operations (creating branches, commits, and PRs on behalf of users).

## Module Map

The `src/` directory contains 20 top-level modules. Each is a directory with a focused responsibility.

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `auth/` | GitHub App authentication and bot user client for fork/gist operations | `github-app.ts`, `bot-user.ts` |
| `api/` | Shared API utilities | — |
| `contributor/` | Author profiling and expertise tier calculation | `profile-store.ts`, `tier-calculator.ts`, `expertise-scorer.ts` |
| `db/` | PostgreSQL connection pool and migration runner | `client.ts`, `migrate.ts`, `migrations/` |
| `enforcement/` | Severity floors and tooling detection/suppression rules | `severity-floors.ts`, `tooling-detection.ts` |
| `execution/` | LLM execution engine, prompt building, repo config loading, MCP tool wiring | `executor.ts`, `config.ts`, `review-prompt.ts`, `mention-prompt.ts`, `mcp/` |
| `feedback/` | Reaction-based feedback aggregation and confidence adjustment | `aggregator.ts`, `confidence-adjuster.ts` |
| `handlers/` | Event handlers — one per webhook event type | `review.ts`, `mention.ts`, `ci-failure.ts`, `issue-opened.ts`, + 6 more |
| `jobs/` | Job queue (per-installation concurrency), workspace manager, fork manager | `queue.ts`, `workspace.ts`, `fork-manager.ts`, `gist-publisher.ts` |
| `knowledge/` | 5-corpus knowledge system — embeddings, retrieval, stores (63 files) | `retrieval.ts`, `store.ts`, `memory-store.ts`, `wiki-store.ts`, `code-snippet-store.ts`, `issue-store.ts`, `review-comment-store.ts` |
| `lib/` | Shared utilities — sanitizer, formatters, parsers, guardrails, diff tools | `errors.ts`, `sanitizer.ts`, `guardrail/`, `dep-bump-detector.ts`, ~40 files |
| `lifecycle/` | Request tracking, graceful shutdown, webhook queue persistence | `shutdown-manager.ts`, `request-tracker.ts`, `webhook-queue-store.ts` |
| `llm/` | Model routing (task router), cost tracking, provider abstraction | `task-router.ts`, `cost-tracker.ts`, `providers.ts` |
| `routes/` | HTTP route handlers mounted on the Hono app | `webhooks.ts`, `health.ts`, `slack-events.ts`, `slack-commands.ts` |
| `scripts/` | Operational scripts (backfills, one-off maintenance) | — |
| `slack/` | Slack assistant handler, write runner, API client | `assistant-handler.ts`, `write-runner.ts`, `client.ts` |
| `telemetry/` | Execution telemetry and rate-limit event storage | `store.ts`, `types.ts` |
| `triage/` | Issue duplicate detection and template validation | `duplicate-detector.ts`, `triage-agent.ts` |
| `types/` | Shared TypeScript type definitions | — |
| `webhook/` | Webhook ingress: signature verification, deduplication, bot filtering, event routing | `verify.ts`, `dedup.ts`, `filters.ts`, `router.ts`, `types.ts` |

## Request Lifecycle: Code Review

When a pull request is opened, synchronized, or review-requested, Kodiai performs a full code review. The flow has 12 stages:

```
GitHub webhook
  → POST /webhooks/github
  → HMAC signature verification (verify.ts)
  → Delivery ID deduplication (dedup.ts)
  → Bot/self-event filtering (filters.ts)
  → Event router dispatch by event.action key (router.ts)
  → Review handler (review.ts)
  → Job queue (per-installation concurrency: 1)
  → Workspace: clone repo at PR head ref
  → Load .kodiai.yml config (config.ts)
  → Diff analysis: compute changed files, hunks, risk scores
  → Build review prompt with context (review-prompt.ts)
  → Executor: route to model via task router → invoke Claude Agent SDK
  → Parse LLM output: extract findings with severity, category, confidence
  → Post-processing: guardrails, enforcement, dedup, feedback suppression
  → Publish inline comments + summary comment via GitHub API
  → Record findings in knowledge store, telemetry metrics
```

### Key decision points in the review flow

- **Incremental reviews**: If the PR was previously reviewed, only new/changed hunks are analyzed. Prior findings are loaded from the knowledge store for deduplication.
- **Large PR triage**: PRs exceeding configured thresholds are triaged by file risk scores. Lower-risk files may be skipped to stay within LLM context limits.
- **Dependency bump detection**: PRs that are pure dependency updates (npm, pip, etc.) get a specialized review flow with changelog and advisory enrichment.
- **Guardrails**: A post-processing pipeline validates LLM output for epistemic quality — suppressing hallucinated line references, fabricated claims, and overconfident findings.
- **Auto-approval**: If configured and all findings are below the severity threshold, Kodiai can submit an approving review.
- **Fork-based write mode**: For repos where Kodiai lacks push access, write operations go through a fork managed by a bot user account.

## Request Lifecycle: Mentions

When a user @-mentions Kodiai in a comment (on issues or PRs), it enters a conversational flow:

```
GitHub webhook (issue_comment.created / pull_request_review_comment.created / pull_request_review.submitted)
  → Webhook verification, dedup, bot filter (same as review)
  → Event router dispatch
  → Mention handler: containsMention() check (mention-types.ts)
  → Normalize comment across 3 surfaces (issue comment, review comment, review body)
  → Job queue (per-installation concurrency: 1)
  → Workspace: clone repo at PR head or default branch
  → Load .kodiai.yml config
  → Build context: conversation thread, diff context, file tree
  → Knowledge retrieval: embed query → search corpora → merge results
  → Build mention prompt with conversation history and context (mention-prompt.ts)
  → Executor: invoke Claude Agent SDK with MCP tools enabled
  → Sanitize output (strip fabricated @mentions, validate references)
  → Guardrail pipeline on response
  → Publish reply comment via GitHub API
```

### Mention-specific behaviors

- **Write mode**: When enabled, the executor gets filesystem tools via MCP. It can create branches, make commits, and open PRs — either directly or through a fork.
- **Conversation tracking**: The handler assembles the full comment thread as conversation history, providing multi-turn context to the LLM.
- **Issue context**: For issue comments (not PR), Kodiai builds code context by searching the repo for files relevant to the issue description.
- **Triage**: On newly opened issues, Kodiai can validate against issue templates, detect duplicates via embedding similarity, and suggest labels.
- **Troubleshooting**: Issues matching troubleshooting patterns get a specialized handler that searches wiki and code for resolution guidance.

## Data Layer

Kodiai uses PostgreSQL as its sole data store, with the pgvector extension for embedding-based similarity search.

### Connection model

A single connection pool (`src/db/client.ts`) is shared by all stores. Every store receives the same `sql` instance at initialization — there is no per-store connection management. Migrations run at startup via `src/db/migrate.ts` before any store is initialized.

### Stores

| Store | Module | What it holds |
|-------|--------|---------------|
| Knowledge store | `knowledge/store.ts` | Review findings, run state, prior review data per PR |
| Learning memory store | `knowledge/memory-store.ts` | Learned patterns from feedback, stored with pgvector embeddings |
| Review comment store | `knowledge/review-comment-store.ts` | Indexed review comments with embeddings for retrieval |
| Wiki page store | `knowledge/wiki-store.ts` | Synced wiki pages with embeddings (from MediaWiki) |
| Code snippet store | `knowledge/code-snippet-store.ts` | Code hunks from reviewed diffs with embeddings |
| Issue store | `knowledge/issue-store.ts` | GitHub issues with embeddings for duplicate detection |
| Cluster store | `knowledge/cluster-store.ts` | Review pattern clusters (grouped similar findings) |
| Wiki popularity store | `knowledge/wiki-popularity-store.ts` | Citation counts and popularity scores for wiki pages |
| Telemetry store | `telemetry/store.ts` | Execution metrics, cost data, rate-limit events |
| Contributor profile store | `contributor/profile-store.ts` | Author expertise profiles and tier data |
| CI check store | `lib/ci-check-store.ts` | CI failure data for failure analysis |
| Webhook queue store | `lifecycle/webhook-queue-store.ts` | Webhooks queued during graceful shutdown for replay |
| Guardrail audit store | `lib/guardrail/audit-store.ts` | Guardrail pipeline results for debugging |

### Embedding model

Embeddings are generated via the Voyage AI API. Two models are used:
- **voyage-code-3** — for code snippets, review comments, learning memories, and issues
- **voyage-context-3** — for wiki pages (uses the contextualized embedding API for better document retrieval)

Both produce 1024-dimensional vectors stored in pgvector columns.

## Key Abstractions

### Event Router (`webhook/router.ts`)

A Map-based handler registry keyed by `"event.action"` strings (e.g., `"pull_request.opened"`). Handlers register at startup; the router dispatches incoming events to all matching handlers. Errors are isolated via `Promise.allSettled` — one handler failure does not block others.

### Job Queue (`jobs/queue.ts`)

An in-memory job queue with per-installation concurrency control (default: 1 concurrent job per GitHub App installation). Handlers enqueue work; the queue executes callbacks sequentially per installation to avoid race conditions on the same repo.

### Workspace Manager (`jobs/workspace.ts`)

Creates temporary git clones for each job. Clones the repo at a specific ref (PR head, default branch), manages cleanup, and provides utilities for branch creation, committing, and pushing. Stale workspaces from previous runs are cleaned up at startup.

### Executor (`execution/executor.ts`)

The LLM execution engine. Wraps the Claude Agent SDK with:
- Model resolution via the task router
- Timeout enforcement via AbortController
- MCP tool server configuration (filesystem tools for write mode)
- Cost tracking integration
- Structured result extraction (findings, text, token usage)

### Task Router (`llm/task-router.ts`)

Routes task types (e.g., `"review.full"`, `"mention.response"`, `"slack.response"`) to specific LLM models. Supports per-task-type overrides from `.kodiai.yml` config and a fallback chain. This allows different models for different workloads (e.g., a faster model for simple mentions, a more capable model for full reviews).

### Retriever (`knowledge/retrieval.ts`)

The unified knowledge retrieval pipeline. Given a query:
1. Generates multi-query variants for broader recall
2. Embeds queries via Voyage AI
3. Searches across 5 corpora in parallel (learning memories, review comments, wiki pages, code snippets, issues)
4. Merges results via cross-corpus Reciprocal Rank Fusion (RRF)
5. Applies adaptive distance thresholds and reranking
6. Returns ranked, deduplicated context items with source attribution

### Isolation Layer (`knowledge/isolation.ts`)

Enforces repository-level data isolation for the learning memory store. Ensures that learned patterns from one repository are not leaked to another during retrieval, maintaining tenant boundaries in a shared database.

## Knowledge System

Kodiai maintains a 5-corpus knowledge system that provides contextual memory across reviews:

1. **Learning memories** — patterns learned from reviewer feedback (thumbs up/down reactions on findings)
2. **Review comments** — historical review comments indexed for similarity search
3. **Wiki pages** — documentation synced from a MediaWiki instance, refreshed on a 24-hour schedule
4. **Code snippets** — hunks from previously reviewed diffs, embedded for code-aware retrieval
5. **Issues** — GitHub issues indexed for duplicate detection and contextual reference

The retrieval pipeline unifies all five corpora through embedding-based search with cross-corpus RRF merging. Additional systems include review pattern clustering (grouping similar findings), wiki staleness detection, and wiki popularity scoring.

For detailed documentation of the knowledge system internals, see [knowledge-system.md](knowledge-system.md).

## Scheduled Background Systems

Several background schedulers run alongside the HTTP server:

| Scheduler | Interval | Purpose |
|-----------|----------|---------|
| Wiki sync | 24 hours | Incrementally syncs wiki pages from MediaWiki via RecentChanges API |
| Wiki staleness detector | 7 days | Scans wiki pages for outdated content and posts alerts to Slack |
| Wiki popularity scorer | 7 days | Computes citation-based popularity scores for wiki pages |
| Cluster scheduler | 7 days | Clusters similar review findings into patterns for reuse |

All schedulers have startup delays to avoid thundering herd on boot. They are stopped gracefully during shutdown before the database connection is closed.

## Lifecycle and Shutdown

The server implements graceful shutdown (`lifecycle/shutdown-manager.ts`):

1. SIGTERM/SIGINT triggers the shutdown sequence
2. New webhook requests are queued to the webhook queue store (PostgreSQL) instead of being processed
3. In-flight jobs are given a drain window to complete
4. Background schedulers are stopped
5. The database connection is closed

On the next startup, queued webhooks are replayed from the database, ensuring no events are lost during deploys.

## HTTP API Surface

| Endpoint | Purpose |
|----------|---------|
| `POST /webhooks/github` | GitHub webhook receiver |
| `POST /webhooks/slack/events` | Slack event receiver |
| `POST /webhooks/slack/commands/*` | Slack slash command handlers |
| `GET /healthz` | Health check (verifies DB connectivity) |
| `GET /health` | Alias for `/healthz` |
| `GET /readiness` | Readiness probe (verifies GitHub API access) |
