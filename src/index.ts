import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { createDeduplicator } from "./webhook/dedup.ts";
import { createGitHubApp } from "./auth/github-app.ts";
import { createBotFilter } from "./webhook/filters.ts";
import { createEventRouter } from "./webhook/router.ts";
import { createWebhookRoutes } from "./routes/webhooks.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { createJobQueue } from "./jobs/queue.ts";
import { createWorkspaceManager } from "./jobs/workspace.ts";

// Fail fast on missing or invalid config
const config = await loadConfig();
const logger = createLogger();
const dedup = createDeduplicator();

// Initialize GitHub App auth -- validates credentials and fetches app slug.
// Crashes the process if credentials are invalid (fail-fast).
const githubApp = createGitHubApp(config, logger);
await githubApp.initialize();

// Job infrastructure
const jobQueue = createJobQueue(logger);
const workspaceManager = createWorkspaceManager(githubApp, logger);

// Defense-in-depth: clean up any stale workspaces from previous runs
const staleCount = await workspaceManager.cleanupStale();
if (staleCount > 0) {
  logger.info({ staleCount }, "Cleaned up stale workspaces from previous run");
}

// Event processing pipeline: bot filter -> event router
const botFilter = createBotFilter(githubApp.getAppSlug(), config.botAllowList, logger);
const eventRouter = createEventRouter(botFilter, logger);

// Phase 3+ plans will register handlers that use jobQueue and workspaceManager.
// Example: eventRouter.register("pull_request.opened", async (event) => {
//   await jobQueue.enqueue(event.installationId, async () => {
//     const ws = await workspaceManager.create(event.installationId, { owner, repo, ref });
//     try { /* run job */ } finally { await ws.cleanup(); }
//   });
// });

const app = new Hono();

// Mount routes
app.route("/webhooks", createWebhookRoutes({ config, logger, dedup, githubApp, eventRouter }));
app.route("/", createHealthRoutes({ githubApp, logger }));

// Global error handler
app.onError((err, c) => {
  logger.error({ err, path: c.req.path, method: c.req.method }, "Unhandled error");
  return c.json({ error: "Internal Server Error" }, 500);
});

logger.info({ port: config.port }, "Kodiai server started");

export default {
  port: config.port,
  fetch: app.fetch,
};
