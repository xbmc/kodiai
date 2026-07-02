import postgres from "postgres";
import type { Logger } from "pino";

export type Sql = ReturnType<typeof postgres>;

export type DbClient = {
  sql: Sql;
  close(): Promise<void>;
};

function positiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultValue;
}

/**
 * Create a postgres.js client connected via DATABASE_URL or explicit connection string.
 *
 * Returns a tagged-template `sql` instance and a `close()` function.
 * Throws immediately if no connection string is available.
 */
export function createDbClient(opts: {
  connectionString?: string;
  logger: Logger;
}): DbClient {
  const connectionString =
    opts.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set and no connectionString was provided. " +
        "Set DATABASE_URL or pass connectionString to createDbClient().",
    );
  }

  const poolMax = positiveIntegerEnv("DATABASE_POOL_MAX", 10);
  const statementTimeoutMs = positiveIntegerEnv("DATABASE_STATEMENT_TIMEOUT_MS", 300_000);
  const lockTimeoutMs = positiveIntegerEnv("DATABASE_LOCK_TIMEOUT_MS", 10_000);
  const idleTransactionTimeoutMs = positiveIntegerEnv(
    "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
    120_000,
  );

  const sql = postgres(connectionString, {
    max: poolMax,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      statement_timeout: statementTimeoutMs,
      lock_timeout: lockTimeoutMs,
      idle_in_transaction_session_timeout: idleTransactionTimeoutMs,
    },
  });

  opts.logger.debug(
    { poolMax, statementTimeoutMs, lockTimeoutMs, idleTransactionTimeoutMs },
    "PostgreSQL client created",
  );

  return {
    sql,
    async close() {
      await sql.end();
      opts.logger.debug("PostgreSQL client closed");
    },
  };
}
