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
import { createWorkspaceManager, shouldUseGist } from "./jobs/workspace.ts";
import { createBotUserClient } from "./auth/bot-user.ts";
import { createForkManager } from "./jobs/fork-manager.ts";
import { createGistPublisher } from "./jobs/gist-publisher.ts";
import { createExecutor } from "./execution/executor.ts";
import { createMcpJobRegistry, createMcpHttpRoutes } from "./execution/mcp/http-server.ts";
import { createReviewHandler } from "./handlers/review.ts";
import { createMentionHandler } from "./handlers/mention.ts";
import { createFeedbackSyncHandler } from "./handlers/feedback-sync.ts";
import { createDepBumpMergeHistoryHandler } from "./handlers/dep-bump-merge-history.ts";
import { createCIFailureHandler } from "./handlers/ci-failure.ts";
import { createReviewCommentSyncHandler } from "./handlers/review-comment-sync.ts";
import { createIssueOpenedHandler } from "./handlers/issue-opened.ts";
import { createIssueClosedHandler } from "./handlers/issue-closed.ts";
import { createAddonCheckHandler } from "./handlers/addon-check.ts";
import { createTroubleshootingHandler } from "./handlers/troubleshooting-agent.ts";
import { createWikiSyncScheduler } from "./knowledge/wiki-sync.ts";
import { createWikiStalenessDetector } from "./knowledge/wiki-staleness-detector.ts";
import { createClusterScheduler } from "./knowledge/cluster-scheduler.ts";
import { createWikiPopularityScorer } from "./knowledge/wiki-popularity-scorer.ts";
import { createClusterStore } from "./knowledge/cluster-store.ts";
import { matchClusterPatterns } from "./knowledge/cluster-matcher.ts";
import { createTaskRouter } from "./llm/task-router.ts";
import { createCostTracker } from "./llm/cost-tracker.ts";
import { createTelemetryStore } from "./telemetry/store.ts";
import { createKnowledgeStore } from "./knowledge/store.ts";
import { createKnowledgeRuntime, startEmbeddingSmokeTest } from "./knowledge/runtime.ts";
import { createDbClient, type Sql } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { createContributorProfileStore } from "./contributor/index.ts";
import { createSlackCommandRoutes } from "./routes/slack-commands.ts";
import { createSlackClient } from "./slack/client.ts";
import { createSlackAssistantHandler } from "./slack/assistant-handler.ts";
import { createSlackWriteRunner } from "./slack/write-runner.ts";
import { createRequestTracker } from "./lifecycle/request-tracker.ts";
import { createShutdownManager } from "./lifecycle/shutdown-manager.ts";
import { createWebhookQueueStore } from "./lifecycle/webhook-queue-store.ts";

// Global error handlers — log and keep running instead of silently crashing
process.on("uncaughtException", (err) => {
  console.error("FATAL: uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("FATAL: unhandledRejection", reason);
});

// Fail fast on missing or invalid config
const config = await loadConfig();
const logger = createLogger();
const dedup = createDeduplicator();

// Initialize GitHub App auth -- validates credentials and fetches app slug.
// Crashes the process if credentials are invalid (fail-fast).
const githubApp = createGitHubApp(config, logger);
await githubApp.initialize();

// Bot user client for fork/gist operations (Phase 127)
const botUserClient = createBotUserClient(config, logger);
const forkManager = createForkManager(botUserClient, logger, config.botUserPat || undefined);
const gistPublisher = createGistPublisher(botUserClient, logger);

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

// Cost tracker (shared across executor and scheduled jobs)
const costTracker = createCostTracker({ telemetryStore, logger });

// Lifecycle: request tracking, webhook queuing, shutdown management
const requestTracker = createRequestTracker();
const webhookQueueStore = createWebhookQueueStore({ sql, logger, telemetryStore });
// Mutable reference for wiki sync scheduler (set later, stopped on shutdown)
let _wikiSyncSchedulerRef: { stop: () => void } | null = null;
let _wikiStalenessDetectorRef: { stop: () => void } | null = null;
let _clusterSchedulerRef: { stop: () => void; runNow: () => Promise<void> } | null = null;
let _wikiPopularityScorerRef: { stop: () => void } | null = null;

const shutdownManager = createShutdownManager({
  logger,
  requestTracker,
  closeDb: async () => {
    // Stop wiki schedulers before closing DB
    _wikiSyncSchedulerRef?.stop();
    _wikiStalenessDetectorRef?.stop();
    _clusterSchedulerRef?.stop();
    _wikiPopularityScorerRef?.stop();
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

const contributorProfileStore = createContributorProfileStore({ sql, logger });
logger.info("Contributor profile store initialized (PostgreSQL)");

const knowledgeRuntime = createKnowledgeRuntime({ sql, logger });
const {
  learningMemoryStore,
  embeddingProvider,
  wikiEmbeddingProvider,
  reviewCommentStore,
  wikiPageStore,
  codeSnippetStore,
  issueStore,
  retriever,
  wikiCitationLogger: popularityStore,
} = knowledgeRuntime;

// Embeddings smoke test -- runs concurrently, does NOT block server startup
startEmbeddingSmokeTest({ embeddingProvider, logger });

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
const taskRouter = createTaskRouter({ models: {} }, logger);
const executor = createExecutor({ githubApp, logger, taskRouter, costTracker });

// MCP HTTP server — per-job bearer-token registry for isolated ACA agent jobs
const mcpJobRegistry = createMcpJobRegistry();

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
  createWorkspace: async ({ installationId, owner, repo, ref, depth, forkContext }) =>
    workspaceManager.create(installationId, { owner, repo, ref, depth, forkContext }),
  execute: async ({ workspace, installationId, owner, repo, prompt, triggerBody }) =>
    executor.execute({
      workspace,
      installationId,
      owner,
      repo,
      prNumber: undefined,
      commentId: undefined,
      taskType: "slack.response",
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
  forkManager,
  gistPublisher,
  logger,
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
      taskType: "slack.response",
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
  sql,
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
  codeSnippetStore,
  contributorProfileStore,
  slackBotToken: config.slackBotToken,
  clusterMatcher: async (opts) => {
    try {
      const clusterStore = createClusterStore({ sql, logger });
      return await matchClusterPatterns(opts, clusterStore, sql, logger);
    } catch (err) {
      logger.warn({ err }, "Cluster pattern matching failed (fail-open)");
      return [];
    }
  },
  issueStore,
  sql,
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
  forkManager,
  gistPublisher,
  sql,
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
createCIFailureHandler({
  eventRouter,
  jobQueue,
  githubApp,
  sql,
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

createAddonCheckHandler({
  eventRouter,
  githubApp,
  config,
  logger,
  workspaceManager,
  jobQueue,
});

if (issueStore && embeddingProvider) {
  createIssueOpenedHandler({
    eventRouter,
    jobQueue,
    githubApp,
    workspaceManager,
    issueStore,
    embeddingProvider,
    sql,
    logger,
  });

  createIssueClosedHandler({
    eventRouter,
    sql,
    logger,
  });

  createTroubleshootingHandler({
    eventRouter,
    jobQueue,
    githubApp,
    workspaceManager,
    issueStore,
    wikiPageStore,
    embeddingProvider,
    wikiEmbeddingProvider,
    taskRouter,
    costTracker,
    sql,
    logger,
  });
}

// Wiki sync scheduler (KI-10: daily incremental sync via RecentChanges API)
const wikiSyncScheduler = embeddingProvider
  ? createWikiSyncScheduler({
      store: wikiPageStore,
      embeddingProvider: wikiEmbeddingProvider,
      source: "kodi.wiki",
      logger,
    })
  : null;
if (wikiSyncScheduler) {
  wikiSyncScheduler.start();
  _wikiSyncSchedulerRef = wikiSyncScheduler;
  logger.info("Wiki sync scheduler started (24h interval, 60s startup delay)");
}

// Wiki staleness detector (Phase 99: weekly scheduled scan)
const stalenessTaskRouter = createTaskRouter({ models: {} }, logger);
const wikiStalenessDetector = config.slackWikiChannelId
  ? createWikiStalenessDetector({
      sql,
      wikiPageStore,
      githubApp,
      slackClient,
      taskRouter: stalenessTaskRouter,
      costTracker,
      logger,
      githubOwner: config.wikiGithubOwner,
      githubRepo: config.wikiGithubRepo,
      wikiChannelId: config.slackWikiChannelId,
      stalenessThresholdDays: config.wikiStalenessThresholdDays,
    })
  : null;
if (wikiStalenessDetector) {
  wikiStalenessDetector.start();
  _wikiStalenessDetectorRef = wikiStalenessDetector;
  logger.info(
    {
      intervalDays: 7,
      startupDelayMs: 90_000,
      channelId: config.slackWikiChannelId,
      owner: config.wikiGithubOwner,
      repo: config.wikiGithubRepo,
    },
    "Wiki staleness detector started (7-day interval, 90s startup delay)",
  );
} else {
  logger.info("Wiki staleness detector disabled: SLACK_WIKI_CHANNEL_ID not configured");
}

// Wiki popularity scorer (Phase 121: weekly scheduled scoring)
const wikiPopularityScorer = createWikiPopularityScorer({
  sql,
  logger,
  wikiPageStore,
  popularityStore,
  wikiBaseUrl: process.env.WIKI_BASE_URL ?? "https://kodi.wiki",
});
wikiPopularityScorer.start();
_wikiPopularityScorerRef = wikiPopularityScorer;
logger.info(
  { intervalDays: 7, startupDelayMs: 300_000 },
  "Wiki popularity scorer started (7-day interval, 5min startup delay)",
);

// Review pattern clustering (Phase 100: weekly scheduled clustering + on-demand)
const clusterTaskRouter = createTaskRouter({ models: {} }, logger);
const clusterScheduler = createClusterScheduler({
  sql,
  taskRouter: clusterTaskRouter,
  logger,
  repos: [config.wikiGithubRepo].filter(Boolean) as string[],
});
clusterScheduler.start();
_clusterSchedulerRef = clusterScheduler;
logger.info(
  { intervalDays: 7, startupDelayMs: 120_000 },
  "Cluster scheduler started (7-day interval, 120s startup delay)",
);

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
    // On-demand wiki staleness check trigger: @kodiai wiki-check
    if (/wiki[-\s]?check/i.test(payload.text) && wikiStalenessDetector) {
      const untrackJob = requestTracker?.trackJob();
      Promise.resolve()
        .then(async () => {
          logger.info({ channel: payload.channel, user: payload.user }, "On-demand wiki-check triggered");
          await wikiStalenessDetector.runScan();
        })
        .catch((err) => {
          logger.error({ err }, "On-demand wiki-check scan failed");
        })
        .finally(() => {
          untrackJob?.();
        });
      return; // Don't route to slackAssistantHandler
    }

    // On-demand cluster refresh trigger: @kodiai cluster-refresh
    if (/cluster[-\s]?refresh/i.test(payload.text) && _clusterSchedulerRef) {
      const untrackJob = requestTracker?.trackJob();
      Promise.resolve()
        .then(async () => {
          logger.info({ channel: payload.channel, user: payload.user }, "On-demand cluster-refresh triggered");
          await _clusterSchedulerRef!.runNow();
        })
        .catch((err) => {
          logger.error({ err }, "On-demand cluster-refresh failed");
        })
        .finally(() => {
          untrackJob?.();
        });
      return; // Don't route to slackAssistantHandler
    }

    await slackAssistantHandler.handle(payload);
  },
}));
app.route("/webhooks/slack/commands", createSlackCommandRoutes({
  config,
  logger,
  profileStore: contributorProfileStore,
}));
app.route("/", createHealthRoutes({ githubApp, logger, sql }));

// MCP HTTP routes — internal endpoint for ACA agent jobs to call MCP tools
app.route("/", createMcpHttpRoutes(mcpJobRegistry, logger));

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
