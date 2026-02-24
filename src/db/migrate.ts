import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./client.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

/**
 * Apply all pending migrations in order.
 *
 * Each migration is run inside a transaction. The `_migrations` table is
 * created by 001-initial-schema.sql, so the first migration bootstraps itself
 * by catching the "table does not exist" error when checking applied state.
 */
export async function runMigrations(sql: Sql): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  // Check which migrations are already applied (bootstrap-safe)
  let applied: Set<string>;
  try {
    const rows = await sql`SELECT name FROM _migrations`;
    applied = new Set(rows.map((r) => r.name as string));
  } catch {
    // _migrations table doesn't exist yet -- first run
    applied = new Set();
  }

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip: ${file} (already applied)`);
      continue;
    }

    const filePath = join(MIGRATIONS_DIR, file);
    const sqlContent = readFileSync(filePath, "utf-8");

    console.log(`  apply: ${file}`);

    await sql.begin(async (tx) => {
      await tx.unsafe(sqlContent);

      // Record migration (table now exists after first migration runs)
      // Use unsafe() because TransactionSql's Omit<> strips call signatures
      await tx.unsafe("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    });
  }

  console.log("Migrations complete.");
}

/**
 * Roll back applied migrations to a target version number.
 *
 * Migrations with a numeric prefix greater than `targetVersion` are reverted
 * in descending order using their paired `.down.sql` files.
 *
 * Pass `targetVersion = 0` to roll back everything.
 */
export async function runRollback(
  sql: Sql,
  targetVersion: number,
): Promise<void> {
  const rows = await sql`SELECT id, name FROM _migrations ORDER BY id DESC`;

  if (rows.length === 0) {
    console.log("No migrations to roll back.");
    return;
  }

  for (const row of rows) {
    const name = row.name as string;
    const versionStr = name.match(/^(\d+)/)?.[1];
    if (!versionStr) {
      console.log(`  skip: ${name} (no version prefix)`);
      continue;
    }

    const version = parseInt(versionStr, 10);
    if (version <= targetVersion) {
      break;
    }

    const downFile = name.replace(/\.sql$/, ".down.sql");
    const downPath = join(MIGRATIONS_DIR, downFile);

    let downSql: string;
    try {
      downSql = readFileSync(downPath, "utf-8");
    } catch {
      throw new Error(
        `Missing rollback file: ${downFile} (required to roll back ${name})`,
      );
    }

    console.log(`  rollback: ${name}`);

    await sql.begin(async (tx) => {
      // Delete the migration record before running the down SQL,
      // because the down SQL for migration 001 drops _migrations itself.
      await tx.unsafe("DELETE FROM _migrations WHERE name = $1", [name]);
      await tx.unsafe(downSql);
    });
  }

  console.log("Rollback complete.");
}

// ── CLI entry point ──────────────────────────────────────────────────────────
// Usage:
//   bun run src/db/migrate.ts              # apply all pending migrations
//   bun run src/db/migrate.ts up           # same as above
//   bun run src/db/migrate.ts down <version>  # rollback to version N (0 = all)
//
if (import.meta.main) {
  const { createDbClient } = await import("./client.ts");
  const pino = await import("pino");
  const logger = pino.default({ level: "info" });

  const client = createDbClient({ logger });
  const subcommand = process.argv[2] ?? "up";

  try {
    if (subcommand === "up") {
      await runMigrations(client.sql);
    } else if (subcommand === "down") {
      const target = parseInt(process.argv[3] ?? "", 10);
      if (Number.isNaN(target) || target < 0) {
        console.error("Usage: bun run src/db/migrate.ts down <version>");
        console.error("  version: target migration version (0 = roll back everything)");
        process.exit(1);
      }
      await runRollback(client.sql, target);
    } else {
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error("Usage: bun run src/db/migrate.ts [up | down <version>]");
      process.exit(1);
    }
  } finally {
    await client.close();
  }
}
