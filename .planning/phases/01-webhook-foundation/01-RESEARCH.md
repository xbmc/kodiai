# Phase 1: Webhook Foundation - Research

**Researched:** 2026-02-07
**Domain:** GitHub webhook server on Bun (HTTP, signature verification, GitHub App auth, event routing)
**Confidence:** HIGH

## Summary

This phase builds a Bun-based HTTP server that receives GitHub webhook events, verifies their HMAC-SHA256 signatures, authenticates as a GitHub App to obtain installation tokens, and routes events to registered handlers -- all while filtering bot-generated noise and processing asynchronously to avoid GitHub's 10-second webhook timeout.

The ecosystem is mature and well-documented. **Hono** is the recommended HTTP framework for Bun (cross-runtime, lightweight, Web Standards-based). **@octokit/webhooks-methods** provides standalone signature verification without the overhead of the full @octokit/webhooks event system (we build our own handler registry per the context decisions). **@octokit/auth-app** handles JWT generation and installation token caching with built-in TTL management. **pino** is the standard structured JSON logger for Node/Bun. All libraries have been verified to work on Bun runtime.

**Primary recommendation:** Use Hono + @octokit/webhooks-methods (verify only) + @octokit/auth-app + pino. Build a custom event handler registry (Map of event.action keys to handler arrays) rather than using @octokit/webhooks' event emitter, because the context decisions require isolated handler errors and configurable bot filtering that the built-in system does not support.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Server & framework:**
- Endpoints: `/webhooks/github`, `/health` (liveness), and `/readiness` (checks GitHub API connectivity)
- Logging: structured JSON to stdout (e.g., pino or similar). No pretty-print mode -- JSON always.
- Fail fast on startup if required config is missing (app ID, private key, webhook secret)

**Webhook processing model:**
- Acknowledge webhooks immediately (return 200), process asynchronously
- Deduplicate redeliveries using `X-GitHub-Delivery` header -- track delivery IDs to skip duplicates
- Log signature verification failures as warning/error severity
- Accept all GitHub event types -- silently drop unhandled event types with no error

**Event routing design:**
- Explicit handler registry -- central map of event type + action to handler function(s)
- Multiple handlers per event type supported
- Handler errors are isolated -- one handler's failure doesn't affect other handlers for the same event
- Bot filtering: filter all bot accounts by default, with a configurable allow-list for specific bots
- The app's own account is always filtered (not configurable)

**Auth token management:**
- Cache installation access tokens in memory with TTL-based refresh before expiry (~1 hour tokens)
- Token cache keyed by installation ID -- multi-installation support from day one
- Private key loading supports both: inline PEM in environment variable OR file path from env var
- All required secrets validated on startup -- crash immediately if anything is missing

### Claude's Discretion

- HTTP framework selection (Hono, Elysia, or Bun.serve)
- Route file organization
- Async processing pattern (in-memory queue vs fire-and-forget vs other)
- Delivery ID deduplication storage strategy (in-memory map, LRU cache, etc.)
- Exact structured logging library choice

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope.

</user_constraints>

## Discretionary Recommendations

These are recommendations for areas marked as Claude's discretion.

### HTTP Framework: Hono

**Recommendation: Use Hono v4.x** (currently 4.11.8)

| Candidate | Pros | Cons | Verdict |
|-----------|------|------|---------|
| Hono | Cross-runtime (Bun/Node/CF Workers), Web Standards, lightweight (~14kB), well-documented webhook patterns (Stripe example), `app.route()` for modular organization, `c.req.text()` for raw body access | No Bun-specific optimizations | **Use this** |
| Elysia | Bun-optimized, Eden type safety | Bun-only lock-in, Eden is client-side feature (irrelevant for webhook server), more complex lifecycle | Skip |
| Raw Bun.serve | Zero dependencies, fastest possible | No middleware, no routing, no error handling -- hand-roll everything | Skip |

**Rationale:** Hono gives us the Stripe webhook verification pattern (raw body via `c.req.text()`, header access, structured error responses), modular routing with `app.route()`, centralized error handling via `app.onError()`, and future portability if we ever move off Bun. Elysia's advantages (Eden type safety) are irrelevant for a webhook receiver with no browser client. Raw Bun.serve means building middleware infrastructure from scratch.

### Route File Organization: By Concern

**Recommendation: Split into separate route modules**, mounted via `app.route()`.

With only 3 endpoints (`/webhooks/github`, `/health`, `/readiness`), a single file would technically suffice. However, the webhook route has significant middleware (signature verification, body parsing, async dispatch) while health/readiness are trivial. Separate files by concern keeps each focused.

```
src/
  routes/
    webhooks.ts     # POST /webhooks/github - signature verify, dispatch
    health.ts       # GET /health, GET /readiness
```

### Async Processing Pattern: Promise-Based Fire-and-Fork

**Recommendation: Use `Promise.resolve().then(() => processEvent(...))` pattern** -- NOT `await`, NOT a queue library.

For Phase 1, the processing is lightweight (route to handlers, run them). A formal queue (p-queue) is planned for Phase 2 when job execution (clone, run Claude) requires concurrency control. In Phase 1, fire off the async processing in a detached promise, catch and log errors, return 200 immediately.

```typescript
// Acknowledge immediately, process in background
const processing = processEvent(event).catch(err => logger.error({ err }, "Event processing failed"));
// Don't await -- return 200 to GitHub within milliseconds
return c.text("", 200);
```

This avoids importing p-queue prematurely. Phase 2 wraps this in a proper queue.

### Delivery ID Deduplication: Map with Size Cap

**Recommendation: Use a plain `Map<string, number>` with periodic cleanup**, not an LRU library.

GitHub redeliveries use the same `X-GitHub-Delivery` UUID. Store delivery IDs with timestamp values. Periodically (every N inserts) evict entries older than 24 hours. A Map is simpler than adding a dependency, and 24 hours of delivery IDs at even high webhook volume is well under 100K entries (trivial memory).

```typescript
const processedDeliveries = new Map<string, number>();
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function isDuplicate(deliveryId: string): boolean {
  if (processedDeliveries.has(deliveryId)) return true;
  processedDeliveries.set(deliveryId, Date.now());
  // Periodic cleanup every 1000 inserts
  if (processedDeliveries.size % 1000 === 0) {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [id, ts] of processedDeliveries) {
      if (ts < cutoff) processedDeliveries.delete(id);
    }
  }
  return false;
}
```

### Structured Logging: pino

**Recommendation: Use pino v10.x** (currently 10.2.0+)

pino outputs structured JSON by default (no configuration needed for JSON mode), is the fastest Node.js logger, and works with Bun. The `bun-plugin-pino` package may be needed for bundled deployments but is not required when running with `bun run` directly.

**Note:** Do NOT use pino-pretty or any transport -- the user decision specifies JSON always, stdout only.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | ^4.11 | HTTP framework | Web Standards, cross-runtime, lightweight, excellent middleware/routing |
| @octokit/auth-app | ^8.1 | GitHub App JWT + installation tokens | Official Octokit auth strategy, built-in token caching (15K tokens) |
| @octokit/webhooks-methods | ^6.0 | Webhook signature verification | Standalone verify(), HMAC-SHA256, lightweight (no event system overhead) |
| @octokit/rest | ^22.0 | GitHub REST API client | Official, typed, used with auth-app for API calls |
| pino | ^10.2 | Structured JSON logging | Fastest Node/Bun logger, JSON by default, no config needed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @octokit/webhooks-types | ^7.6 | TypeScript types for webhook payloads | Type-safe event handler signatures |
| zod | ^3.x | Schema validation | Config validation, env var validation at startup |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @octokit/webhooks-methods | @octokit/webhooks (full) | Full package adds event emitter we don't want (we build our own registry) |
| pino | console.log + JSON.stringify | Loses child loggers, log levels, request ID correlation |
| Hono | Elysia | Elysia's Eden type safety irrelevant for webhook-only server |
| Hono | Raw Bun.serve | Would need to hand-roll routing, middleware, error handling |

**Installation:**

```bash
bun add hono @octokit/auth-app @octokit/webhooks-methods @octokit/rest pino zod
bun add -d @octokit/webhooks-types @types/bun
```

## Architecture Patterns

### Recommended Project Structure

```
src/
  index.ts              # Entry: validate config, create app, start server
  config.ts             # Env var loading + Zod validation, fail-fast
  routes/
    webhooks.ts         # POST /webhooks/github route + middleware
    health.ts           # GET /health, GET /readiness routes
  webhook/
    verify.ts           # HMAC-SHA256 signature verification
    dedup.ts            # Delivery ID deduplication
    router.ts           # Event handler registry (Map-based)
    filters.ts          # Bot filtering, self-event filtering
    types.ts            # Event handler types, registry types
  auth/
    github-app.ts       # JWT generation, installation token management
  lib/
    logger.ts           # pino logger factory, child logger creation
```

### Pattern 1: Acknowledge-Then-Process Webhook Handler

**What:** Return 200 immediately, process in detached promise.
**When to use:** Every webhook endpoint (GitHub's 10-second timeout).

```typescript
// Source: GitHub docs + Hono Stripe webhook example
app.post("/webhooks/github", async (c) => {
  const signature = c.req.header("x-hub-signature-256");
  const deliveryId = c.req.header("x-github-delivery");
  const eventName = c.req.header("x-github-event");
  const body = await c.req.text();

  // Verify signature synchronously (fast)
  if (!signature || !await verify(config.webhookSecret, body, signature)) {
    logger.warn({ deliveryId }, "Webhook signature verification failed");
    return c.text("", 401);
  }

  // Check dedup
  if (isDuplicate(deliveryId)) {
    logger.info({ deliveryId }, "Duplicate delivery skipped");
    return c.text("", 200);
  }

  // Fire and forget -- process asynchronously
  const payload = JSON.parse(body);
  processEvent({ id: deliveryId, name: eventName, payload })
    .catch(err => logger.error({ err, deliveryId }, "Event processing failed"));

  return c.text("", 200);
});
```

### Pattern 2: Explicit Handler Registry

**What:** Map of `"event.action"` keys to arrays of handler functions.
**When to use:** The event router (central dispatch).

```typescript
// Source: Architecture decision from CONTEXT.md
type EventHandler = (event: WebhookEvent) => Promise<void>;

interface HandlerRegistry {
  handlers: Map<string, EventHandler[]>;
  register(eventKey: string, handler: EventHandler): void;
  dispatch(event: WebhookEvent): Promise<void>;
}

// Registration
registry.register("pull_request.opened", reviewHandler);
registry.register("pull_request.opened", loggingHandler);
registry.register("issue_comment.created", mentionHandler);

// Dispatch with isolated errors
async function dispatch(event: WebhookEvent): Promise<void> {
  const key = `${event.name}.${event.payload.action}`;
  const handlers = this.handlers.get(key) ?? [];

  // Also check for event-only handlers (no action qualifier)
  const eventOnlyHandlers = this.handlers.get(event.name) ?? [];
  const allHandlers = [...handlers, ...eventOnlyHandlers];

  if (allHandlers.length === 0) {
    logger.debug({ event: key }, "No handlers registered, dropping event");
    return;
  }

  // Run ALL handlers, isolate errors
  const results = await Promise.allSettled(
    allHandlers.map(handler => handler(event))
  );

  for (const result of results) {
    if (result.status === "rejected") {
      logger.error({ err: result.reason, event: key }, "Handler failed");
    }
  }
}
```

### Pattern 3: Fail-Fast Config Validation

**What:** Validate all required env vars at startup, crash with clear message if missing.
**When to use:** `src/config.ts`, imported at top of `src/index.ts`.

```typescript
// Source: Fail-fast pattern + Zod validation
import { z } from "zod";

const configSchema = z.object({
  githubAppId: z.string().min(1, "GITHUB_APP_ID is required"),
  githubPrivateKey: z.string().min(1, "Private key is required"),
  webhookSecret: z.string().min(1, "GITHUB_WEBHOOK_SECRET is required"),
  port: z.coerce.number().default(3000),
  botAllowList: z.string().default("").transform(s =>
    s.split(",").map(b => b.trim().toLowerCase()).filter(Boolean)
  ),
});

function loadPrivateKey(): string {
  const keyEnv = process.env.GITHUB_PRIVATE_KEY;
  if (!keyEnv) throw new Error("GITHUB_PRIVATE_KEY is required");

  // Support both inline PEM and file path
  if (keyEnv.startsWith("-----BEGIN")) return keyEnv;
  if (keyEnv.startsWith("/") || keyEnv.startsWith("./")) {
    return Bun.file(keyEnv).text(); // Note: sync needed at startup
  }
  // Try base64 decode
  return atob(keyEnv);
}

export function loadConfig() {
  const result = configSchema.safeParse({
    githubAppId: process.env.GITHUB_APP_ID,
    githubPrivateKey: loadPrivateKey(),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    port: process.env.PORT,
    botAllowList: process.env.BOT_ALLOW_LIST,
  });

  if (!result.success) {
    console.error("FATAL: Invalid configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
```

### Pattern 4: Bot Filtering Pipeline

**What:** Filter events from bot accounts before handler dispatch.
**When to use:** Between signature verification and handler dispatch.

```typescript
// Source: Reference code from claude-code-action/src/github/validation/actor.ts
interface BotFilter {
  isBot(sender: { type: string; login: string }): boolean;
  shouldProcess(sender: { type: string; login: string }): boolean;
}

function createBotFilter(appSlug: string, allowList: string[]): BotFilter {
  return {
    isBot(sender) {
      return sender.type !== "User";
    },
    shouldProcess(sender) {
      // Always filter the app's own events
      const senderLogin = sender.login.toLowerCase().replace(/\[bot\]$/, "");
      if (senderLogin === appSlug.toLowerCase()) return false;

      // Non-bot users always pass
      if (!this.isBot(sender)) return true;

      // Bot is allowed only if on the allow-list
      return allowList.includes(senderLogin);
    },
  };
}
```

### Anti-Patterns to Avoid

- **Parsing body before verification:** ALWAYS get raw body text first (`c.req.text()`), verify signature, THEN `JSON.parse()`. Parsing first can alter whitespace/encoding and break HMAC.
- **Awaiting async processing:** NEVER `await processEvent()` in the webhook handler. GitHub times out at 10 seconds. Return 200 immediately.
- **Catching handler errors globally:** Use `Promise.allSettled()` so one handler crash doesn't skip other handlers for the same event.
- **Using @octokit/webhooks event emitter:** It couples verification + routing + error handling into one opaque system. We need isolated handler errors and custom bot filtering, which require our own registry.
- **Pretty-printing logs:** User decision says JSON always. Do not add pino-pretty even as dev dependency.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC-SHA256 signature verification | Custom crypto.createHmac + timingSafeEqual | `@octokit/webhooks-methods` verify() | Timing-safe comparison, handles sha256= prefix, tested against GitHub's format |
| GitHub App JWT generation | Manual JWT with jsonwebtoken | `@octokit/auth-app` createAppAuth() | Handles RS256 signing, expiry, clock drift, all edge cases |
| Installation token caching | Custom Map with TTL logic | `@octokit/auth-app` built-in cache | Caches 15K tokens, auto-refreshes before expiry, keyed by installation ID |
| Webhook payload TypeScript types | Manual interface definitions | `@octokit/webhooks-types` | Auto-generated from GitHub's OpenAPI spec, updated daily via CI |
| Structured JSON logging | console.log + JSON.stringify | pino | Log levels, child loggers, request correlation, serializers, perf |

**Key insight:** GitHub App authentication involves JWT RS256 signing with specific claims (iss, iat, exp), installation token exchange via API, and token lifecycle management. @octokit/auth-app encapsulates all of this including caching. Building it yourself means debugging cryptographic edge cases.

## Common Pitfalls

### Pitfall 1: Raw Body Corruption Before Signature Verification

**What goes wrong:** Webhook signature verification fails on every request.
**Why it happens:** JSON middleware parses the body before the signature check. When re-serialized, whitespace/ordering changes break the HMAC.
**How to avoid:** Get raw body with `c.req.text()` FIRST. Verify signature against raw string. Parse JSON AFTER verification passes.
**Warning signs:** All webhooks return 401, signature mismatch errors in logs.

### Pitfall 2: Synchronous Processing Causes GitHub Timeouts

**What goes wrong:** GitHub marks webhooks as failed, may redeliver, eventually disables the webhook.
**Why it happens:** Handler processing takes >10 seconds (GitHub's timeout).
**How to avoid:** Return 200 within milliseconds. Process in detached promise. Log errors from the background task.
**Warning signs:** GitHub App settings show "Recent Deliveries" with timeout errors.

### Pitfall 3: Missing Private Key Newlines

**What goes wrong:** JWT signing fails with cryptic RSA/PEM errors at startup.
**Why it happens:** Environment variables often have `\n` literal strings instead of actual newlines. Copy-paste from .pem file loses line breaks.
**How to avoid:** `@octokit/auth-app` handles escaped newline replacement automatically. Document that base64 encoding the PEM is the safest approach for env vars.
**Warning signs:** "error:0909006C:PEM routines" or similar OpenSSL errors on startup.

### Pitfall 4: Infinite Bot Loops

**What goes wrong:** The app triggers on its own comments, creating an infinite loop of comments.
**Why it happens:** The app posts a comment, GitHub fires a webhook for that comment, the app processes it again.
**How to avoid:** ALWAYS filter the app's own account before any handler dispatch. This filter must be non-configurable (the user decision confirms this). Check `payload.sender.login` against the app's slug.
**Warning signs:** Rapidly increasing comment count, runaway API usage.

### Pitfall 5: Installation Token Scope Confusion

**What goes wrong:** API calls fail with 403 despite having a valid token.
**Why it happens:** Using an app JWT (which has limited permissions) instead of an installation access token (which has the permissions granted during installation).
**How to avoid:** Use `auth({ type: "installation", installationId })` for API calls, not `auth({ type: "app" })`. The webhook payload includes `installation.id` for every event.
**Warning signs:** 403 on GitHub API calls that should be authorized.

### Pitfall 6: Delivery ID Not Checked Before Processing

**What goes wrong:** Duplicate processing when GitHub redelivers webhooks.
**Why it happens:** GitHub redelivers with the same `X-GitHub-Delivery` header value when the original delivery was marked as failed.
**How to avoid:** Check deduplication AFTER signature verification but BEFORE dispatching to handlers. Store the delivery ID immediately (don't wait for processing to finish).
**Warning signs:** Duplicate comments, duplicate reviews, duplicate actions on the same event.

## Code Examples

### Complete Hono Server Setup

```typescript
// src/index.ts
import { Hono } from "hono";
import { loadConfig } from "./config";
import { createWebhookRoutes } from "./routes/webhooks";
import { createHealthRoutes } from "./routes/health";
import { createLogger } from "./lib/logger";
import { createGitHubApp } from "./auth/github-app";

// Fail fast on missing config
const config = loadConfig();
const logger = createLogger();
const githubApp = createGitHubApp(config);

const app = new Hono();

// Mount routes
app.route("/webhooks", createWebhookRoutes({ config, logger, githubApp }));
app.route("/", createHealthRoutes({ logger, githubApp }));

// Global error handler
app.onError((err, c) => {
  logger.error({ err, path: c.req.path }, "Unhandled error");
  return c.text("Internal Server Error", 500);
});

// Start server
export default {
  port: config.port,
  fetch: app.fetch,
};

logger.info({ port: config.port }, "Server started");
```

### Webhook Signature Verification

```typescript
// src/webhook/verify.ts
import { verify } from "@octokit/webhooks-methods";

export async function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  try {
    return await verify(secret, payload, signature);
  } catch {
    return false;
  }
}
```

### GitHub App Auth with Installation Tokens

```typescript
// src/auth/github-app.ts
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export function createGitHubApp(config: AppConfig) {
  const auth = createAppAuth({
    appId: config.githubAppId,
    privateKey: config.githubPrivateKey,
  });

  return {
    // Get JWT for app-level API calls (e.g., listing installations)
    async getAppToken() {
      const { token } = await auth({ type: "app" });
      return token;
    },

    // Get installation token for repo-level API calls
    // Token is cached internally by @octokit/auth-app (~1 hour TTL)
    async getInstallationOctokit(installationId: number): Promise<Octokit> {
      return new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.githubAppId,
          privateKey: config.githubPrivateKey,
          installationId,
        },
      });
    },

    // Verify GitHub API connectivity (for readiness probe)
    async checkConnectivity(): Promise<boolean> {
      try {
        const octokit = new Octokit({
          authStrategy: createAppAuth,
          auth: {
            appId: config.githubAppId,
            privateKey: config.githubPrivateKey,
          },
        });
        await octokit.rest.apps.getAuthenticated();
        return true;
      } catch {
        return false;
      }
    },
  };
}
```

### Health and Readiness Endpoints

```typescript
// src/routes/health.ts
import { Hono } from "hono";

export function createHealthRoutes(deps: { logger: Logger; githubApp: GitHubApp }) {
  const app = new Hono();

  // Liveness: always 200 if server is running
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Readiness: checks GitHub API connectivity
  app.get("/readiness", async (c) => {
    const healthy = await deps.githubApp.checkConnectivity();
    if (!healthy) {
      deps.logger.warn("Readiness check failed: GitHub API unreachable");
      return c.json({ status: "not ready", reason: "GitHub API unreachable" }, 503);
    }
    return c.json({ status: "ready" });
  });

  return app;
}
```

### pino Logger Setup

```typescript
// src/lib/logger.ts
import pino from "pino";

export function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    // JSON is the default format -- no configuration needed
    // No pretty-print, no transports -- stdout JSON only
  });
}

// Child logger pattern for request correlation
export function createRequestLogger(logger: pino.Logger, deliveryId: string) {
  return logger.child({ deliveryId });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @octokit/webhooks (full) event emitter | @octokit/webhooks-methods (verify only) + custom registry | webhooks-methods v6.0 (May 2025) | Lighter, more control over dispatch |
| Express.js + body-parser rawBody hack | Hono c.req.text() (Web Standards) | Hono v4.x (2024+) | No middleware ordering issues, clean raw body access |
| jsonwebtoken for GitHub App JWT | @octokit/auth-app with built-in caching | auth-app v8.x | No manual JWT, no manual token cache |
| Manual token refresh timers | @octokit/auth-app transparent refresh | auth-app v4+ (2020+) | Zero token management code |
| X-Hub-Signature (SHA-1) | X-Hub-Signature-256 (SHA-256) | GitHub 2021 | SHA-1 deprecated, always use SHA-256 |

**Deprecated/outdated:**
- **X-Hub-Signature (SHA-1):** GitHub still sends it but SHA-256 is the standard. Always use `x-hub-signature-256`.
- **@octokit/webhooks v12 and below:** v13+ uses ESM. v14.2.0 is current.
- **body-parser rawBody trick:** Web Standards frameworks (Hono, Elysia) give direct text body access.

## Open Questions

1. **App slug for self-filtering**
   - What we know: The app's own events must be filtered. The sender login includes `[bot]` suffix for app accounts.
   - What's unclear: The app slug must be known at startup. It can be fetched via `GET /app` (requires JWT auth) or configured as an env var.
   - Recommendation: Fetch it once at startup using `octokit.rest.apps.getAuthenticated()` and cache. This also serves as a startup connectivity check.

2. **Readiness probe frequency**
   - What we know: `/readiness` checks GitHub API connectivity per the user decision.
   - What's unclear: How often Azure will call this and whether we need to cache the result to avoid rate limiting.
   - Recommendation: Cache the connectivity check result for 30 seconds. Azure Container Apps typically probes every 10-30 seconds.

## Sources

### Primary (HIGH confidence)
- [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) - 10s timeout, idempotency, X-GitHub-Delivery dedup
- [GitHub webhook signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) - HMAC-SHA256, X-Hub-Signature-256
- [Hono Bun getting started](https://hono.dev/docs/getting-started/bun) - Server setup, export default pattern
- [Hono Stripe webhook example](https://hono.dev/examples/stripe-webhook) - c.req.text() for raw body, signature verification pattern
- [Hono best practices](https://hono.dev/docs/guides/best-practices) - app.route(), handler organization
- [@octokit/auth-app README](https://github.com/octokit/auth-app.js/) - createAppAuth, token caching (15K), auto-refresh
- [@octokit/webhooks-methods README](https://github.com/octokit/webhooks-methods.js) - verify() function, v6.0.0, SHA-256
- [@octokit/webhooks README](https://github.com/octokit/webhooks.js) - createWebMiddleware, event types, v14.2.0
- [Bun crypto.createHmac](https://bun.com/reference/node/crypto/createHmac) - Full Node.js crypto compat in Bun
- [Bun crypto.timingSafeEqual](https://bun.com/reference/node/crypto/timingSafeEqual) - Available in Bun globals

### Secondary (MEDIUM confidence)
- [Hono + GitHub webhooks integration](https://dev.to/fiberplane/building-a-community-database-with-github-a-guide-to-webhook-and-api-integration-with-honojs-1m8h) - Hono middleware pattern for GitHub webhooks
- [pino with Bun](https://medium.com/@yashbatra11111/10x-your-backend-logging-with-bun-and-pino-http-4de174a08fe2) - Confirmed working, pino-http integration
- [bun-plugin-pino](https://github.com/vktrl/bun-plugin-pino) - Bundling fix for pino worker threads in Bun

### Tertiary (LOW confidence)
- npm version numbers (hono 4.11.8, pino 10.2.0+, @octokit/auth-app 8.1.2) - Verified via npm search but exact latest may have changed

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via official docs and npm, well-established ecosystem
- Architecture: HIGH - Patterns derived from official Hono docs, GitHub docs, and reference code in tmp/
- Pitfalls: HIGH - Based on GitHub official best practices docs and common webhook implementation errors
- Discretionary choices: HIGH - Hono and pino recommendations well-supported by evidence

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (30 days -- stable ecosystem, no breaking changes expected)
