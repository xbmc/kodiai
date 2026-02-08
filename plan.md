# Kodiai - GitHub App Bot Implementation Plan

## Context

We currently use a forked `anthropics/claude-code-action` GitHub Action plus custom workflow YAML files in the xbmc repo to get AI-powered PR reviews and `@claude` mention handling. This approach has significant drawbacks:
- Requires workflow YAML in every repo
- Fork PR support requires ugly workarounds (fetching PR head info, conditional checkout logic)
- Depends on Anthropic's OIDC token exchange for GitHub App tokens
- Consumes GitHub Actions minutes for every interaction
- Configuration is scattered across workflow files

**Kodiai** replaces this with an **installable GitHub App** that receives webhook events directly, requires zero workflow YAML, handles forks natively, and works on any repo that installs it.

## Architecture Overview

```
GitHub Webhook POST
        |
        v
+---------------------+     +------------------+
|  Webhook Server     |---->|  Config Loader   |
|  (Hono on Bun)      |     |  (.kodiai.yml)   |
|  Signature verify   |     +------------------+
+---------------------+
        |
        v
+---------------------+     +------------------+
|  Event Router       |---->|  GitHub App Auth |
|  Filter, classify   |     |  (JWT + install  |
|  Detect @kodiai     |     |   access tokens) |
+---------------------+     +------------------+
        |
        v
+---------------------+
|  Job Queue          |  In-process async (p-queue)
|  Per-install limits |  Future: Azure Service Bus
+---------------------+
        |
        v
+---------------------+
|  Job Worker         |
|  1. Clone repo      |
|  2. Setup git auth  |
|  3. Setup MCP       |
|  4. Build prompt    |
|  5. Run Claude CLI  |
|  6. Cleanup         |
+---------------------+
        |
   +----+----+
   v         v
+--------+ +--------------+
|Claude  | |Direct SDK    |
|Code CLI| |Agent Loop    |
|(OAuth) | |(other LLMs)  |
+--------+ +--------------+
```

### Two Execution Backends

1. **Claude Code CLI** (via `@anthropic-ai/claude-agent-sdk`) - For Claude models. Supports OAuth (Claude Max), API keys, Bedrock, Vertex. Gets the full Claude Code toolchain (file editing, MCP servers, tool use) for free. This is the MVP path.

2. **Direct SDK Agent Loop** - For non-Claude providers (OpenRouter, Azure OpenAI, Kilo Code, etc.). Custom agentic loop with tool definitions, calling the provider's API directly. Uses GitHub API for all file/code operations (no local checkout needed). Phase 2+ implementation.

## Webhook Events Handled

| GitHub Event | Action | Handler |
|---|---|---|
| `pull_request` | `opened`, `ready_for_review` | ReviewHandler |
| `issue_comment` | `created` (contains `@kodiai`) | MentionHandler |
| `pull_request_review_comment` | `created` (contains `@kodiai`) | MentionHandler |
| `pull_request_review` | `submitted` (contains `@kodiai`) | MentionHandler |
| `issues` | `opened` (contains `@kodiai`) | MentionHandler |

## GitHub App Permissions

```json
{
  "contents": "write",
  "issues": "write",
  "pull_requests": "write",
  "actions": "read",
  "metadata": "read",
  "checks": "read"
}
```

Subscribed events: `issue_comment`, `issues`, `pull_request`, `pull_request_review`, `pull_request_review_comment`

## Per-Repo Configuration (`.kodiai.yml`)

```yaml
# Trigger phrase (default: @kodiai)
trigger: "@kodiai"

# Auto-review on PR open
review:
  enabled: true
  on: [opened, ready_for_review]
  # paths: ["src/**"]           # Optional path filter
  # skip_authors: [dependabot]  # Optional author skip
  prompt: |
    Review this PR. Be concise. Focus only on issues.
    Check for: bugs, security, performance, logic errors.
    Use inline comments with suggestion blocks for fixes.
    If no issues: approve silently (no comment).

# @kodiai mention responses
mention:
  enabled: true
  prompt: |
    Respond to the user's request in context.
    For code reviews: only report problems, no praise.
    For questions: answer directly and helpfully.

# Permissions
permissions:
  allow_bots: false
  # allowed_users: []  # Empty = anyone with write access

# Behavioral settings
settings:
  max_turns: 25
  timeout_seconds: 300
  collapse_responses: true  # Wrap in <details> tags
  allowed_tools: []         # Additional tools to whitelist
```

Config is fetched from the repo's default branch on each event. Missing config = all defaults.

## Directory Structure

```
src/
  index.ts                      # Entry: create server, wire deps
  server/
    webhook.ts                  # Hono HTTP server, POST /webhooks/github
    health.ts                   # GET /health for Azure probes
  auth/
    github-app.ts               # GitHub App JWT auth, installation tokens
  config/
    loader.ts                   # Fetch + parse .kodiai.yml from repos
    schema.ts                   # Zod validation for config
    defaults.ts                 # Default config values + prompts
  events/
    router.ts                   # Map webhook events to handlers
    filters.ts                  # Mention detection, bot filtering, permissions
  jobs/
    queue.ts                    # In-process async queue (p-queue)
    worker.ts                   # Job execution orchestrator
    workspace.ts                # Clone repo, manage temp dirs
  handlers/
    review.ts                   # PR auto-review handler
    mention.ts                  # @kodiai mention handler
  context/
    builder.ts                  # Fetch PR/issue data, format prompts
    sanitizer.ts                # Content sanitization (port from action)
  executor/
    claude-cli.ts               # Claude Code CLI backend (via agent SDK)
    types.ts                    # Execution result types
  mcp/
    comment-server.ts           # Port: github-comment-server.ts
    inline-comment-server.ts    # Port: github-inline-comment-server.ts
    actions-server.ts           # Port: github-actions-server.ts
    file-ops-server.ts          # Port: github-file-ops-server.ts
    config.ts                   # MCP config file generation
  github/
    service.ts                  # Octokit wrapper (REST + GraphQL)
    queries.ts                  # GraphQL queries (port from action)
    types.ts                    # GitHub data types
  utils/
    retry.ts                    # Retry with backoff (port from action)
    logger.ts                   # Structured logging
Dockerfile
docker-compose.yml
package.json
tsconfig.json
```

## Key Files to Port from claude-code-action

Reference code lives in `tmp/claude-code-action/` and `tmp/claude-code-base-action/`.

| Source File | Port To | What It Does |
|---|---|---|
| `src/github/data/fetcher.ts` | `src/context/builder.ts` | GraphQL data fetching, TOCTOU protection, comment filtering |
| `src/github/data/formatter.ts` | `src/context/builder.ts` | Formats fetched data as markdown for prompt |
| `src/create-prompt/index.ts` | `src/context/builder.ts` | Full prompt generation (~860 lines) with instructions |
| `src/github/utils/sanitizer.ts` | `src/context/sanitizer.ts` | Content sanitization (tokens, invisible chars) |
| `src/github/validation/trigger.ts` | `src/events/filters.ts` | Mention detection with word boundary regex |
| `src/github/validation/actor.ts` | `src/events/filters.ts` | Human vs bot actor checking |
| `src/github/operations/git-config.ts` | `src/jobs/workspace.ts` | Git user config, remote auth, SSH signing |
| `src/github/operations/branch.ts` | `src/jobs/workspace.ts` | Branch creation, validation |
| `src/mcp/github-comment-server.ts` | `src/mcp/comment-server.ts` | Progress comment updates |
| `src/mcp/github-inline-comment-server.ts` | `src/mcp/inline-comment-server.ts` | Inline PR review comments |
| `src/mcp/github-actions-server.ts` | `src/mcp/actions-server.ts` | CI status reading |
| `src/mcp/github-file-ops-server.ts` | `src/mcp/file-ops-server.ts` | File ops via Git Data API |
| `src/mcp/install-mcp-server.ts` | `src/mcp/config.ts` | MCP config generation |
| `src/modes/tag/index.ts` | `src/handlers/mention.ts` | Tag mode preparation logic |
| `src/modes/agent/index.ts` | `src/handlers/review.ts` | Agent mode preparation logic |
| `src/utils/retry.ts` | `src/utils/retry.ts` | Retry with exponential backoff |
| `base-action/src/run-claude-sdk.ts` | `src/executor/claude-cli.ts` | Claude Agent SDK invocation |

## Job Execution Flow (Claude Code CLI Backend)

For each webhook event that passes filtering:

### 1. Clone Repository
```
git clone --depth=50 https://x-access-token:{install_token}@github.com/{owner}/{repo}.git /tmp/jobs/{job_id}
git checkout {pr_head_ref}  # or appropriate ref
```
- For fork PRs: clone the fork repo, checkout the PR branch
- Shallow clone with enough depth for diff context

### 2. Configure Git Auth
Port from `src/github/operations/git-config.ts`:
- Set git user to kodiai bot identity
- Set remote URL with installation access token
- Optional SSH signing key support

### 3. Setup MCP Servers
Port the 4 MCP servers from the current action. They run as child processes alongside Claude Code:
- **github-comment-server** - Update tracking comments with progress
- **github-inline-comment-server** - Create inline PR review comments with suggestion blocks
- **github-actions-server** - Read CI/workflow status
- **github-file-ops-server** - Create/update files via API (when commit signing enabled)

Write MCP config JSON to temp file, pass via `--mcp-config` flag.

### 4. Build Prompt
Port from `src/create-prompt/index.ts` and `src/github/data/fetcher.ts`:
- Fetch PR/issue data via GitHub GraphQL API (body, comments, reviews, diff, CI status)
- Apply TOCTOU protections (timestamp-based comment filtering)
- Sanitize content (strip invisible chars, HTML comments, token patterns)
- Format into structured prompt with instructions
- Write to temp prompt file

### 5. Invoke Claude Code
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: promptContent,
  options: {
    allowedTools: [...],
    mcpConfig: mcpConfigPath,
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
      GITHUB_TOKEN: installationToken,
      GH_TOKEN: installationToken,
    },
    cwd: cloneDir,
  },
})) {
  // Stream messages, track progress
}
```

### 6. Cleanup
- Update tracking comment with final status
- Revoke tokens if needed
- Remove temp clone directory

## Deployment (Azure)

### Docker Image
```dockerfile
FROM oven/bun:1-alpine
# Install git (for cloning repos)
RUN apk add --no-cache git openssh-client
# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash
# Copy app
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY src/ ./src/
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

### Azure Container App
- Single container instance to start
- Scale to 0 when idle (Azure Container Apps supports this)
- Environment variables for secrets: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `CLAUDE_CODE_OAUTH_TOKEN`
- Persistent volume for temp job workspaces (or ephemeral is fine)

### Required Secrets
| Secret | Description |
|---|---|
| `GITHUB_APP_ID` | The GitHub App's numeric ID |
| `GITHUB_PRIVATE_KEY` | PEM private key for JWT signing |
| `GITHUB_WEBHOOK_SECRET` | Secret for verifying webhook signatures |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Max OAuth token (default provider) |

---

## Implementation Phases

### Phase 1: Foundation
Webhook server + GitHub App auth + event routing + simple "I got your message" response.

**Tasks:**
1. Project scaffolding (Bun, TypeScript, Hono, Docker)
   - `package.json` with dependencies: `hono`, `@octokit/rest`, `@octokit/graphql`, `@octokit/auth-app`, `zod`, `p-queue`
   - `tsconfig.json` targeting Bun
   - `Dockerfile` and `docker-compose.yml`
2. `src/index.ts` - Entry point, create Hono app, wire routes
3. `src/server/webhook.ts` - POST `/webhooks/github` with raw body capture for signature verification
4. `src/server/health.ts` - GET `/health` returning 200
5. `src/auth/github-app.ts` - GitHub App JWT generation, installation token minting, webhook signature verification using `@octokit/auth-app`
6. `src/events/router.ts` - Map event type + action to handler, pass parsed payload
7. `src/events/filters.ts` - `detectMention(body, trigger)` with word boundary regex, `isBot(sender)` check
8. `src/config/schema.ts` - Zod schema for `.kodiai.yml`
9. `src/config/defaults.ts` - Default config values (review prompt, mention prompt, settings)
10. `src/config/loader.ts` - Fetch `.kodiai.yml` from repo default branch via GitHub API, parse with schema, fallback to defaults
11. `src/utils/logger.ts` - Structured JSON logger (console-based, Azure-compatible)
12. Stub handlers that log "event received" and post a simple "I got your message" comment
13. Docker build + deploy to Azure Container App
14. Register GitHub App with correct permissions/events, install on test repo

**Verification:**
- Install app on test repo -> appears in repo settings
- Create issue with `@kodiai` in body -> webhook received, logged
- Create PR -> webhook received, logged
- Health endpoint returns 200
- App posts "I got your message" comment acknowledging the event

### Phase 2: PR Auto-Review
Working auto-review on PR open using Claude Code CLI.

**Tasks:**
1. `src/jobs/queue.ts` - p-queue wrapper with per-installation concurrency limits
2. `src/jobs/workspace.ts` - Clone repo to temp dir, setup git auth (port from `git-config.ts`), cleanup
3. Port MCP servers from `tmp/claude-code-action/src/mcp/`:
   - `src/mcp/comment-server.ts` - Progress comment updates
   - `src/mcp/inline-comment-server.ts` - Inline PR review comments with suggestion blocks
   - `src/mcp/actions-server.ts` - CI/workflow status reading
4. `src/mcp/config.ts` - Generate MCP config JSON file for Claude CLI
5. `src/github/service.ts` - Octokit wrapper (REST + GraphQL) using installation tokens
6. `src/github/queries.ts` - Port GraphQL queries for PR data (diff, comments, reviews, CI status)
7. `src/github/types.ts` - TypeScript types for GitHub data structures
8. `src/context/builder.ts` - Fetch PR data, format as structured prompt (port from `fetcher.ts` + `formatter.ts` + `create-prompt/index.ts`)
9. `src/executor/claude-cli.ts` - Invoke Claude Code via `@anthropic-ai/claude-agent-sdk` `query()`, stream messages
10. `src/executor/types.ts` - Execution result types
11. `src/handlers/review.ts` - Wire it all: receive PR event -> queue job -> clone -> setup MCP -> build prompt -> run Claude -> cleanup
12. Port review prompt from `xbmc/.github/workflows/claude-code-review.yml`

**Verification:**
- Open PR on test repo -> kodiai posts inline review comments
- Open draft PR, mark ready -> review triggers
- Review includes suggestion blocks that can be committed via GitHub UI
- Clean PR -> silent approval (no comment)
- Verify fork PR triggers review correctly

### Phase 3: @kodiai Mention Handler
Full mention support matching current @claude functionality.

**Tasks:**
1. `src/handlers/mention.ts` - Handle all mention event types:
   - `issue_comment` (PR or issue context)
   - `pull_request_review_comment` (inline thread)
   - `pull_request_review` (review body)
   - `issues` opened with mention
2. Tracking comment creation + progress updates via comment MCP server
3. Port tag mode preparation from `src/modes/tag/index.ts` (branch setup, full context fetching)
4. `src/mcp/file-ops-server.ts` - Port file-ops MCP server for code modifications via Git Data API
5. Port mention prompt from `xbmc/.github/workflows/claude.yml`
6. TOCTOU protections (timestamp-based comment filtering from `fetcher.ts`)
7. Eyes emoji reaction on trigger comments
8. `src/context/sanitizer.ts` - Port content sanitization (tokens, invisible chars, HTML comments)
9. `src/utils/retry.ts` - Port retry with exponential backoff

**Verification:**
- Comment `@kodiai review this PR` -> bot reacts with eyes, posts review
- Comment `@kodiai fix this bug` -> bot creates branch, commits fix, pushes
- Comment on issue `@kodiai how does X work?` -> bot responds with explanation
- Inline review comment `@kodiai can you fix this?` -> bot replies inline with suggestion
- Bot ignores its own comments (no infinite loop)
- Non-write-access user mentions bot -> ignored or polite decline

### Phase 4: Polish + Multi-Provider Prep
Production hardening and groundwork for additional LLM providers.

**Tasks:**
1. Error handling (graceful failures, error comments on GitHub)
2. Rate limiting per installation
3. Structured logging + Azure Application Insights integration
4. Input sanitization hardening (full sanitizer.ts port)
5. Timeout enforcement per job
6. Direct SDK agent loop skeleton (for future non-Claude providers)
7. Tool definitions for SDK mode (`get_file_content`, `create_review_comment`, etc.)

**Verification:**
- Jobs that exceed timeout are killed gracefully with error comment
- Rate-limited installations get queued, not dropped
- Errors in job execution result in helpful GitHub comment, not silence
- Logs are structured JSON, queryable in Azure

---

## What Changes vs Current Action

| Aspect | Current (GitHub Action) | Kodiai (GitHub App) |
|---|---|---|
| Trigger mechanism | Workflow YAML + GitHub Actions | Webhook POST directly from GitHub |
| Repo setup | `actions/checkout` | Clone in job worker |
| GitHub auth | OIDC exchange via Anthropic API | GitHub App private key -> installation tokens |
| Configuration | Workflow YAML inputs | `.kodiai.yml` in repo |
| Fork PR support | Workaround in workflow YAML | Native (app has its own identity) |
| Per-repo setup | Copy workflow files | One-click app install |
| Compute | GitHub Actions runners | Our own server (Azure) |
| Claude invocation | Same (Agent SDK) | Same (Agent SDK) |
| MCP servers | Same | Same (ported) |

## End-to-End Smoke Test

1. Install kodiai on a fresh test repo
2. Create PR with intentional bug -> auto-review catches it with inline comment
3. Comment `@kodiai please fix this` -> bot commits fix to PR branch
4. Comment `@kodiai looks good now, approve` -> bot approves PR
5. Create issue `@kodiai what does function X do?` -> bot explains
