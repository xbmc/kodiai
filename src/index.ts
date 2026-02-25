import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { createDeduplicator } from "./webhook/dedup.ts";
import { createInMemoryCache } from "./lib/in-memory-cache.ts";
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
import { createReviewCommentSyncHandler } from "./handlers/review-comment-sync.ts";
import { createReviewCommentStore } from "./knowledge/review-comment-store.ts";
import { createWikiPageStore } from "./knowledge/wiki-store.ts";
import { createWikiSyncScheduler } from "./knowledge/wiki-sync.ts";
import { createTelemetryStore } from "./telemetry/store.ts";
import { createKnowledgeStore } from "./knowledge/store.ts";
import { createLearningMemoryStore } from "./knowledge/memory-store.ts";
import { createEmbeddingProvider, createNoOpEmbeddingProvider } from "./knowledge/embeddings.ts";
import type { LearningMemoryStore, EmbeddingProvider } from "./knowledge/types.ts";
import { createIsolationLayer, type IsolationLayer } from "./knowledge/isolation.ts";
import { createRetriever } from "./knowledge/retrieval.ts";
import { createDbClient, type Sql } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { createSlackClient } from "./slack/client.ts";
import { createSlackAssistantHandler } from "./slack/assistant-handler.ts";
import { createSlackWriteRunner } from "./slack/write-runner.ts";
import { createRequestTracker } from "./lifecycle/request-tracker.ts";
import { createShutdownManager } from "./lifecycle/shutdown-manager.ts";
import { createWebhookQueueStore } from "./lifecycle/webhook-queue-store.ts";

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

// PostgreSQL connection (all stores share single connection pool)
const { sql, close: closeDb } = createDbClient({ logger });
await runMigrations(sql);
logger.info("PostgreSQL connected and migrations applied");

// Telemetry storage
const rateLimitFailureInjectionIdentities = (process.env.TELEMETRY_RATE_LIMIT_FAILURE_IDENTITIES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const telemetryStore = createTelemetryStore({
  sql,
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

// Lifecycle: request tracking, webhook queuing, shutdown management
const requestTracker = createRequestTracker();
const webhookQueueStore = createWebhookQueueStore({ sql, logger, telemetryStore });
// Mutable reference for wiki sync scheduler (set later, stopped on shutdown)
let _wikiSyncSchedulerRef: { stop: () => void } | null = null;

const shutdownManager = createShutdownManager({
  logger,
  requestTracker,
  closeDb: async () => {
    // Stop wiki sync scheduler before closing DB
    _wikiSyncSchedulerRef?.stop();
    await closeDb();
  },
});

// Startup maintenance: purge old rows (TELEM-07)
const purgedCount = await telemetryStore.purgeOlderThan(90);
if (purgedCount > 0) {
  logger.info({ purgedCount }, "Telemetry retention purge complete");
}

const knowledgeStore = createKnowledgeStore({ sql, logger });
logger.info("Knowledge store initialized (PostgreSQL)");

// Learning memory (v0.5 LEARN-06, migrated to PostgreSQL + pgvector in v0.17)
let learningMemoryStore: LearningMemoryStore | undefined;
let embeddingProvider: EmbeddingProvider | undefined;

try {
  learningMemoryStore = createLearningMemoryStore({ sql, logger });
  logger.info("Learning memory store initialized (PostgreSQL + pgvector)");
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

// Embeddings smoke test -- runs concurrently, does NOT block server startup
void Promise.resolve()
  .then(async () => {
    if (!embeddingProvider || embeddingProvider.model === "none") {
      return; // no-op provider, skip smoke test
    }
    const start = Date.now();
    try {
      const result = await embeddingProvider.generate("kodiai smoke test", "query");
      const latencyMs = Date.now() - start;
      if (result !== null) {
        logger.info(
          { model: embeddingProvider.model, dimensions: embeddingProvider.dimensions, latencyMs },
          "Embeddings smoke test passed",
        );
      } else {
        logger.warn(
          { model: embeddingProvider.model },
          "Embeddings smoke test failed -- VoyageAI returned null (embeddings degraded)",
        );
      }
    } catch (err) {
      logger.warn(
        { err, model: embeddingProvider.model },
        "Embeddings smoke test failed -- error connecting to VoyageAI (embeddings degraded)",
      );
    }
  })
  .catch((err) => {
    logger.warn({ err }, "Embeddings smoke test unexpected error (non-fatal)");
  });

// Review comment store (v0.18 KI-04)
const reviewCommentStore = createReviewCommentStore({ sql, logger });
logger.info("Review comment store initialized (PostgreSQL + pgvector)");

// Wiki page store (v0.18 KI-10)
const wikiPageStore = createWikiPageStore({ sql, logger });
logger.info("Wiki page store initialized (PostgreSQL + pgvector)");

// Learning memory isolation layer (LEARN-07)
let isolationLayer: IsolationLayer | undefined;
if (learningMemoryStore) {
  isolationLayer = createIsolationLayer({ memoryStore: learningMemoryStore, logger });
  logger.info("Learning memory isolation layer initialized");
}

// Knowledge retrieval (unified pipeline)
const retriever = isolationLayer && embeddingProvider
  ? createRetriever({
      embeddingProvider,
      isolationLayer,
      config: {
        retrieval: {
          enabled: config.knowledge.retrieval.enabled,
          topK: config.knowledge.retrieval.topK,
          distanceThreshold: config.knowledge.retrieval.distanceThreshold,
          adaptive: config.knowledge.retrieval.adaptive,
          maxContextChars: config.knowledge.retrieval.maxContextChars,
        },
        sharing: {
          enabled: config.knowledge.sharing.enabled,
        },
      },
      reviewCommentStore,
      wikiPageStore,
      memoryStore: learningMemoryStore,
    })
  : undefined;

// Startup maintenance: purge old run state entries
if (knowledgeStore) {
  try {
    const runsPurged = await knowledgeStore.purgeOldRuns(30);
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
const slackInstallationCache = createInMemoryCache<string, { installationId: number; defaultBranch: string }>({
  maxSize: 500,
  ttlMs: 60 * 60 * 1000,
});

void Promise.resolve()
  .then(async () => {
    const scopes = await slackClient.getTokenScopes();
    const requiredScopes = ["chat:write", "reactions:write"];
    const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));

    if (missingScopes.length > 0) {
      logger.warn(
        {
          requiredScopes,
          missingScopes,
          tokenScopes: scopes,
        },
        "Slack bot token missing required scopes; reinstall app after updating scopes",
      );
      return;
    }

    logger.info({ tokenScopes: scopes }, "Slack bot token scope preflight passed");
  })
  .catch((err) => {
    logger.warn({ err }, "Slack bot token scope preflight failed (non-fatal)");
  });

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

const slackWriteRunner = createSlackWriteRunner({
  resolveRepoInstallationContext: resolveSlackInstallationContext,
  createWorkspace: async ({ installationId, owner, repo, ref, depth }) =>
    workspaceManager.create(installationId, { owner, repo, ref, depth }),
  execute: async ({ workspace, installationId, owner, repo, prompt, triggerBody }) =>
    executor.execute({
      workspace,
      installationId,
      owner,
      repo,
      prNumber: undefined,
      commentId: undefined,
      eventType: "slack.message",
      triggerBody,
      prompt,
      modelOverride: config.slackAssistantModel,
      dynamicTimeoutSeconds: 180,
      maxTurnsOverride: 8,
      writeMode: true,
      enableInlineTools: false,
      enableCommentTools: true,
      botHandles: ["kodiai"],
    }),
  createPullRequest: async ({ installationId, owner, repo, title, head, base, body }) => {
    const octokit = await githubApp.getInstallationOctokit(installationId);
    const response = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      head,
      base,
      body,
    });
    return { htmlUrl: response.data.html_url };
  },
});

const slackAssistantHandler = createSlackAssistantHandler({
  createWorkspace: async ({ owner, repo }) => {
    const installationContext = await resolveSlackInstallationContext(owner, repo);
    return workspaceManager.create(installationContext.installationId, {
      owner,
      repo,
      ref: installationContext.defaultBranch,
      depth: 1,
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
      modelOverride: config.slackAssistantModel,
      dynamicTimeoutSeconds: 180,
      maxTurnsOverride: 8,
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
  runWrite: async (input) => {
    return slackWriteRunner.run(input);
  },
  publishInThread: async ({ channel, threadTs, text }) => {
    await slackClient.postThreadMessage({ channel, threadTs, text });
  },
  addWorkingReaction: async ({ channel, messageTs }) => {
    try {
      await slackClient.addReaction({ channel, timestamp: messageTs, name: "hourglass_flowing_sand" });
    } catch (error) {
      logger.warn({ err: error, channel, messageTs }, "Slack working reaction add failed");
    }
  },
  removeWorkingReaction: async ({ channel, messageTs }) => {
    try {
      await slackClient.removeReaction({ channel, timestamp: messageTs, name: "hourglass_flowing_sand" });
    } catch (error) {
      logger.warn({ err: error, channel, messageTs }, "Slack working reaction remove failed");
    }
  },
  retriever,
  logger,
  defaultRepo: config.slackDefaultRepo,
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
  retriever,
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
  retriever,
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
if (reviewCommentStore && embeddingProvider) {
  createReviewCommentSyncHandler({
    eventRouter,
    jobQueue,
    store: reviewCommentStore,
    embeddingProvider,
    logger,
  });
}

// Wiki sync scheduler (KI-10: daily incremental sync via RecentChanges API)
const wikiSyncScheduler = embeddingProvider
  ? createWikiSyncScheduler({
      store: wikiPageStore,
      embeddingProvider,
      source: "kodi.wiki",
      logger,
    })
  : null;
if (wikiSyncScheduler) {
  wikiSyncScheduler.start();
  _wikiSyncSchedulerRef = wikiSyncScheduler;
  logger.info("Wiki sync scheduler started (24h interval, 60s startup delay)");
}

const app = new Hono();

// Mount routes
app.route("/webhooks", createWebhookRoutes({ config, logger, dedup, githubApp, eventRouter, requestTracker, webhookQueueStore, shutdownManager }));
app.route("/webhooks/slack", createSlackEventRoutes({
  config,
  logger,
  shutdownManager,
  webhookQueueStore,
  requestTracker,
  onAllowedBootstrap: async (payload) => {
    await slackAssistantHandler.handle(payload);
  },
}));
app.route("/", createHealthRoutes({ githubApp, logger, sql }));

// Global error handler
app.onError((err, c) => {
  logger.error({ err, path: c.req.path, method: c.req.method }, "Unhandled error");
  return c.json({ error: "Internal Server Error" }, 500);
});

// Start shutdown manager (SIGTERM/SIGINT handlers)
shutdownManager.start();

// Startup webhook queue replay: process any webhooks queued during previous shutdown
const startupReplayStart = Date.now();
let queuedWebhooksProcessed = 0;
let queuedWebhooksFailed = 0;

try {
  const pendingWebhooks = await webhookQueueStore.dequeuePending();

  for (const entry of pendingWebhooks) {
    try {
      if (entry.source === "github") {
        // Reconstruct WebhookEvent from queued data
        const payload = JSON.parse(entry.body) as Record<string, unknown>;
        const installation = payload.installation as { id: number } | undefined;
        const event = {
          id: entry.deliveryId ?? `replay-${entry.id}`,
          name: entry.eventName ?? "unknown",
          payload,
          installationId: installation?.id ?? 0,
        };
        await eventRouter.dispatch(event);
      } else if (entry.source === "slack") {
        // Reconstruct Slack bootstrap payload and dispatch
        const slackPayload = JSON.parse(entry.body) as Record<string, unknown>;
        const slackEvent = slackPayload.event as Record<string, unknown> | undefined;

        if (slackEvent) {
          const bootstrapPayload = {
            channel: (slackEvent.channel as string) ?? "",
            threadTs: (slackEvent.thread_ts as string) ?? (slackEvent.ts as string) ?? "",
            messageTs: (slackEvent.ts as string) ?? "",
            user: (slackEvent.user as string) ?? "",
            text: (slackEvent.text as string) ?? "",
            replyTarget: "thread-only" as const,
          };
          await slackAssistantHandler.handle(bootstrapPayload);
        }
      }

      await webhookQueueStore.markCompleted(entry.id!);
      queuedWebhooksProcessed++;
    } catch (err) {
      logger.warn({ err, id: entry.id, source: entry.source }, "Failed to replay queued webhook");
      await webhookQueueStore.markFailed(entry.id!);
      queuedWebhooksFailed++;
    }
  }
} catch (err) {
  logger.error({ err }, "Startup webhook queue replay failed (non-fatal)");
}

const startupDurationMs = Date.now() - startupReplayStart;
if (queuedWebhooksProcessed > 0 || queuedWebhooksFailed > 0) {
  logger.info(
    {
      startupDurationMs,
      queuedWebhooksProcessed,
      queuedWebhooksFailed,
      dbStatus: "connected",
    },
    "Startup webhook queue replay complete",
  );
}

logger.info({ port: config.port }, "Kodiai server started");

export default {
  port: config.port,
  fetch: app.fetch,
};
