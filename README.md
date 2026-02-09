# Kodiai

Kodiai is an installable GitHub App that provides:

- PR auto-review (inline diff comments with GitHub suggestion blocks)
- Conversational code assistance via `@kodiai` mentions (issue + PR surfaces)

It replaces the per-repo workflow-YAML approach (forking `anthropics/claude-code-action`) with a single app installation and optional per-repo config.

## What It Does

### PR review

Triggers on:

- `pull_request.opened`
- `pull_request.ready_for_review`
- `pull_request.review_requested` (manual re-request)

Behavior:

- Posts a summary comment only when there are actionable issues
- Posts inline review comments anchored to specific diff lines
- For clean PRs, submits a silent approval (no comment noise)

Reliability:

- Correlates processing by GitHub `X-GitHub-Delivery` / `deliveryId` across ingress -> router -> queue -> execution logs
- Enforces output idempotency for `review_requested` via a deterministic output key marker to avoid duplicates on redelivery/retry

### Mentions

Triggers on:

- `issue_comment.created` (issues and PRs)
- `pull_request_review_comment.created`
- `pull_request_review.submitted`

Behavior:

- Adds an eyes reaction quickly ("tracking") where GitHub supports reactions
- Posts a reply comment answering the question (no tracking comment update)

## Architecture (High Level)

- Bun runtime + Hono server
- Webhook ingress: signature verification + delivery-id dedup
- Router + filters: drop bot noise, dispatch handlers
- Job queue: per-installation concurrency limit
- Workspace manager: ephemeral shallow clone per job + cleanup
- Execution engine: Agent SDK `query()` runs Claude Code with in-process MCP servers
- MCP servers:
  - `github_comment` (issue/PR comments create/update)
  - `github_inline_comment` (PR inline review comments)
  - `github_ci` (CI status)

## Local Development

### Prereqs

- Bun installed
- A GitHub App with webhook secret + private key
- A Claude Code OAuth token available as `CLAUDE_CODE_OAUTH_TOKEN`

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

- `POST /webhooks/github`
- `GET /health`
- `GET /readiness`

### Tests

```bash
bun test
```

Note: test discovery is configured in `bunfig.toml` to only scan `src/`.

Typecheck (if available in your environment):

```bash
bunx tsc --noEmit
```

## Deployment

`deploy.sh` provisions and deploys to Azure Container Apps.

Details:

- `deployment.md`

Runbook for diagnosing manual re-request issues:

- `docs/runbooks/review-requested-debug.md`

## Milestones

- Release notes are in `.planning/MILESTONES.md`
- Archived planning artifacts live in `.planning/milestones/`
