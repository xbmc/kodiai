import type { Logger } from "pino";
import type { ShutdownManager } from "./types.ts";

function toUnhandledRejectionLogFields(reason: unknown): { err: Error } | { reason: unknown } {
  return reason instanceof Error ? { err: reason } : { reason };
}

export function registerFatalShutdownHandlers(params: {
  logger: Logger;
  shutdownManager: ShutdownManager;
}): void {
  process.on("uncaughtException", (err) => {
    params.logger.fatal({ err }, "uncaughtException");
    params.shutdownManager.requestShutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    params.logger.fatal(toUnhandledRejectionLogFields(reason), "unhandledRejection");
    params.shutdownManager.requestShutdown("unhandledRejection");
  });
}
