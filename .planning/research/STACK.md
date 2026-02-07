# Stack Research

**Domain:** GitHub App webhook bot with AI code review (Claude Code CLI backend)
**Researched:** 2026-02-07
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Bun | ^1.3.7 | JavaScript runtime | Pre-selected constraint. Fastest JS runtime, native TypeScript, built-in test runner. Reference codebase (`claude-code-action`) already uses Bun. Docker image: `oven/bun:1-alpine`. |
| Hono | ^4.11.8 | HTTP framework | Pre-selected constraint. Built on Web Standards `fetch` API, works natively with Bun (no adapter needed). Ultrafast, tiny bundle. `export default app` pattern integrates directly with `Bun.serve()`. Has built-in JWT helper, testing helper (`testClient`), and middleware system. |
| TypeScript | ^5.8.3 | Type safety | Pre-selected constraint. Use Bun's bundler mode (`moduleResolution: "bundler"`, `noEmit: true`, `verbatimModuleSyntax: true`). Reference codebase uses strict config with `noUncheckedIndexedAccess`. |
| @anthropic-ai/claude-agent-sdk | ^0.2.37 | AI agent execution | Pre-selected constraint. The `query()` function streams `SDKMessage` events. Supports `mcpServers` config (stdio, SSE, HTTP, in-process SDK servers), `allowedTools`, `permissionMode`, `systemPrompt` presets, `cwd`, custom `env`. Returns `SDKResultMessage` with `conclusion: "success" | "failure"`. This is the core execution engine. |

**Confidence: HIGH** -- Versions verified against npm registry and official docs (2026-02-07).

### GitHub Integration

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| @octokit/auth-app | ^8.1.2 | GitHub App authentication | `createAppAuth()` handles JWT generation from `appId` + `privateKey`, installation token minting with automatic caching (up to 15K tokens), auto-refresh on expiry. Replaces the action's OIDC token exchange entirely. Use `auth({ type: "installation", installationId })` per webhook event. |
| @octokit/rest | ^22.0.1 | GitHub REST API client | Typed REST client. Pair with `createAppAuth` as `authStrategy`. Reference codebase uses `^21.1.1`; v22 is current stable. |
| @octokit/graphql | ^9.0.3 | GitHub GraphQL API client | PR data fetching (diff, comments, reviews, CI status) is far more efficient via GraphQL -- single request vs many REST calls. Reference codebase uses `^8.2.2`; v9 is current. |
| @octokit/webhooks-methods | ^5.0.0 | Webhook signature verification | Lightweight: just `verify(secret, payload, signature)` returning boolean. Does NOT pull in the full `@octokit/webhooks` event handler system. Use this with a custom Hono middleware that reads raw body via `c.req.text()`, checks `X-Hub-Signature-256` header. |
| @octokit/webhooks-types | ^7.6.1 | TypeScript types for webhook payloads | Provides `PullRequestEvent`, `IssueCommentEvent`, etc. Reference codebase uses this exact package. Requires `strictNullChecks: true` in tsconfig (which we already have via `strict: true`). |

**Confidence: HIGH** -- All packages verified on npm. `@octokit/auth-app` API confirmed via official GitHub README.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | ^1.26.0 | MCP server implementation | For porting the 4 MCP servers from the reference codebase (comment, inline-comment, actions, file-ops). These run as stdio child processes alongside Claude Code. The SDK provides `Server` class, `CallToolResult` type. Reference uses `^1.11.0`; v1.26.0 is current. |
| zod | ^3.24.4 | Schema validation | Validate `.kodiai.yml` config, webhook payloads, environment variables. Stay on Zod 3.x -- Zod 4.x (v4.3.6) has breaking import changes (`zod/v4`). The Claude Agent SDK `tool()` function uses Zod schemas for MCP tool input definitions, so Zod is already a transitive dependency. |
| p-queue | ^8.1.0 | In-process job queue | Concurrency-limited async queue for job processing. Pure ESM, no Redis required. Set `concurrency: 2-4` per container to limit parallel Claude Code invocations (each is memory-heavy). Per-installation rate limiting via separate queue instances or priority. |
| shell-quote | ^1.8.3 | Shell argument parsing | For safely constructing CLI arguments. Reference codebase uses this for parsing `claudeArgs` strings. |

**Confidence: HIGH** -- Zod version pinning rationale verified (Zod 4.x is a separate import path). p-queue ESM-only confirmed.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| bun test | Test runner | Built into Bun runtime. Vitest-compatible API (`describe`, `it`, `expect`). Use Hono's `testClient()` helper for route testing. Known issue: `testClient` headers may not pass correctly in some Bun versions (GitHub issue #4065). Workaround: use `app.request()` directly for header-sensitive tests. |
| smee-client | ^4.3.1 | Local webhook proxy | Proxies GitHub webhook payloads to localhost via Server-Sent Events. Essential for development -- no need for ngrok or public tunnels. Run: `npx smee -u https://smee.io/YOUR_CHANNEL -t http://localhost:3000/webhooks/github`. Dev-only dependency. |
| prettier | ^3.5.3 | Code formatting | Reference codebase uses Prettier. Consistent with ecosystem conventions. |
| @types/bun | ^1.2.11 | Bun type definitions | TypeScript types for Bun-specific APIs (`Bun.serve`, `Bun.env`, etc.). |

**Confidence: HIGH** -- smee-client verified as standard GitHub App dev tool. testClient issue verified on GitHub.

### Infrastructure

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Docker (oven/bun:1-alpine) | latest 1.x tag | Container base image | Alpine variant is smallest (~130MB vs ~300MB for debian). Must install `git` and `openssh-client` via `apk add` for repo cloning. Install Claude Code CLI in build step (`curl -fsSL https://claude.ai/install.sh \| bash`). |
| Azure Container Apps | N/A | Deployment target | Pre-selected constraint. Supports scale-to-zero, HTTP ingress, environment variable secrets, container health probes. Single replica to start, scale based on HTTP request count. |

**Confidence: MEDIUM** -- Docker image variants confirmed on Docker Hub. Azure Container Apps is a constraint, not a recommendation. Bun + Alpine + Claude Code CLI combination needs validation in actual build (Claude CLI installer may assume debian packages).

## Architecture Decisions

### Why @octokit/webhooks-methods Instead of @octokit/webhooks

The full `@octokit/webhooks` package (v14.2.0) includes an event handler system with `createNodeMiddleware()` for Express/Node.js HTTP servers. This is unnecessary with Hono because:

1. Hono has its own middleware and routing system
2. `createNodeMiddleware()` creates a Node.js-specific handler incompatible with Bun's Web Standards fetch API
3. We only need signature verification, not the event dispatch system
4. Our event routing is custom (webhook -> event router -> handler -> queue -> worker)

Use `@octokit/webhooks-methods` for just `verify()` + `@octokit/webhooks-types` for TypeScript types. This is lighter and framework-agnostic.

### Why @octokit/auth-app Instead of Manual JWT

The reference codebase uses manual OIDC token exchange via Anthropic's API (because it runs inside GitHub Actions). As a standalone GitHub App, we hold the private key and must:

1. Generate JWTs ourselves (RS256, 10-minute expiry)
2. Exchange JWTs for installation access tokens (1-hour expiry)
3. Cache and refresh tokens

`@octokit/auth-app` handles all three with built-in caching (15K tokens), auto-refresh, and typed API. Rolling your own JWT signing with `jsonwebtoken` is error-prone (clock skew, expiry handling, cache invalidation).

### Why Zod 3.x Not 4.x

Zod 4.x (released as v4.3.6) has a different import path (`import { z } from "zod/v4"`) and API changes. The Claude Agent SDK's `tool()` function takes `ZodRawShape` from Zod 3.x. Mixing Zod versions will cause type incompatibilities in MCP tool definitions. Stay on 3.x until the Agent SDK explicitly supports Zod 4.

### Why p-queue Not BullMQ/Redis

Each Claude Code invocation is a heavyweight process (clones a repo, spawns CLI, runs for 30-300 seconds). The bottleneck is not queue throughput but parallel execution capacity. p-queue provides:

- In-process concurrency limiting (no external dependencies)
- Per-queue isolation (separate queues per installation for fairness)
- Priority support (review jobs vs mention jobs)
- No Redis infrastructure to manage

If the system needs horizontal scaling (multiple container replicas), migrate to Azure Service Bus or BullMQ. But for a single-container MVP, p-queue is the right choice.

### Why No Pino Logger

The reference codebase uses `console.log` with structured data. For Azure Container Apps, `console.log(JSON.stringify({...}))` is sufficient -- Azure captures stdout as structured logs. Pino adds complexity (worker threads, transport config, `bun-plugin-pino` needed for bundling). Use a thin wrapper around `console.log` that adds timestamp, level, and correlation ID. Add Pino later only if log volume or performance demands it.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| @octokit/webhooks-methods | @octokit/webhooks (full) | If you want built-in event type dispatch with `.on("pull_request.opened", handler)` pattern. But duplicates Hono's routing. |
| @octokit/auth-app | Manual JWT + jsonwebtoken | If you need custom token exchange logic (e.g., multi-tenant with different private keys per tenant). auth-app handles this via constructor options. |
| p-queue | BullMQ + Redis | When running multiple container replicas that need shared job state, dead-letter queues, or job persistence across restarts. Phase 4+ concern. |
| console.log wrapper | Pino | When log volume exceeds what console-based logging handles efficiently, or when you need log levels, child loggers, and serializers. |
| Zod 3.x | Zod 4.x | When @anthropic-ai/claude-agent-sdk updates its `tool()` function to accept Zod 4 schemas. Monitor their changelog. |
| Bun built-in test | Vitest | If you need more advanced test features (coverage UI, browser testing, mocking plugins). Bun test is sufficient for unit + integration tests. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Probot framework | Opinionated framework designed for simpler bots. Bundles its own server (Express), auth, and event system. Conflicts with Hono, adds unnecessary abstraction over Octokit. | @octokit/auth-app + @octokit/rest + Hono directly |
| Express / Fastify | Node.js frameworks. Hono on Bun is faster, smaller, and uses Web Standards. No adapter needed. | Hono |
| jsonwebtoken (manual) | Error-prone for GitHub App auth (clock skew, token caching, expiry). | @octokit/auth-app |
| @actions/core / @actions/github | GitHub Actions-specific packages. These read from `process.env.GITHUB_*` variables set by Actions runners. Won't work in a standalone server. | @octokit/rest + @octokit/graphql |
| node-fetch | Bun has native `fetch()` built in (Web Standards). node-fetch is a polyfill for Node.js. Reference codebase includes it but we don't need it. | Built-in `fetch()` |
| dotenv | Bun has built-in `.env` file loading. No need for dotenv package. | `Bun.env` / `process.env` (auto-loaded) |
| nodemon | Bun has built-in hot reload with `--hot` flag. | `bun run --hot src/index.ts` |
| Jest | Bun has a built-in test runner compatible with Jest/Vitest API. | `bun test` |
| Zod 4.x | Import path change (`zod/v4`), incompatible with Claude Agent SDK `tool()` function which uses Zod 3 `ZodRawShape`. | Zod ^3.24.4 |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| @anthropic-ai/claude-agent-sdk@^0.2.37 | zod@^3.24.4 | SDK's `tool()` function uses `ZodRawShape` from Zod 3. Do NOT use Zod 4.x. |
| @anthropic-ai/claude-agent-sdk@^0.2.37 | @modelcontextprotocol/sdk@^1.26.0 | SDK accepts MCP servers via `mcpServers` option. MCP SDK provides `McpServer` class for in-process servers (`type: "sdk"`). |
| @octokit/rest@^22.0.1 | @octokit/auth-app@^8.1.2 | Pass `createAppAuth` as `authStrategy` to Octokit constructor. Tokens auto-refresh. |
| @octokit/graphql@^9.0.3 | @octokit/auth-app@^8.1.2 | Create graphql client with `auth.hook` for automatic token injection. |
| hono@^4.11.8 | Bun@^1.3.7 | Native support. `export default app` works directly with `Bun.serve()`. No adapter package needed. |
| p-queue@^8.1.0 | Bun@^1.3.7 | Pure ESM. Works with Bun's ESM-native module system. |
| @types/bun@^1.2.11 | TypeScript@^5.8.3 | Bun type definitions for current TypeScript. |

## Installation

```bash
# Core dependencies
bun add hono @octokit/rest @octokit/graphql @octokit/auth-app @octokit/webhooks-methods @octokit/webhooks-types @anthropic-ai/claude-agent-sdk @modelcontextprotocol/sdk zod@3 p-queue shell-quote

# Dev dependencies
bun add -d @types/bun @types/shell-quote typescript prettier smee-client
```

## Stack Patterns by Variant

**If running behind Azure Front Door or reverse proxy:**
- Trust `X-Forwarded-For` headers in Hono (set `app = new Hono({ getPath: ... })` or use proxy middleware)
- Webhook signature verification uses raw body, unaffected by proxying

**If adding horizontal scaling (multiple replicas):**
- Replace p-queue with Azure Service Bus or BullMQ + Redis
- Add Azure Cache for Redis for token caching (currently in-memory via @octokit/auth-app)
- Add health check that includes queue depth

**If adding non-Claude LLM providers (Phase 4+):**
- Add `@anthropic-ai/sdk` or provider-specific SDK
- Custom agentic loop with tool definitions (no Claude Code CLI)
- GitHub API for all file operations (no local checkout needed)

## Sources

- [Hono official docs - Bun getting started](https://hono.dev/docs/getting-started/bun) -- Server entry point pattern, middleware system, testing helper (HIGH confidence)
- [Hono npm](https://www.npmjs.com/package/hono) -- v4.11.8 verified (HIGH confidence)
- [Bun official site](https://bun.com/) -- v1.3.7 verified (HIGH confidence)
- [@octokit/auth-app README](https://github.com/octokit/auth-app.js/blob/main/README.md) -- Full API reference, `createAppAuth()` params, token caching behavior (HIGH confidence)
- [@octokit/auth-app npm](https://www.npmjs.com/package/@octokit/auth-app) -- v8.1.2 verified (HIGH confidence)
- [@octokit/rest npm](https://www.npmjs.com/package/@octokit/rest) -- v22.0.1 verified (HIGH confidence)
- [@octokit/graphql npm](https://www.npmjs.com/package/@octokit/graphql) -- v9.0.3 verified (HIGH confidence)
- [@octokit/webhooks-methods npm](https://www.npmjs.com/package/@octokit/webhooks-methods) -- v5.0.0, `verify()` and `verifyWithFallback()` API confirmed (HIGH confidence)
- [@octokit/webhooks-types npm](https://www.npmjs.com/package/@octokit/webhooks-types) -- v7.6.1 verified (HIGH confidence)
- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Full `Options` type, `query()` API, `McpServerConfig`, message types, `tool()` function (HIGH confidence)
- [Claude Agent SDK quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart) -- Installation, basic usage, permission modes (HIGH confidence)
- [@anthropic-ai/claude-agent-sdk npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) -- v0.2.37 verified (HIGH confidence)
- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) -- v1.26.0 verified (HIGH confidence)
- [p-queue npm](https://www.npmjs.com/package/p-queue) -- v8.1.0+, ESM-only confirmed (HIGH confidence)
- [zod npm](https://www.npmjs.com/package/zod) -- v3.24.4 (3.x), v4.3.6 (4.x) coexistence confirmed (HIGH confidence)
- [smee-client npm](https://www.npmjs.com/package/smee-client) -- v4.3.1 verified (HIGH confidence)
- [Docker Hub oven/bun](https://hub.docker.com/r/oven/bun) -- Alpine/slim variants confirmed (HIGH confidence)
- [Azure Container Apps best practices](https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-container-apps) -- Deployment patterns, scaling, security (MEDIUM confidence)
- Reference codebase: `tmp/claude-code-action/` -- package.json, source code, MCP servers, SDK usage patterns (HIGH confidence, direct code review)

---
*Stack research for: Kodiai GitHub App webhook bot*
*Researched: 2026-02-07*
