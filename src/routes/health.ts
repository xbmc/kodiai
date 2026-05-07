import { Hono } from "hono";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Sql } from "../db/client.ts";

interface HealthRouteDeps {
  githubApp: GitHubApp;
  logger: Logger;
  sql: Sql;
}

export function createHealthRoutes(deps: HealthRouteDeps): Hono {
  const { githubApp, logger } = deps;
  const app = new Hono();

  // Liveness probe: process-only. Dependency checks belong in readiness/deep health
  // so transient PostgreSQL or GitHub latency does not make ACA restart a healthy process.
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  // Backward-compatible alias for /healthz during deploy transition.
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Readiness probe: checks GitHub API connectivity
  app.get("/readiness", async (c) => {
    const connected = await githubApp.checkConnectivity();
    if (connected) {
      return c.json({ status: "ready" });
    }

    logger.warn("Readiness check failed: GitHub API unreachable");
    return c.json(
      { status: "not ready", reason: "GitHub API unreachable" },
      503,
    );
  });

  return app;
}
