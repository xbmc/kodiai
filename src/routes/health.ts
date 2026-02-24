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
  const { githubApp, logger, sql } = deps;
  const app = new Hono();

  // Liveness probe: checks process is up AND PostgreSQL connection pool is healthy
  app.get("/healthz", async (c) => {
    try {
      await sql`SELECT 1`;
      return c.json({ status: "ok", db: "connected" });
    } catch (err) {
      logger.warn({ err }, "Health check failed: PostgreSQL unreachable");
      return c.json({ status: "unhealthy", db: "unreachable" }, 503);
    }
  });

  // Backward-compatible alias for /healthz during deploy transition
  app.get("/health", async (c) => {
    try {
      await sql`SELECT 1`;
      return c.json({ status: "ok", db: "connected" });
    } catch (err) {
      logger.warn({ err }, "Health check failed: PostgreSQL unreachable");
      return c.json({ status: "unhealthy", db: "unreachable" }, 503);
    }
  });

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
