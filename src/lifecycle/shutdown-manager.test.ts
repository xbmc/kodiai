import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { RequestTracker } from "./types.ts";
import { createShutdownManager } from "./shutdown-manager.ts";

function createTestLogger(): Logger {
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
  return logger as unknown as Logger & { _entries: typeof entries };
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
});
