import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { JobSnapshot } from "../jobs/types.ts";
import type { RequestTracker } from "./types.ts";
import { createShutdownManager } from "./shutdown-manager.ts";

function createJobSnapshot(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    jobId: "1-1",
    installationId: 1,
    lane: "review",
    key: "acme/widgets#42",
    jobType: "pull-request-review",
    prNumber: 42,
    phase: "running",
    queuedAtMs: 0,
    lastProgressAtMs: 0,
    ...overrides,
  };
}

type TestLogger = Logger & { _entries: Array<{ level: string; bindings: Record<string, unknown>; message: string }> };

function createTestLogger(): TestLogger {
  const entries: Array<{ level: string; bindings: Record<string, unknown>; message: string }> = [];
  const logger = {
    info: (bindings: Record<string, unknown>, message: string) => {
      entries.push({ level: "info", bindings, message });
    },
    warn: (bindings: Record<string, unknown>, message: string) => {
      entries.push({ level: "warn", bindings, message });
    },
    error: (bindings: Record<string, unknown>, message: string) => {
      entries.push({ level: "error", bindings, message });
    },
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
    _entries: entries,
  };
  return logger as unknown as TestLogger;
}

function createRequestTracker(waitForDrain: RequestTracker["waitForDrain"]): RequestTracker {
  return {
    trackRequest: () => () => undefined,
    trackJob: () => () => undefined,
    activeCount: () => ({ requests: 0, jobs: 0, total: 0 }),
    waitForDrain,
  };
}

describe("createShutdownManager", () => {
  test("requestShutdown is idempotent and drains before exiting", async () => {
    let exitCode: number | undefined;
    const waitForDrain = mock(async () => undefined);
    const closeDb = mock(async () => undefined);
    const logger = createTestLogger();
    const manager = createShutdownManager({
      logger,
      requestTracker: createRequestTracker(waitForDrain),
      closeDb,
      graceMs: 5,
      __exitForTests: (code) => {
        exitCode = code;
      },
    });

    manager.requestShutdown("uncaughtException");
    manager.requestShutdown("uncaughtException");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(waitForDrain).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(0);
    expect(logger._entries.some((entry) => entry.message === "Fatal runtime fault received, starting graceful shutdown")).toBe(true);
  });

  test("requestShutdown force-exits when extended drain times out", async () => {
    let exitCode: number | undefined;
    const waitForDrain = mock(async () => {
      throw new Error("drain-timeout");
    });
    const closeDb = mock(async () => undefined);
    const logger = createTestLogger();
    const manager = createShutdownManager({
      logger,
      requestTracker: createRequestTracker(waitForDrain),
      closeDb,
      graceMs: 1,
      __exitForTests: (code) => {
        exitCode = code;
      },
    });

    manager.requestShutdown("unhandledRejection");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(waitForDrain).toHaveBeenCalledTimes(2);
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(1);
  });

  test("successful drain never calls the abandoned-job notifier", async () => {
    const waitForDrain = mock(async () => undefined);
    const closeDb = mock(async () => undefined);
    const notifyAbandonedJobs = mock(async () => undefined);
    const getAbandonedJobs = mock(() => [createJobSnapshot()]);
    const manager = createShutdownManager({
      logger: createTestLogger(),
      requestTracker: createRequestTracker(waitForDrain),
      closeDb,
      graceMs: 5,
      getAbandonedJobs,
      notifyAbandonedJobs,
      __exitForTests: () => undefined,
    });

    manager.requestShutdown("uncaughtException");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(notifyAbandonedJobs).not.toHaveBeenCalled();
  });

  test("force-exit after extended drain timeout notifies abandoned jobs before exiting", async () => {
    let exitCode: number | undefined;
    const waitForDrain = mock(async () => {
      throw new Error("drain-timeout");
    });
    const closeDb = mock(async () => undefined);
    const abandonedJobs = [createJobSnapshot({ jobId: "1-1" }), createJobSnapshot({ jobId: "1-2", prNumber: 7, key: "acme/widgets#7" })];
    const getAbandonedJobs = mock(() => abandonedJobs);
    const notifyOrder: string[] = [];
    const notifyAbandonedJobs = mock(async (jobs: JobSnapshot[]) => {
      expect(jobs).toEqual(abandonedJobs);
      notifyOrder.push("notify");
    });
    const manager = createShutdownManager({
      logger: createTestLogger(),
      requestTracker: createRequestTracker(waitForDrain),
      closeDb,
      graceMs: 1,
      getAbandonedJobs,
      notifyAbandonedJobs,
      __exitForTests: (code) => {
        exitCode = code;
        notifyOrder.push("exit");
      },
    });

    manager.requestShutdown("unhandledRejection");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getAbandonedJobs).toHaveBeenCalled();
    expect(notifyAbandonedJobs).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(1);
    // The notice must be sent before the process actually exits.
    expect(notifyOrder).toEqual(["notify", "exit"]);
  });

  test("immediate force-exit (grace budget already exhausted) also notifies abandoned jobs", async () => {
    let exitCode: number | undefined;
    const waitForDrain = mock(async () => {
      throw new Error("drain-timeout");
    });
    const closeDb = mock(async () => undefined);
    const abandonedJobs = [createJobSnapshot()];
    const getAbandonedJobs = mock(() => abandonedJobs);
    const notifyAbandonedJobs = mock(async () => undefined);
    const manager = createShutdownManager({
      logger: createTestLogger(),
      requestTracker: createRequestTracker(waitForDrain),
      closeDb,
      // graceMs >= maxTotalGraceMs means extendedGraceMs computes to 0, so the
      // first timeout goes straight to the "grace budget exhausted" branch.
      graceMs: 10,
      maxTotalGraceMs: 10,
      getAbandonedJobs,
      notifyAbandonedJobs,
      __exitForTests: (code) => {
        exitCode = code;
      },
    });

    manager.requestShutdown("unhandledRejection");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(waitForDrain).toHaveBeenCalledTimes(1);
    expect(notifyAbandonedJobs).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(1);
  });

  test("a failing notifier does not block force-exit", async () => {
    let exitCode: number | undefined;
    const waitForDrain = mock(async () => {
      throw new Error("drain-timeout");
    });
    const closeDb = mock(async () => undefined);
    const logger = createTestLogger();
    const notifyAbandonedJobs = mock(async () => {
      throw new Error("github unreachable");
    });
    const manager = createShutdownManager({
      logger,
      requestTracker: createRequestTracker(waitForDrain),
      closeDb,
      graceMs: 1,
      getAbandonedJobs: () => [createJobSnapshot()],
      notifyAbandonedJobs,
      __exitForTests: (code) => {
        exitCode = code;
      },
    });

    manager.requestShutdown("unhandledRejection");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(notifyAbandonedJobs).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(logger._entries.some((entry) => entry.message === "notifyAbandonedJobs failed (continuing to exit)")).toBe(true);
  });

  test("no active jobs skips calling the notifier", async () => {
    const waitForDrain = mock(async () => {
      throw new Error("drain-timeout");
    });
    const closeDb = mock(async () => undefined);
    const notifyAbandonedJobs = mock(async () => undefined);
    const manager = createShutdownManager({
      logger: createTestLogger(),
      requestTracker: createRequestTracker(waitForDrain),
      closeDb,
      graceMs: 1,
      getAbandonedJobs: () => [],
      notifyAbandonedJobs,
      __exitForTests: () => undefined,
    });

    manager.requestShutdown("unhandledRejection");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(notifyAbandonedJobs).not.toHaveBeenCalled();
  });
});
