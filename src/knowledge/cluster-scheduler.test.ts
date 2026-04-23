import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import type { Logger } from "pino";

function createMockLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  } as unknown as Logger;
}

describe("createClusterScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    mock.restore();
  });

  it("continues to later repos when one pipeline run fails", async () => {
    const runClusterPipeline = mock(async ({ repo }: { repo: string }) => {
      if (repo === "xbmc/first") {
        throw new Error("repo failed");
      }
    });

    mock.module("./cluster-store.ts", () => ({
      createClusterStore: mock(() => ({ mocked: true })),
    }));
    mock.module("./cluster-pipeline.ts", () => ({
      runClusterPipeline,
    }));

    const { createClusterScheduler } = await import("./cluster-scheduler.ts");
    const logger = createMockLogger();
    const scheduler = createClusterScheduler({
      sql: {} as never,
      taskRouter: {} as never,
      logger,
      repos: ["xbmc/first", "xbmc/second"],
    });

    await scheduler.runNow();

    expect(runClusterPipeline).toHaveBeenCalledTimes(2);
    expect(runClusterPipeline.mock.calls.map((call) => call[0].repo)).toEqual([
      "xbmc/first",
      "xbmc/second",
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error), repo: "xbmc/first" },
      "Cluster pipeline failed for repo (fail-open)",
    );
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "xbmc/second" },
      "Cluster pipeline completed for repo",
    );
  });

  it("start schedules the initial run and recurring interval, and stop clears both", async () => {
    const runClusterPipeline = mock(async () => {});
    const createClusterStore = mock(() => ({ mocked: true }));
    const logger = createMockLogger();

    mock.module("./cluster-store.ts", () => ({ createClusterStore }));
    mock.module("./cluster-pipeline.ts", () => ({ runClusterPipeline }));

    const { createClusterScheduler } = await import("./cluster-scheduler.ts");
    const scheduler = createClusterScheduler({
      sql: {} as never,
      taskRouter: {} as never,
      logger,
      repos: ["xbmc/one"],
    });

    scheduler.start();
    scheduler.start();
    expect(vi.getTimerCount()).toBe(1);
    expect(logger.debug).toHaveBeenCalledWith(
      "Cluster scheduler already started, skipping duplicate start",
    );

    vi.advanceTimersByTime(120_000);
    await Promise.resolve();
    expect(runClusterPipeline).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    scheduler.stop();
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(createClusterStore).toHaveBeenCalledTimes(1);
  });

  it("runNow handles an empty repo list without invoking the pipeline", async () => {
    const runClusterPipeline = mock(async () => {});

    mock.module("./cluster-store.ts", () => ({
      createClusterStore: mock(() => ({ mocked: true })),
    }));
    mock.module("./cluster-pipeline.ts", () => ({ runClusterPipeline }));

    const { createClusterScheduler } = await import("./cluster-scheduler.ts");
    const scheduler = createClusterScheduler({
      sql: {} as never,
      taskRouter: {} as never,
      logger: createMockLogger(),
      repos: [],
    });

    await expect(scheduler.runNow()).resolves.toBeUndefined();
    expect(runClusterPipeline).not.toHaveBeenCalled();
  });
});
