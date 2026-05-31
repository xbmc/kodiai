import { Hono } from "hono";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Sql } from "../db/client.ts";

interface HealthRouteDeps {
  githubApp: GitHubApp;
  logger: Logger;
  sql: Sql;
  readinessDependencyTimeoutMs?: number;
}

type GitHubConnectivityResult =
  | { kind: "connected" }
  | { kind: "unreachable" }
  | { kind: "timeout" }
  | { kind: "error"; err: unknown };

function toReadinessDependencyIssueFields(err: unknown): {
  dependencyIssueName: string;
  dependencyIssueMessage?: string;
} {
  if (err instanceof Error) {
    return {
      dependencyIssueName: err.name.toLowerCase() === "error" ? "exception" : err.name,
      ...(err.message ? { dependencyIssueMessage: err.message } : {}),
    };
  }

  if (err && typeof err === "object") {
    const maybeRecord = err as { name?: unknown; message?: unknown };
    const rawName = typeof maybeRecord.name === "string" ? maybeRecord.name : "non-error";
    return {
      dependencyIssueName: rawName.toLowerCase() === "error" ? "exception" : rawName,
      ...(typeof maybeRecord.message === "string" && maybeRecord.message
        ? { dependencyIssueMessage: maybeRecord.message }
        : {}),
    };
  }

  return { dependencyIssueName: "non-error" };
}

async function checkGitHubConnectivityWithTimeout(
  githubApp: GitHubApp,
  timeoutMs: number,
): Promise<GitHubConnectivityResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      githubApp.checkConnectivity()
        .then((connected) => connected ? { kind: "connected" as const } : { kind: "unreachable" as const })
        .catch((err) => ({ kind: "error" as const, err })),
      new Promise<GitHubConnectivityResult>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createHealthRoutes(deps: HealthRouteDeps): Hono {
  const { githubApp, logger, readinessDependencyTimeoutMs = 1_000 } = deps;
  const app = new Hono();

  // Liveness probe: process-only. Dependency checks belong in readiness/deep health
  // so transient PostgreSQL or GitHub latency does not make ACA restart a healthy process.
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  // Backward-compatible alias for /healthz during deploy transition.
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Readiness probe: process is ready to receive traffic. External dependency
  // checks are bounded and fail open as degraded so transient GitHub latency does
  // not remove healthy replicas from service.
  app.get("/readiness", async (c) => {
    const githubConnectivity = await checkGitHubConnectivityWithTimeout(
      githubApp,
      readinessDependencyTimeoutMs,
    );

    switch (githubConnectivity.kind) {
      case "connected":
        return c.json({ status: "ready" });
      case "unreachable":
        logger.info(
          { githubConnectivity: "degraded" },
          "Readiness dependency degraded: GitHub API unreachable",
        );
        return c.json({
          status: "ready",
          github: "degraded",
          reason: "GitHub API unreachable",
        });
      case "timeout":
        logger.info(
          { githubConnectivity: "latency-budget-exceeded", budgetMs: readinessDependencyTimeoutMs },
          "Readiness dependency degraded: GitHub API connectivity latency budget exceeded",
        );
        return c.json({
          status: "ready",
          github: "degraded",
          reason: "GitHub API connectivity check timed out",
        });
      case "error":
        logger.info(
          {
            githubConnectivity: "degraded",
            ...toReadinessDependencyIssueFields(githubConnectivity.err),
          },
          "Readiness dependency degraded: GitHub API connectivity check degraded",
        );
        return c.json({
          status: "ready",
          github: "degraded",
          reason: "GitHub API connectivity check degraded",
        });
    }
  });

  return app;
}
