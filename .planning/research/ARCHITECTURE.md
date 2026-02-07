# Architecture Research

**Domain:** GitHub App webhook bot with AI code review backend
**Researched:** 2026-02-07
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
                           GitHub.com
                               |
                    Webhook POST (signed)
                               |
                               v
+----------------------------------------------------------------------+
|                        INGRESS LAYER                                  |
|  +---------------------+  +------------------+  +----------------+   |
|  | Webhook Endpoint    |  | Signature Verify |  | Health Check   |   |
|  | POST /webhooks/gh   |->| HMAC-SHA256      |  | GET /health    |   |
|  +---------------------+  +------------------+  +----------------+   |
|            |                       |                                  |
|            v                       v                                  |
|  +---------------------+  +------------------+                       |
|  | Event Router        |  | Delivery Dedup   |                       |
|  | X-GitHub-Event +    |  | X-GitHub-Delivery |                       |
|  | action dispatch     |  | (Set w/ TTL)     |                       |
|  +---------------------+  +------------------+                       |
+----------------------------------------------------------------------+
              |
              v
+----------------------------------------------------------------------+
|                        ORCHESTRATION LAYER                            |
|  +---------------------+  +------------------+  +----------------+   |
|  | Event Filters       |  | Config Loader    |  | GitHub Auth    |   |
|  | Bot check, perms,   |  | .kodiai.yml from |  | JWT -> install |   |
|  | mention detect      |  | default branch   |  | access token   |   |
|  +---------------------+  +------------------+  +----------------+   |
|            |                       |                    |             |
|            v                       v                    v             |
|  +---------------------+  +-------------------------------+          |
|  | Handler Dispatch    |  | GitHub Service (Octokit)      |          |
|  | ReviewHandler or    |  | REST + GraphQL, retry logic   |          |
|  | MentionHandler      |  +-------------------------------+          |
|  +---------------------+                                             |
|            |                                                         |
|            v                                                         |
|  +---------------------+                                             |
|  | Job Queue (p-queue) |  Per-installation concurrency limits        |
|  | In-process async    |  Future: external queue                     |
|  +---------------------+                                             |
+----------------------------------------------------------------------+
              |
              v
+----------------------------------------------------------------------+
|                        EXECUTION LAYER                                |
|  +---------------------+  +------------------+  +----------------+   |
|  | Workspace Manager   |  | Context Builder  |  | MCP Config     |   |
|  | Clone, git auth,    |  | Fetch PR/issue   |  | Generate JSON  |   |
|  | temp dir lifecycle  |  | data, sanitize,  |  | for 4 servers  |   |
|  |                     |  | build prompt     |  |                |   |
|  +---------------------+  +------------------+  +----------------+   |
|            |                       |                    |             |
|            v                       v                    v             |
|  +------------------------------------------------------------------+|
|  | Claude Code CLI (@anthropic-ai/claude-agent-sdk query())          |
|  |                                                                   |
|  | Spawns child process with:                                        |
|  | - Prompt file (instructions + PR context)                         |
|  | - MCP config (4 stdio servers as child processes)                 |
|  | - Working dir = cloned repo                                       |
|  | - Env: CLAUDE_CODE_OAUTH_TOKEN, GITHUB_TOKEN                     |
|  | - permissionMode: bypassPermissions                               |
|  |                                                                   |
|  | Returns: AsyncGenerator<SDKMessage>                               |
|  +------------------------------------------------------------------+|
|            |                                                         |
|  +---------+---------+---------+---------+                           |
|  v         v         v         v         v                           |
|  +---------+ +-------+ +------+ +-------+ +--------+                |
|  |Comment  | |Inline | |CI    | |FileOps| |Claude  |                |
|  |MCP      | |Comment| |Status| |MCP    | |Code    |                |
|  |Server   | |MCP    | |MCP   | |Server | |Tools   |                |
|  |(stdio)  | |Server | |Server| |(stdio)| |(built  |                |
|  |         | |(stdio)| |(stdio)| |       | | in)    |                |
|  +---------+ +-------+ +------+ +-------+ +--------+                |
+----------------------------------------------------------------------+
              |
              v
+----------------------------------------------------------------------+
|                        CLEANUP                                        |
|  +---------------------+  +------------------+  +----------------+   |
|  | Update tracking     |  | Remove temp dir  |  | Log result     |   |
|  | comment w/ status   |  | (cloned repo)    |  | metrics, cost  |   |
|  +---------------------+  +------------------+  +----------------+   |
+----------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Webhook Endpoint | Accept GitHub POST, capture raw body for sig verify | Hono route handler, `c.req.text()` for raw body |
| Signature Verifier | Validate `X-Hub-Signature-256` HMAC-SHA256 | `crypto.timingSafeEqual` with `crypto.createHmac('sha256', secret)` |
| Delivery Deduplicator | Prevent duplicate processing from GitHub retries | In-memory `Set<string>` with TTL eviction (LRU or Map + setTimeout) |
| Event Router | Parse `X-GitHub-Event` header + `action` field, dispatch | Switch/map on event type, route to correct handler |
| Event Filters | Bot filtering, mention detection, permission checks | Regex word-boundary trigger match, `sender.type !== 'Bot'`, write-access validation |
| Config Loader | Fetch `.kodiai.yml` from repo default branch | Octokit `repos.getContent()`, Zod schema validation, merge with defaults |
| GitHub App Auth | JWT creation, installation access token minting | `@octokit/auth-app` handles JWT lifecycle + token caching |
| GitHub Service | All GitHub API calls (REST + GraphQL) | Octokit wrapper with retry logic, shared across components |
| Handler (Review) | Orchestrate PR auto-review flow end-to-end | Receives PR event, queues job, wires workspace + context + executor |
| Handler (Mention) | Orchestrate @kodiai mention response flow | Receives comment event, queues job, detects intent (review vs. code mod vs. Q&A) |
| Job Queue | Concurrency control, per-installation throttling | `p-queue` with `concurrency` per install, prevents overload |
| Workspace Manager | Clone repo, configure git identity + auth, cleanup temp dirs | `git clone --depth=50`, set remote URL with token, `rm -rf` on completion |
| Context Builder | Fetch PR/issue data, format prompt, apply TOCTOU protections | GraphQL queries for diff/comments/reviews, timestamp-based comment filtering, content sanitization |
| MCP Config Generator | Build MCP server config JSON for Claude CLI | Assemble `mcpServers` object with server commands, args, env vars |
| Claude CLI Executor | Invoke `query()`, stream messages, handle result | `@anthropic-ai/claude-agent-sdk` `query()` with async generator consumption |
| Comment MCP Server | Create/update tracking comments showing progress | `@modelcontextprotocol/sdk` stdio server, Octokit for comment CRUD |
| Inline Comment MCP Server | Create inline PR review comments with suggestion blocks | `@modelcontextprotocol/sdk` stdio server, `pulls.createReviewComment()` |
| CI Status MCP Server | Read GitHub Actions workflow/check run status | `@modelcontextprotocol/sdk` stdio server, `actions.listWorkflowRuns()` |
| File Ops MCP Server | Create/update files via Git Data API (for signed commits) | `@modelcontextprotocol/sdk` stdio server, tree/blob/commit creation |

## Recommended Project Structure

```
src/
  index.ts                      # Entry: create Hono app, wire middleware, start server
  server/
    webhook.ts                  # POST /webhooks/github - raw body, sig verify, dispatch
    health.ts                   # GET /health - liveness probe for Azure
  auth/
    github-app.ts               # GitHub App JWT, installation tokens, sig verification
  config/
    loader.ts                   # Fetch + parse .kodiai.yml from repo default branch
    schema.ts                   # Zod schema for .kodiai.yml config
    defaults.ts                 # Default config values + review/mention prompts
  events/
    router.ts                   # Map event type + action to handler functions
    filters.ts                  # Mention detection, bot filtering, permission validation
  jobs/
    queue.ts                    # p-queue wrapper with per-installation concurrency
    worker.ts                   # Job execution orchestrator (wires workspace + executor)
    workspace.ts                # Clone, git auth, temp dir lifecycle, cleanup
  handlers/
    review.ts                   # PR auto-review handler (opened, ready_for_review)
    mention.ts                  # @kodiai mention handler (all comment event types)
  context/
    builder.ts                  # Fetch PR/issue data, format prompt, TOCTOU protections
    sanitizer.ts                # Content sanitization (tokens, invisible chars, HTML comments)
  executor/
    claude-cli.ts               # Claude Code CLI via query(), message streaming
    types.ts                    # Execution result types, message filtering
  mcp/
    comment-server.ts           # Tracking comment updates (create/update progress)
    inline-comment-server.ts    # Inline PR review comments with suggestion blocks
    actions-server.ts           # CI/workflow status reading
    file-ops-server.ts          # File CRUD via Git Data API
    config.ts                   # MCP config JSON generation
  github/
    service.ts                  # Octokit wrapper (REST + GraphQL, retry, token refresh)
    queries.ts                  # GraphQL queries for PR data (diff, comments, reviews)
    types.ts                    # GitHub API response types
  utils/
    retry.ts                    # Retry with exponential backoff
    logger.ts                   # Structured JSON logging (Azure-compatible)
    dedup.ts                    # Delivery ID deduplication with TTL
Dockerfile
docker-compose.yml
package.json
tsconfig.json
```

### Structure Rationale

- **server/:** Thin HTTP layer. Only knows about request/response. No business logic. This makes it easy to swap Hono for something else or add additional endpoints.
- **auth/:** Isolated authentication concerns. GitHub App JWT creation, token caching, and signature verification are tightly coupled and belong together.
- **config/:** Separated from event handling because config loading is a cross-cutting concern used by both handlers. Zod schema provides runtime validation and type inference.
- **events/:** Routing and filtering are pre-handler concerns. The router decides *which* handler; filters decide *whether* to handle. Separating from handlers keeps handler code focused on orchestration.
- **jobs/:** Queue management, workspace lifecycle, and job orchestration are execution infrastructure separate from the *what* (handlers) and the *how* (executor). The worker wires everything together for a single job execution.
- **handlers/:** Business logic entry points. Each handler orchestrates a complete flow: validate -> queue -> execute -> cleanup. Thin orchestrators, not monoliths.
- **context/:** Prompt construction is complex (~800 lines in reference implementation) and shared between review and mention flows. Isolating it prevents handler bloat and enables independent testing.
- **executor/:** Abstraction over the Claude Code CLI invocation. When adding a direct SDK agent loop backend later, it slots in alongside `claude-cli.ts` without touching handlers.
- **mcp/:** Each MCP server is a standalone stdio process. Keeping them in a dedicated directory with shared config generation simplifies the MCP lifecycle.
- **github/:** All GitHub API interactions centralized. Octokit wrapper with retry logic used by every component that talks to GitHub. Prevents scattered API calls.

## Architectural Patterns

### Pattern 1: Acknowledge-Then-Process (Webhook Fast-Return)

**What:** Respond 200 to GitHub within milliseconds, process the event asynchronously via the job queue.
**When to use:** Every webhook event. GitHub terminates connections after 10 seconds and marks deliveries as failed.
**Trade-offs:** Adds queue complexity but is mandatory for production. Without this, long-running AI tasks would cause GitHub to retry, creating duplicate work.

**Example:**
```typescript
// webhook.ts - respond immediately
app.post("/webhooks/github", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");

  if (!verifySignature(rawBody, signature, webhookSecret)) {
    return c.text("Invalid signature", 401);
  }

  const event = c.req.header("x-github-event");
  const deliveryId = c.req.header("x-github-delivery");
  const payload = JSON.parse(rawBody);

  // Deduplicate retries
  if (deliveryStore.has(deliveryId)) {
    return c.text("Already processed", 200);
  }
  deliveryStore.set(deliveryId);

  // Fire-and-forget into the queue
  router.dispatch(event, payload).catch((err) => {
    logger.error("Event dispatch failed", { event, deliveryId, err });
  });

  return c.text("OK", 200);
});
```

### Pattern 2: Per-Installation Job Queue

**What:** Each GitHub App installation (org/user) gets its own concurrency slot in p-queue, preventing one noisy installation from starving others.
**When to use:** Always. Without per-installation limits, a repo with rapid PR activity could monopolize all worker capacity.
**Trade-offs:** Slightly more complex than a single global queue, but essential for fair scheduling across installations. In-process p-queue is sufficient for single-instance deployment; migrate to external queue (Azure Service Bus, Redis-backed BullMQ) only when scaling to multiple instances.

**Example:**
```typescript
// queue.ts
import PQueue from "p-queue";

class JobQueueManager {
  private queues = new Map<number, PQueue>();
  private globalQueue = new PQueue({ concurrency: 4 }); // total cap

  getQueue(installationId: number): PQueue {
    if (!this.queues.has(installationId)) {
      this.queues.set(installationId, new PQueue({ concurrency: 1 }));
    }
    return this.queues.get(installationId)!;
  }

  async enqueue(installationId: number, job: () => Promise<void>): Promise<void> {
    const installQueue = this.getQueue(installationId);
    // Nest per-install queue inside global concurrency limit
    return this.globalQueue.add(() => installQueue.add(job));
  }
}
```

### Pattern 3: Ephemeral Workspace Per Job

**What:** Each job gets a fresh `git clone` in a temp directory, fully isolated from other jobs. The workspace is destroyed after the job completes (success or failure).
**When to use:** Every job execution. Shared workspaces would cause data leakage between PRs and race conditions on concurrent jobs.
**Trade-offs:** Clone overhead (~2-5s for shallow clone) is acceptable given that the AI review itself takes 30-120 seconds. Disk usage is bounded by cleanup.

**Example:**
```typescript
// workspace.ts
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function withWorkspace<T>(
  cloneUrl: string,
  ref: string,
  installToken: string,
  fn: (workDir: string) => Promise<T>,
): Promise<T> {
  const workDir = await mkdtemp(join(tmpdir(), "kodiai-"));
  try {
    // Shallow clone with auth
    const authedUrl = cloneUrl.replace("https://", `https://x-access-token:${installToken}@`);
    await exec(`git clone --depth=50 ${authedUrl} ${workDir}`);
    await exec(`git -C ${workDir} checkout ${ref}`);
    // Configure git identity for commits
    await exec(`git -C ${workDir} config user.name "kodiai[bot]"`);
    await exec(`git -C ${workDir} config user.email "kodiai[bot]@users.noreply.github.com"`);

    return await fn(workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
```

### Pattern 4: MCP Servers as Stdio Child Processes

**What:** Each MCP server runs as a separate child process communicating via stdin/stdout using JSON-RPC 2.0. Claude Code CLI manages their lifecycle.
**When to use:** For all 4 MCP servers (comment, inline comment, CI status, file ops). This is the standard MCP transport for local servers.
**Trade-offs:** Each job spawns 4+ child processes (MCP servers) plus the Claude CLI process itself. The overhead is acceptable because processes are short-lived (job duration) and the alternative (in-process `createSdkMcpServer`) has known concurrency bugs. Stdio servers are battle-tested in the reference implementation.

**Important:** MCP servers must keep `stdout` reserved for JSON-RPC protocol messages. All logging must go to `stderr`.

**Example:**
```typescript
// config.ts - MCP config generation
function buildMcpConfig(params: McpConfigParams): Record<string, McpStdioServerConfig> {
  const servers: Record<string, McpStdioServerConfig> = {};

  servers.github_comment = {
    command: "bun",
    args: ["run", resolve(__dirname, "comment-server.ts")],
    env: {
      GITHUB_TOKEN: params.installToken,
      REPO_OWNER: params.owner,
      REPO_NAME: params.repo,
      COMMENT_ID: params.trackingCommentId,
    },
  };

  if (params.isPR) {
    servers.github_inline_comment = {
      command: "bun",
      args: ["run", resolve(__dirname, "inline-comment-server.ts")],
      env: {
        GITHUB_TOKEN: params.installToken,
        REPO_OWNER: params.owner,
        REPO_NAME: params.repo,
        PR_NUMBER: String(params.prNumber),
      },
    };
  }

  return servers;
}
```

### Pattern 5: TOCTOU-Safe Context Fetching

**What:** Use the webhook payload's timestamp to filter comments fetched via GraphQL, preventing time-of-check-to-time-of-use attacks where an attacker edits content between when the webhook fires and when the bot reads it.
**When to use:** All mention handling where comment content informs the prompt sent to the AI.
**Trade-offs:** Requires extracting `created_at` from the webhook payload and passing it through the data pipeline. Small complexity cost for significant security benefit.

**Example:**
```typescript
// context/builder.ts
function filterCommentsByTimestamp(
  comments: GitHubComment[],
  triggerTimestamp: string | undefined,
): GitHubComment[] {
  if (!triggerTimestamp) return comments;

  const triggerTime = new Date(triggerTimestamp).getTime();
  return comments.filter((comment) => {
    const commentTime = new Date(comment.created_at).getTime();
    // Only include comments created at or before the trigger
    return commentTime <= triggerTime;
  });
}
```

## Data Flow

### Flow 1: PR Auto-Review

```
GitHub fires pull_request.opened webhook
    |
    v
Webhook Endpoint
    | raw body + headers
    v
Signature Verification (HMAC-SHA256)
    | verified payload
    v
Delivery Deduplication (X-GitHub-Delivery)
    | unique event
    v
Event Router (X-GitHub-Event: pull_request, action: opened)
    | dispatches to ReviewHandler
    v
Event Filters
    | - Is sender a bot? Skip if so
    | - Is PR a draft? Skip if so
    | - Does config allow this event? Check .kodiai.yml
    v
Config Loader (fetch .kodiai.yml from default branch)
    | merged config
    v
GitHub App Auth (mint installation access token)
    | token
    v
ReviewHandler.handle()
    | enqueue job
    v
Job Queue (p-queue, per-installation slot)
    | when slot available
    v
Workspace Manager
    | git clone --depth=50, checkout PR head
    v
Context Builder
    | GraphQL: fetch PR diff, body, existing comments, CI status
    | Format as structured prompt
    | Sanitize content (strip tokens, invisible chars)
    v
MCP Config Generator
    | Build JSON config for: comment-server, inline-comment-server,
    | actions-server (+ file-ops-server if needed)
    v
Claude CLI Executor (query())
    | prompt + mcpServers + allowedTools + cwd + env
    |
    | Claude reads cloned repo files via built-in tools
    | Claude posts inline comments via MCP (mcp__github_inline_comment__create_inline_comment)
    | Claude updates tracking comment via MCP (mcp__github_comment__update_comment)
    |
    v
SDKResultMessage
    | success/failure + cost + turns + duration
    v
Cleanup
    | Update tracking comment with final status
    | Remove temp workspace directory
    | Log metrics
```

### Flow 2: @kodiai Mention (Conversational)

```
GitHub fires issue_comment.created webhook (body contains @kodiai)
    |
    v
Webhook Endpoint -> Signature Verify -> Dedup -> Event Router
    | dispatches to MentionHandler
    v
Event Filters
    | - Mention detection: word-boundary regex for trigger phrase
    | - Is sender the bot itself? Skip (prevent loops)
    | - Does sender have write access? Check permissions
    v
Eyes Emoji Reaction (immediate feedback on trigger comment)
    v
Config Loader + GitHub App Auth
    v
MentionHandler.handle()
    | Create tracking comment ("Working on it...")
    | Enqueue job
    v
Job Queue (per-installation)
    | when slot available
    v
Workspace Manager (clone + checkout)
    v
Context Builder
    | Extract trigger timestamp from webhook payload (TOCTOU)
    | GraphQL: fetch issue/PR body, all comments (filtered by timestamp)
    | For PR context: fetch diff, reviews, CI status
    | Sanitize all content
    | Build prompt with conversation history
    v
MCP Config (all 4 servers, include file-ops for code modifications)
    v
Claude CLI Executor (query())
    | Claude reads context, may modify files (git add, commit, push)
    | Claude updates tracking comment with progress
    | Claude may post inline comments or responses
    v
Cleanup (update tracking comment, rm workspace, log)
```

### Key Data Flows

1. **Token flow:** App private key -> JWT -> POST /installations/{id}/access_tokens -> installation token. Tokens cached by `@octokit/auth-app`, auto-refreshed on expiry (1 hour TTL). Installation token passed to workspace (git remote auth), MCP servers (GitHub API calls), and context builder (GraphQL queries).

2. **Config flow:** Webhook payload provides `installation.id` + `repository.full_name` -> Config loader fetches `.kodiai.yml` from repo default branch -> Zod validates and merges with defaults -> Config object threaded through handler, context builder, and executor (controls prompts, max_turns, allowed_tools, etc.).

3. **Prompt flow:** Context builder fetches raw data (diff, comments, reviews) via GraphQL -> Sanitizer strips dangerous content -> Formatter structures as markdown sections -> Merged with system instructions from config -> Written to temp file -> Passed to `query()` as prompt path or string.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 installations (MVP) | Single container, in-process p-queue, in-memory delivery dedup. No database needed. This handles tens of events per hour comfortably. |
| 10-100 installations | Still single container. Monitor queue depth and job duration. Add structured logging and basic metrics (Azure Application Insights). Consider increasing container CPU/memory for concurrent clone + AI jobs. |
| 100-1K installations | Move job queue to external broker (Azure Service Bus or Redis + BullMQ). This enables multiple container instances. Add persistent delivery dedup (Redis with TTL). Add request-rate monitoring per installation. |
| 1K+ installations | Horizontal scaling with multiple worker containers. Separate webhook receiver from job workers. Consider dedicated storage for workspace clones (Azure Files or local SSD). Rate limiting at the installation and global level. |

### Scaling Priorities

1. **First bottleneck: Claude CLI cold start (~12s per invocation).** Each `query()` call spawns a new Claude Code process with ~12s overhead before the AI even starts working. For MVP with low volume, this is acceptable. If it becomes a problem, investigate the V2 SDK interface or session reuse when available. This is an upstream SDK limitation, not something Kodiai can optimize around.

2. **Second bottleneck: Concurrent workspace clones.** Each job clones a repo to disk. With `concurrency: 4` on the global queue, this means up to 4 concurrent clones. Monitor disk I/O and temp directory size. Shallow clones (`--depth=50`) keep this manageable.

3. **Third bottleneck: GitHub API rate limits.** Installation tokens get 5,000 requests/hour. GraphQL queries are efficient (one call fetches PR + comments + reviews), but heavy usage could approach limits. The Octokit retry wrapper with exponential backoff handles transient 403s. Monitor `X-RateLimit-Remaining` headers.

## Anti-Patterns

### Anti-Pattern 1: Synchronous Webhook Processing

**What people do:** Process the entire AI review in the webhook handler before returning 200.
**Why it's wrong:** GitHub terminates webhook connections after 10 seconds. An AI review takes 30-120+ seconds. GitHub will retry the webhook, causing duplicate processing. The retry storm compounds the problem.
**Do this instead:** Return 200 immediately after signature verification and delivery dedup. Enqueue the job asynchronously. Use the Acknowledge-Then-Process pattern.

### Anti-Pattern 2: Shared Mutable Workspace

**What people do:** Clone the repo once and reuse the workspace across multiple jobs, or use a persistent checkout.
**Why it's wrong:** Concurrent jobs on different PRs would conflict (different branches, dirty working trees). Even sequential jobs risk stale state from previous runs. Claude Code modifies files during execution.
**Do this instead:** Ephemeral workspace per job. Clone fresh, use, destroy. The 2-5s clone overhead is negligible compared to the 30-120s AI execution time.

### Anti-Pattern 3: Logging to stdout in MCP Servers

**What people do:** Use `console.log()` in MCP stdio servers for debugging.
**Why it's wrong:** The stdio transport uses stdout for JSON-RPC protocol messages. Any stray text on stdout corrupts the protocol stream and causes the MCP client (Claude CLI) to fail with parse errors.
**Do this instead:** Use `console.error()` (stderr) for all logging in MCP servers. Or use a dedicated logging sink. Keep stdout reserved exclusively for JSON-RPC messages.

### Anti-Pattern 4: Trusting Webhook Body Without TOCTOU Protection

**What people do:** Fetch the latest issue/PR body and comments via API, assuming they match what triggered the webhook.
**Why it's wrong:** An attacker can edit the issue body or a comment between the webhook firing and the bot reading the content. The bot then processes attacker-controlled content that differs from what triggered the event. This is a real TOCTOU (time-of-check-to-time-of-use) vulnerability.
**Do this instead:** Extract the trigger timestamp from the webhook payload. Use it to filter comments (only include those created at or before the trigger). Prefer the body from the webhook payload over re-fetching when possible.

### Anti-Pattern 5: Single Global Queue Without Installation Isolation

**What people do:** Use one p-queue with a fixed concurrency limit, processing jobs FIFO regardless of which installation they belong to.
**Why it's wrong:** A single busy repo (e.g., a monorepo with 20 PRs opened simultaneously) monopolizes all concurrency slots, starving other installations. Users on other repos experience unbounded delays.
**Do this instead:** Per-installation concurrency limits nested inside a global concurrency cap. Each installation gets a fair share of capacity.

### Anti-Pattern 6: Not Checking For Bot's Own Comments

**What people do:** Process all `issue_comment.created` events without checking if the comment author is the bot itself.
**Why it's wrong:** When the bot posts a comment (e.g., a tracking comment or review response), GitHub fires an `issue_comment.created` webhook for that comment. If the comment contains the trigger phrase (which it might, when quoting the user), the bot processes its own comment, posts another comment, which triggers another webhook, creating an infinite loop.
**Do this instead:** Check `payload.sender.type === "Bot"` or compare `payload.sender.id` to the bot's own app ID. Filter these out before any processing.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| GitHub API (REST) | `@octokit/rest` with `@octokit/auth-app` | Installation tokens auto-refreshed. Retry with exponential backoff on 5xx and 403 rate limits. |
| GitHub API (GraphQL) | `@octokit/graphql` with same auth | Single query fetches PR + diff + comments + reviews. More efficient than multiple REST calls. |
| Claude Code CLI | `@anthropic-ai/claude-agent-sdk` `query()` | Spawns child process. ~12s cold start overhead. OAuth token via env var. |
| MCP Servers (4x) | `@modelcontextprotocol/sdk` stdio transport | Spawned as child processes by Claude CLI. Communicate via stdin/stdout JSON-RPC. |
| Azure Container Apps | Docker container deployment | Single container, scale-to-zero capable. Health endpoint at `/health`. |
| Azure Application Insights | Structured JSON logging | Optional. Logs via stdout in JSON format, ingested by Azure. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Webhook Endpoint <-> Event Router | Direct function call (same process) | Router receives parsed payload + event type |
| Event Router <-> Handlers | Direct function call | Router calls `handler.handle(event, config, auth)` |
| Handlers <-> Job Queue | `queue.enqueue(installationId, jobFn)` | Handler creates closure, queue manages concurrency |
| Job Worker <-> Workspace | `withWorkspace(url, ref, token, fn)` | Workspace provides clean dir, worker uses it |
| Job Worker <-> Context Builder | `buildContext(octokit, prData, config)` | Returns structured prompt string |
| Job Worker <-> Executor | `executor.run(prompt, mcpConfig, workDir, env)` | Returns `AsyncGenerator<SDKMessage>` |
| MCP Servers <-> GitHub API | Octokit REST calls from within each server process | Each server gets its own Octokit instance with the installation token |
| MCP Servers <-> Claude CLI | Stdio JSON-RPC (MCP protocol) | Claude CLI is the MCP client; servers are MCP servers |

## Build Order (Dependency Chain)

The architecture has clear dependency layers that dictate build order:

```
Phase 1: Foundation (no deps)
  auth/github-app.ts          # Can test independently with GitHub App credentials
  server/webhook.ts           # Depends on auth (signature verify)
  server/health.ts            # No deps
  events/router.ts            # Depends on webhook (receives events)
  events/filters.ts           # Pure functions, no deps
  config/schema.ts            # Pure Zod schema, no deps
  config/defaults.ts          # Static data, no deps
  config/loader.ts            # Depends on auth (needs token to fetch from repo)
  utils/logger.ts             # No deps
  utils/dedup.ts              # No deps
  github/types.ts             # No deps (type definitions)

Phase 2: GitHub Service + PR Review (depends on Phase 1)
  github/service.ts           # Depends on auth (installation tokens)
  github/queries.ts           # Depends on service
  context/sanitizer.ts        # Pure functions, no deps (but needed by builder)
  context/builder.ts          # Depends on github/service, sanitizer
  jobs/queue.ts               # No deps (p-queue wrapper)
  jobs/workspace.ts           # Depends on auth (token for git clone)
  mcp/comment-server.ts       # Standalone stdio process
  mcp/inline-comment-server.ts # Standalone stdio process
  mcp/actions-server.ts       # Standalone stdio process
  mcp/config.ts               # Depends on knowing MCP server paths
  executor/types.ts           # No deps
  executor/claude-cli.ts      # Depends on agent SDK
  jobs/worker.ts              # Depends on workspace, context, executor, mcp/config
  handlers/review.ts          # Depends on worker, queue, config, filters

Phase 3: Mention Handling (depends on Phase 2)
  mcp/file-ops-server.ts      # Standalone stdio process
  handlers/mention.ts         # Depends on worker, queue, config, filters
                              # (adds TOCTOU, eyes reaction, code modification support)
  context/builder.ts          # Extended for mention context (conversation history)
  utils/retry.ts              # Used across github service calls

Phase 4: Hardening (depends on Phase 3)
  Error handling & graceful failures
  Rate limiting per installation
  Timeout enforcement per job
  Structured logging / monitoring
  Input sanitization hardening
```

**Build order rationale:**
- Phase 1 establishes the trust boundary (auth + webhook verification) and the event pipeline. You can deploy this and verify webhooks arrive correctly.
- Phase 2 adds the core value: PR auto-review. This is the most complex phase but has the highest payoff. All infrastructure (queue, workspace, executor, MCP) is built here because review needs it all.
- Phase 3 adds mention handling, which reuses almost everything from Phase 2 but adds conversation context, TOCTOU protections, and code modification support.
- Phase 4 is hardening that makes the system production-ready but does not add new features.

## Sources

- [GitHub Webhooks Best Practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) - Official GitHub docs on response time (10s), async processing, idempotency (HIGH confidence)
- [Validating Webhook Deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) - HMAC-SHA256 signature verification (HIGH confidence)
- [MCP Architecture Overview](https://modelcontextprotocol.io/docs/learn/architecture) - Official MCP spec: host/client/server, stdio/HTTP transports, JSON-RPC 2.0 (HIGH confidence)
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) - `query()` API, message types, MCP config, permission modes (HIGH confidence)
- [Claude Agent SDK MCP Integration](https://platform.claude.com/docs/en/agent-sdk/mcp) - stdio/HTTP/SDK MCP server configuration with `query()` (HIGH confidence)
- [@octokit/auth-app](https://github.com/octokit/auth-app.js/) - GitHub App JWT auth, installation token creation and caching (HIGH confidence)
- [p-queue](https://github.com/sindresorhus/p-queue) - Promise queue with concurrency control (HIGH confidence)
- [Claude Agent SDK ~12s cold start](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34) - Performance issue: each `query()` call has ~12s overhead (HIGH confidence - verified via issue tracker)
- [Claude Agent SDK in-process MCP concurrency bug](https://github.com/anthropics/claude-agent-sdk-typescript/issues/41) - Stream closed errors with concurrent `createSdkMcpServer` tool calls (MEDIUM confidence - may be fixed in newer versions)
- [Hono Stripe Webhook Example](https://hono.dev/examples/stripe-webhook) - Raw body access via `c.req.text()` for signature verification (HIGH confidence)
- [GitHub App Authentication Best Practices](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) - Installation token generation flow (HIGH confidence)
- Reference implementation: `tmp/claude-code-action/` and `tmp/claude-code-base-action/` - Battle-tested patterns for MCP servers, prompt construction, context fetching, sanitization, and Claude SDK invocation (HIGH confidence - actual working code)

---
*Architecture research for: GitHub App webhook bot with AI code review backend*
*Researched: 2026-02-07*
