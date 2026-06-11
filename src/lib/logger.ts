import pino from "pino";
import type { Logger } from "pino";

export type { Logger } from "pino";

type SanitizedLogError = {
  type?: string;
  message?: string;
  code?: string | number;
  status?: number;
  statusCode?: number;
};

function readRecordField(source: Record<string, unknown>, key: string): unknown {
  return source[key];
}

function copyStringOrNumber(
  target: SanitizedLogError,
  targetKey: keyof SanitizedLogError,
  source: Record<string, unknown>,
  sourceKey: string,
): void {
  const value = readRecordField(source, sourceKey);
  if (typeof value === "string" || typeof value === "number") {
    (target as Record<string, string | number | undefined>)[targetKey] = value;
  }
}

function copyNumber(
  target: SanitizedLogError,
  targetKey: keyof SanitizedLogError,
  source: Record<string, unknown>,
  sourceKey: string,
): void {
  const value = readRecordField(source, sourceKey);
  if (typeof value === "number" && Number.isFinite(value)) {
    (target as Record<string, string | number | undefined>)[targetKey] = value;
  }
}

export function sanitizeLogError(err: unknown): SanitizedLogError {
  if (err instanceof Error) {
    const source = err as Error & Record<string, unknown>;
    const sanitized: SanitizedLogError = {
      type: err.name,
      message: err.message,
    };
    copyStringOrNumber(sanitized, "code", source, "code");
    copyNumber(sanitized, "status", source, "status");
    copyNumber(sanitized, "statusCode", source, "statusCode");
    return sanitized;
  }

  if (typeof err === "object" && err !== null && !Array.isArray(err)) {
    const source = err as Record<string, unknown>;
    const sanitized: SanitizedLogError = {};
    copyStringOrNumber(sanitized, "type", source, "name");
    copyStringOrNumber(sanitized, "message", source, "message");
    copyStringOrNumber(sanitized, "code", source, "code");
    copyNumber(sanitized, "status", source, "status");
    copyNumber(sanitized, "statusCode", source, "statusCode");
    return sanitized;
  }

  return { message: String(err) };
}

export function createLogger(): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    serializers: {
      err: sanitizeLogError,
    },
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
