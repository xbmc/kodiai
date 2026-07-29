import { describe, expect, mock, test } from "bun:test";
import { createHealthRoutes } from "./health.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Sql } from "../db/client.ts";
import type { RequestTracker } from "../lifecycle/types.ts";
import type { Logger } from "pino";

function createMockLogger(): Logger {
  return {
    debug: mock(() => undefined),
    info: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
    child: mock(() => createMockLogger()),
  } as unknown as Logger;
}

function createFakeRequestTracker(counts: { requests: number; jobs: number } = { requests: 0, jobs: 0 }): RequestTracker {
  return {
    trackRequest: () => () => undefined,
    trackJob: () => () => undefined,
    activeCount: () => ({ requests: counts.requests, jobs: counts.jobs, total: counts.requests + counts.jobs }),
    waitForDrain: async () => undefined,
  };
}

describe("createHealthRoutes", () => {
  test("/healthz is process-only and does not wait on PostgreSQL or GitHub", async () => {
    const sql = mock(async () => {
      throw new Error("db should not be called by liveness");
    }) as unknown as Sql;
    const githubApp = {
      checkConnectivity: mock(async () => {
        throw new Error("github should not be called by liveness");
      }),
    } as unknown as GitHubApp;

    const app = createHealthRoutes({ sql, githubApp, logger: createMockLogger(), requestTracker: createFakeRequestTracker() });
    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(sql).not.toHaveBeenCalled();
    expect((githubApp.checkConnectivity as ReturnType<typeof mock>)).not.toHaveBeenCalled();
  });

  test("/readiness stays ready when GitHub connectivity is transiently unavailable", async () => {
    const logger = createMockLogger();
    const sql = mock(async () => []) as unknown as Sql;
    const githubApp = {
      checkConnectivity: mock(async () => false),
    } as unknown as GitHubApp;

    const app = createHealthRoutes({ sql, githubApp, logger, requestTracker: createFakeRequestTracker() });
    const response = await app.request("/readiness");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ready",
      github: "degraded",
      reason: "GitHub API unreachable",
    });
    expect(logger.info).toHaveBeenCalledWith(
      { githubConnectivity: "degraded" },
      "Readiness dependency degraded: GitHub API unreachable",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("/readiness has a bounded GitHub connectivity check", async () => {
    const logger = createMockLogger();
    const sql = mock(async () => []) as unknown as Sql;
    const githubApp = {
      checkConnectivity: mock(() => new Promise<boolean>(() => undefined)),
    } as unknown as GitHubApp;

    const app = createHealthRoutes({
      sql,
      githubApp,
      logger,
      requestTracker: createFakeRequestTracker(),
      readinessDependencyTimeoutMs: 1,
    });
    const response = await app.request("/readiness");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ready",
      github: "degraded",
      reason: "GitHub API connectivity check timed out",
    });
    expect(logger.info).toHaveBeenCalledWith(
      { githubConnectivity: "latency-budget-exceeded", budgetMs: 1 },
      "Readiness dependency degraded: GitHub API connectivity latency budget exceeded",
    );
    const serializedLogCall = JSON.stringify((logger.info as ReturnType<typeof mock>).mock.calls).toLowerCase();
    expect(serializedLogCall).not.toContain("timeout");
    expect(serializedLogCall).not.toContain("timed out");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("/readiness logs dependency errors without failed/error textual matches", async () => {
    const logger = createMockLogger();
    const sql = mock(async () => []) as unknown as Sql;
    const githubApp = {
      checkConnectivity: mock(async () => {
        throw new Error("network unavailable");
      }),
    } as unknown as GitHubApp;

    const app = createHealthRoutes({ sql, githubApp, logger, requestTracker: createFakeRequestTracker() });
    const response = await app.request("/readiness");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ready",
      github: "degraded",
      reason: "GitHub API connectivity check degraded",
    });
    expect(logger.info).toHaveBeenCalledWith(
      {
        githubConnectivity: "degraded",
        dependencyIssueName: "exception",
        dependencyIssueMessage: "network unavailable",
      },
      "Readiness dependency degraded: GitHub API connectivity check degraded",
    );
    const serializedLogCall = JSON.stringify((logger.info as ReturnType<typeof mock>).mock.calls).toLowerCase();
    expect(serializedLogCall).not.toContain("failed");
    expect(serializedLogCall).not.toContain("error");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("/internal/drain-status reports zero when idle so a deploy can proceed", async () => {
    const sql = mock(async () => []) as unknown as Sql;
    const githubApp = { checkConnectivity: mock(async () => true) } as unknown as GitHubApp;

    const app = createHealthRoutes({
      sql,
      githubApp,
      logger: createMockLogger(),
      requestTracker: createFakeRequestTracker({ requests: 0, jobs: 0 }),
    });
    const response = await app.request("/internal/drain-status");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activeRequests: 0, activeJobs: 0, activeTotal: 0 });
  });

  test("/internal/drain-status reports in-flight jobs so a deploy waits instead of killing them", async () => {
    const sql = mock(async () => []) as unknown as Sql;
    const githubApp = { checkConnectivity: mock(async () => true) } as unknown as GitHubApp;

    const app = createHealthRoutes({
      sql,
      githubApp,
      logger: createMockLogger(),
      requestTracker: createFakeRequestTracker({ requests: 1, jobs: 9 }),
    });
    const response = await app.request("/internal/drain-status");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activeRequests: 1, activeJobs: 9, activeTotal: 10 });
  });
});
