import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { ShutdownManager } from "./types.ts";
import { registerFatalShutdownHandlers } from "./fatal-shutdown-handlers.ts";

describe("registerFatalShutdownHandlers", () => {
  test("routes uncaughtException and unhandledRejection to graceful shutdown", () => {
    const fatal = mock((_bindings: Record<string, unknown>, _message: string) => undefined);
    const requestShutdown = mock((_reason: string) => undefined);
    const logger = {
      fatal,
      child: () => logger,
    } as unknown as Logger;
    const shutdownManager = {
      start: () => undefined,
      isShuttingDown: () => false,
      requestShutdown,
    } satisfies ShutdownManager;

    registerFatalShutdownHandlers({ logger, shutdownManager });

    const uncaught = new Error("boom");
    process.emit("uncaughtException", uncaught);
    expect(fatal).toHaveBeenCalledWith({ err: uncaught }, "uncaughtException");
    expect(requestShutdown).toHaveBeenCalledWith("uncaughtException");

    const rejection = "async-boom";
    process.emit("unhandledRejection", rejection, Promise.resolve());
    expect(fatal).toHaveBeenCalledWith({ reason: rejection }, "unhandledRejection");
    expect(requestShutdown).toHaveBeenCalledWith("unhandledRejection");
  });

  test("logs Error rejection reasons with pino err serialization", () => {
    const fatal = mock((_bindings: Record<string, unknown>, _message: string) => undefined);
    const logger = {
      fatal,
      child: () => logger,
    } as unknown as Logger;
    const shutdownManager = {
      start: () => undefined,
      isShuttingDown: () => false,
      requestShutdown: mock((_reason: string) => undefined),
    } satisfies ShutdownManager;

    registerFatalShutdownHandlers({ logger, shutdownManager });

    const rejection = new Error("async-boom");
    process.emit("unhandledRejection", rejection, Promise.resolve());

    expect(fatal).toHaveBeenCalledWith({ err: rejection }, "unhandledRejection");
  });
});
