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
import { createExecutor } from "./execution/executor.ts";
import { createReviewHandler } from "./handlers/review.ts";
import { createMentionHandler } from "./handlers/mention.ts";
import { createTelemetryStore } from "./telemetry/store.ts";
import { createKnowledgeStore } from "./knowledge/store.ts";
import { resolveKnowledgeDbPath } from "./knowledge/db-path.ts";

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

// Telemetry storage (SQLite with WAL mode)
const telemetryDbPath = process.env.TELEMETRY_DB_PATH ?? "./data/kodiai-telemetry.db";
const telemetryStore = createTelemetryStore({ dbPath: telemetryDbPath, logger });

// Startup maintenance: purge old rows (TELEM-07) and checkpoint WAL (TELEM-08)
const purgedCount = telemetryStore.purgeOlderThan(90);
if (purgedCount > 0) {
  logger.info({ purgedCount }, "Telemetry retention purge complete");
}
telemetryStore.checkpoint();

const knowledgeDb = resolveKnowledgeDbPath();
const knowledgeStore = createKnowledgeStore({ dbPath: knowledgeDb.dbPath, logger });
logger.info(
  { knowledgeDbPath: knowledgeDb.dbPath, source: knowledgeDb.source },
  "Knowledge store path resolved",
);
knowledgeStore.checkpoint();

// Event processing pipeline: bot filter -> event router
const botFilter = createBotFilter(githubApp.getAppSlug(), config.botAllowList, logger);
const eventRouter = createEventRouter(botFilter, logger);

// Execution engine
const executor = createExecutor({ githubApp, logger });

// Register event handlers
createReviewHandler({
  eventRouter,
  jobQueue,
  workspaceManager,
  githubApp,
  executor,
  telemetryStore,
  knowledgeStore,
  logger,
});
createMentionHandler({
  eventRouter,
  jobQueue,
  workspaceManager,
  githubApp,
  executor,
  telemetryStore,
  knowledgeStore,
  logger,
});

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
