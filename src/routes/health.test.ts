import { describe, expect, mock, test } from "bun:test";
import { createHealthRoutes } from "./health.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Sql } from "../db/client.ts";
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

    const app = createHealthRoutes({ sql, githubApp, logger: createMockLogger() });
    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(sql).not.toHaveBeenCalled();
    expect((githubApp.checkConnectivity as ReturnType<typeof mock>)).not.toHaveBeenCalled();
  });
});
