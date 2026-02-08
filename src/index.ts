import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { createDeduplicator } from "./webhook/dedup.ts";
import { createGitHubApp } from "./auth/github-app.ts";
import { createWebhookRoutes } from "./routes/webhooks.ts";
import { createHealthRoutes } from "./routes/health.ts";

// Fail fast on missing or invalid config
const config = await loadConfig();
const logger = createLogger();
const dedup = createDeduplicator();

// Initialize GitHub App auth -- validates credentials and fetches app slug.
// Crashes the process if credentials are invalid (fail-fast).
const githubApp = createGitHubApp(config, logger);
await githubApp.initialize();

const app = new Hono();

// Mount routes
app.route("/webhooks", createWebhookRoutes({ config, logger, dedup, githubApp }));
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
