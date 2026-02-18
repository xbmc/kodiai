import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { createDeduplicator } from "./webhook/dedup.ts";
import { createGitHubApp } from "./auth/github-app.ts";
import { createBotFilter } from "./webhook/filters.ts";
import { createEventRouter } from "./webhook/router.ts";
import { createWebhookRoutes } from "./routes/webhooks.ts";
import { createSlackEventRoutes } from "./routes/slack-events.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { createJobQueue } from "./jobs/queue.ts";
import { createWorkspaceManager } from "./jobs/workspace.ts";
import { createExecutor } from "./execution/executor.ts";
import { createReviewHandler } from "./handlers/review.ts";
import { createMentionHandler } from "./handlers/mention.ts";
import { createFeedbackSyncHandler } from "./handlers/feedback-sync.ts";
import { createDepBumpMergeHistoryHandler } from "./handlers/dep-bump-merge-history.ts";
import { createTelemetryStore } from "./telemetry/store.ts";
import { createKnowledgeStore } from "./knowledge/store.ts";
import { resolveKnowledgeDbPath } from "./knowledge/db-path.ts";
import { createLearningMemoryStore } from "./learning/memory-store.ts";
import { createEmbeddingProvider, createNoOpEmbeddingProvider } from "./learning/embedding-provider.ts";
import type { LearningMemoryStore, EmbeddingProvider } from "./learning/types.ts";
import { createIsolationLayer, type IsolationLayer } from "./learning/isolation.ts";
import { Database } from "bun:sqlite";
import { createSlackClient } from "./slack/client.ts";
import { createSlackAssistantHandler } from "./slack/assistant-handler.ts";

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
const rateLimitFailureInjectionIdentities = (process.env.TELEMETRY_RATE_LIMIT_FAILURE_IDENTITIES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const telemetryStore = createTelemetryStore({
  dbPath: telemetryDbPath,
  logger,
  rateLimitFailureInjectionIdentities,
});
if (rateLimitFailureInjectionIdentities.length > 0) {
  logger.warn(
    {
      count: rateLimitFailureInjectionIdentities.length,
      identities: rateLimitFailureInjectionIdentities,
      envVar: "TELEMETRY_RATE_LIMIT_FAILURE_IDENTITIES",
    },
    "Rate-limit telemetry failure injection enabled",
  );
}

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

// Learning memory (v0.5 LEARN-06)
let learningMemoryStore: LearningMemoryStore | undefined;
let embeddingProvider: EmbeddingProvider | undefined;

try {
  const learningDb = new Database(knowledgeDb.dbPath, { create: true });
  learningDb.run("PRAGMA journal_mode = WAL");
  learningDb.run("PRAGMA synchronous = NORMAL");
  learningDb.run("PRAGMA busy_timeout = 5000");

  learningMemoryStore = createLearningMemoryStore({ db: learningDb, logger });
  logger.info("Learning memory store initialized");
} catch (err) {
  logger.warn({ err }, "Learning memory store failed to initialize (fail-open, learning disabled)");
}

const voyageApiKey = process.env.VOYAGE_API_KEY?.trim();
if (voyageApiKey && learningMemoryStore) {
  embeddingProvider = createEmbeddingProvider({
    apiKey: voyageApiKey,
    model: "voyage-code-3",
    dimensions: 1024,
    logger,
  });
  logger.info({ model: "voyage-code-3", dimensions: 1024 }, "Embedding provider initialized");
} else {
  embeddingProvider = createNoOpEmbeddingProvider(logger);
  if (!voyageApiKey) {
    logger.info("VOYAGE_API_KEY not set, embedding generation disabled (no-op provider)");
  }
}

// Learning memory isolation layer (LEARN-07)
let isolationLayer: IsolationLayer | undefined;
if (learningMemoryStore) {
  isolationLayer = createIsolationLayer({ memoryStore: learningMemoryStore, logger });
  logger.info("Learning memory isolation layer initialized");
}

// Startup maintenance: purge old run state entries
if (knowledgeStore) {
  try {
    const runsPurged = knowledgeStore.purgeOldRuns(30);
    if (runsPurged > 0) {
      logger.info({ runsPurged }, "Run state retention purge complete");
    }
  } catch (err) {
    logger.warn({ err }, "Run state purge failed (non-fatal)");
  }
}

// Event processing pipeline: bot filter -> event router
const botFilter = createBotFilter(githubApp.getAppSlug(), config.botAllowList, logger);
const eventRouter = createEventRouter(botFilter, logger);

// Execution engine
const executor = createExecutor({ githubApp, logger });

const slackClient = createSlackClient({ botToken: config.slackBotToken });
const slackInstallationCache = new Map<string, { installationId: number; defaultBranch: string }>();

async function resolveSlackInstallationContext(owner: string, repo: string): Promise<{ installationId: number; defaultBranch: string }> {
  const key = `${owner}/${repo}`;
  const cached = slackInstallationCache.get(key);
  if (cached) {
    return cached;
  }

  const context = await githubApp.getRepoInstallationContext(owner, repo);
  if (!context) {
    throw new Error(`Repository ${owner}/${repo} is not installed for this GitHub App`);
  }

  slackInstallationCache.set(key, context);
  return context;
}

const slackAssistantHandler = createSlackAssistantHandler({
  createWorkspace: async ({ owner, repo }) => {
    const installationContext = await resolveSlackInstallationContext(owner, repo);
    return workspaceManager.create(installationContext.installationId, {
      owner,
      repo,
      ref: installationContext.defaultBranch,
      depth: 50,
    });
  },
  execute: async (input) => {
    const installationContext = await resolveSlackInstallationContext(input.owner, input.repo);
    const result = await executor.execute({
      workspace: input.workspace,
      installationId: installationContext.installationId,
      owner: input.owner,
      repo: input.repo,
      prNumber: undefined,
      commentId: undefined,
      eventType: input.eventType,
      triggerBody: input.triggerBody,
      prompt: input.prompt,
      writeMode: input.writeMode,
      enableInlineTools: input.enableInlineTools,
      enableCommentTools: input.enableCommentTools,
      botHandles: ["kodiai"],
    });

    if (result.conclusion !== "success") {
      throw new Error(result.errorMessage ?? `Slack assistant execution failed with conclusion=${result.conclusion}`);
    }

    const answerText = result.resultText?.trim();
    if (!answerText) {
      throw new Error("Slack assistant execution did not return answer text");
    }

    return { answerText };
  },
  publishInThread: async ({ channel, threadTs, text }) => {
    await slackClient.postThreadMessage({ channel, threadTs, text });
  },
});

// Register event handlers
createReviewHandler({
  eventRouter,
  jobQueue,
  workspaceManager,
  githubApp,
  executor,
  telemetryStore,
  knowledgeStore,
  learningMemoryStore,
  embeddingProvider,
  isolationLayer,
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
createFeedbackSyncHandler({
  eventRouter,
  jobQueue,
  githubApp,
  knowledgeStore,
  logger,
});
createDepBumpMergeHistoryHandler({
  eventRouter,
  jobQueue,
  githubApp,
  knowledgeStore,
  logger,
});

const app = new Hono();

// Mount routes
app.route("/webhooks", createWebhookRoutes({ config, logger, dedup, githubApp, eventRouter }));
app.route("/webhooks/slack", createSlackEventRoutes({
  config,
  logger,
  onAllowedBootstrap: async (payload) => {
    await slackAssistantHandler.handle(payload);
  },
}));
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
