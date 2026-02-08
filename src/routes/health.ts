import { Hono } from "hono";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";

interface HealthRouteDeps {
  githubApp: GitHubApp;
  logger: Logger;
}

export function createHealthRoutes(deps: HealthRouteDeps): Hono {
  const { githubApp, logger } = deps;
  const app = new Hono();

  // Liveness probe: always 200 if the server process is running
  app.get("/health", (c) => {
    return c.json({ status: "ok" });
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
