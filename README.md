# Kodiai

Kodiai is an installable GitHub App that delivers AI-powered code review, conversational assistance, issue intelligence, and Slack integration. One installation replaces per-repo workflow YAML — configure behavior with an optional `.kodiai.yml` file.

29 milestones shipped (v0.1 through v0.29). See [CHANGELOG.md](CHANGELOG.md) for release history.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension
- A GitHub App with webhook secret and private key
- A VoyageAI API key for embeddings

### Setup

```bash
# Clone and install
git clone https://github.com/xbmc/kodiai.git
cd kodiai
bun install

# Configure environment
cp .env.example .env
# Apply your credentials securely (do not commit .env)

# Start the dev server
bun run dev
```

The server exposes:

| Endpoint | Purpose |
|---|---|
| `POST /webhooks/github` | GitHub webhook receiver |
| `POST /webhooks/slack/events` | Slack events receiver |
| `GET /healthz` | Liveness probe |
| `GET /readiness` | Readiness probe |

## Architecture

Kodiai runs as a Bun + Hono HTTP server backed by PostgreSQL with pgvector for hybrid retrieval. It uses multi-model LLM routing via Vercel AI SDK, VoyageAI embeddings, and deploys to Azure Container Apps.

The system processes GitHub webhooks through a job queue with per-installation concurrency limits, uses Azure Files-backed workspaces for code analysis, and executes agentic tasks via isolated Azure Container App jobs that write `result.json` back to the shared workspace. Review-time structural analysis now consumes the persisted review graph substrate and canonical current-code corpus through a bounded structural-impact layer.

For the full architecture walkthrough — components, data flow, retrieval pipeline, structural-impact layer, and extension points — see **[docs/architecture.md](docs/architecture.md)**.

## Features

**Code Review** — Automatic PR review with inline suggestions, draft-aware tone, incremental re-review on changed hunks, explicit `@kodiai review` requests that publish through the dedicated `interactive-review` lane, dependency bump deep-review, bounded shallow-clone diff fallback for both automatic and explicit review flows, risk-weighted file prioritization for large PRs, collapsed clean approvals, and bounded Structural Impact evidence grounded in graph blast-radius plus canonical current-code retrieval.

**@kodiai Mentions** — Conversational responses to `@kodiai` across issue comments, PR comments, and review threads with context-aware follow-ups.

**Issue Intelligence** — Auto-triage with template validation, label recommendations, duplicate detection, troubleshooting synthesis from resolved issues, and PR creation from issues via `apply:`/`change:` commands.

**Slack Integration** — Thread-based assistant in `#kodiai` with read-only default, explicit write-mode activation, and high-impact confirmation gating.

**Knowledge System** — 6-corpus hybrid retrieval (code, review comments, wiki, code snippets, issues, canonical current-code) with BM25 + vector search, Reciprocal Rank Fusion merging, and post-RRF neural reranking.

**Epistemic Guardrails** — 3-tier knowledge classification with severity demotion for unverifiable claims, applied across all response surfaces.

**Contributor Profiles** — GitHub/Slack identity linking, expertise inference with decay scoring, 4-tier adaptive review depth, persistence-time tier recalculation, truthful review-surface contributor guidance, and bounded cache/fallback author labeling.

**Review Pattern Clustering** — HDBSCAN + UMAP theme detection injected as footnotes in PR reviews.

## Configuration

Per-repo behavior is controlled by `.kodiai.yml` — review strictness, model overrides, write-mode rules, and more.

See **[docs/configuration.md](docs/configuration.md)** for the complete reference.

For environment variables and application-level settings, see [`.env.example`](.env.example).

## Testing

```bash
# Run tests (discovery configured in bunfig.toml, scans src/)
bun test

# Type check
bunx tsc --noEmit
```

## Documentation

Full documentation lives in the `docs/` directory:

- **[Documentation Index](docs/README.md)** — Start here for architecture, configuration, runbooks, and operational guides
- **[Architecture](docs/architecture.md)** — System design, components, data flow
- **[Configuration](docs/configuration.md)** — `.kodiai.yml` reference and environment variables

## Deployment

Kodiai deploys to Azure Container Apps via ACR remote build with zero-downtime rolling deploys, and the deploy script reports the active revision for post-deploy proof.

See [docs/deployment.md](docs/deployment.md) for details. For diagnosing review-request issues, see [docs/runbooks/review-requested-debug.md](docs/runbooks/review-requested-debug.md).

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for development workflow, coding standards, and how to submit changes.

## License

Proprietary. All rights reserved.
