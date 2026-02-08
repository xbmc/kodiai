import pino from "pino";
import type { Logger } from "pino";

export type { Logger } from "pino";

export function createLogger(): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    // JSON is the default format -- no transports, no pretty-print
    // Stdout JSON only per user decision
  });
}

export function createChildLogger(
  logger: Logger,
  context: { deliveryId?: string; eventName?: string; [key: string]: unknown },
): Logger {
  return logger.child(context);
}
