import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations, runRollback } from "./migrate.ts";
import type { Sql } from "./client.ts";
import { toProductionLogMigrationLabel } from "../review-audit/production-log-projection.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

describe("runMigrations logging", () => {
  test("writes structured logger entries instead of console output when a logger is provided", async () => {
    const migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
      .sort();
    const consoleMessages: unknown[][] = [];
    const runtimeConsole = globalThis["console"];
    const originalConsoleLog = runtimeConsole.log;
    const infoEntries: Array<{ data: unknown; message: string }> = [];
    runtimeConsole.log = (...args: unknown[]) => {
      consoleMessages.push(args);
    };

    try {
      const sql = Object.assign(
        async () => migrationFiles.map((name) => ({ name })),
        {
          begin: async () => {
            throw new Error("all migrations should already be applied");
          },
        },
      );

      await runMigrations(sql as never, {
        logger: {
          info: (data: unknown, message: string) => {
            infoEntries.push({ data, message });
          },
        },
      });
    } finally {
      runtimeConsole.log = originalConsoleLog;
    }

    expect(consoleMessages).toEqual([]);
    expect(infoEntries).toContainEqual({
      data: { migrationId: "001", migrationLabel: "001-initial-schema", status: "skipped" },
      message: "Database migration skipped because it is already applied",
    });
    expect(JSON.stringify(infoEntries).toLowerCase()).not.toContain("timeout");
    expect(infoEntries.at(-1)).toEqual({
      data: { migrationCount: migrationFiles.length },
      message: "Database migrations complete",
    });
  });
});

describe("runMigrations apply and rollback transactions", () => {
  type SqlHarness = {
    sql: Sql;
    committedTransactions: Array<Array<{ statement: string; params: unknown[] | undefined }>>;
    beginAttempts: () => number;
  };

  async function makeMigrationDir(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "kodiai-migrations-test-"));
    await Promise.all(
      Object.entries(files).map(([name, content]) =>
        writeFile(join(dir, name), content, "utf-8"),
      ),
    );
    return dir;
  }

  function createMigrationSqlHarness(options: {
    appliedFiles?: string[];
    rollbackRows?: Array<{ id: number; name: string }>;
    onUnsafe?: (statement: string, params?: unknown[]) => void;
  }): SqlHarness {
    const appliedFiles = new Set(options.appliedFiles ?? []);
    const committedTransactions: SqlHarness["committedTransactions"] = [];
    let attempts = 0;

    const sql = Object.assign(
      async (strings: TemplateStringsArray) => {
        const text = Array.from(strings).join("");
        if (text.includes("SELECT name FROM _migrations")) {
          return [...appliedFiles].map((name) => ({ name }));
        }
        if (text.includes("SELECT id, name FROM _migrations ORDER BY id DESC")) {
          return options.rollbackRows ?? [];
        }
        return [];
      },
      {
        begin: async (callback: (tx: { unsafe: (statement: string, params?: unknown[]) => Promise<void> }) => Promise<void>) => {
          attempts++;
          const staged: Array<{ statement: string; params: unknown[] | undefined }> = [];
          await callback({
            unsafe: async (statement: string, params?: unknown[]) => {
              options.onUnsafe?.(statement, params);
              staged.push({ statement, params });
            },
          });
          committedTransactions.push(staged);
        },
      },
    ) as unknown as Sql;

    return {
      sql,
      committedTransactions,
      beginAttempts: () => attempts,
    };
  }

  test("applies pending migrations in sorted order inside transactions", async () => {
    const migrationsDir = await makeMigrationDir({
      "001-applied.sql": "select 1;",
      "002-second.sql": "select 2;",
      "003-third.sql": "select 3;",
    });
    const pendingFiles = ["002-second.sql", "003-third.sql"];
    const harness = createMigrationSqlHarness({ appliedFiles: ["001-applied.sql"] });
    const infoEntries: Array<{ data: unknown; message: string }> = [];

    try {
      await runMigrations(harness.sql, {
        migrationsDir,
        logger: {
          info: (data: unknown, message: string) => {
            infoEntries.push({ data, message });
          },
        },
      });

      expect(harness.committedTransactions).toHaveLength(2);
      expect(harness.committedTransactions.map((tx) => tx[1]?.params?.[0])).toEqual(pendingFiles);
      expect(harness.committedTransactions[0]?.[0]?.statement).toBe("select 2;");
      expect(harness.committedTransactions[1]?.[0]?.statement).toBe("select 3;");
      expect(infoEntries.filter((entry) => entry.message === "Applying database migration").map((entry) => entry.data)).toEqual(
        pendingFiles.map((file) => ({
          migrationId: file.match(/^(\d+)/)?.[1],
          migrationLabel: toProductionLogMigrationLabel(file),
          status: "applying",
        })),
      );
    } finally {
      await rm(migrationsDir, { recursive: true, force: true });
    }
  });

  test("does not commit staged migration work or continue when a migration fails", async () => {
    const migrationsDir = await makeMigrationDir({
      "001-applied.sql": "select 1;",
      "002-failing.sql": "select 2;",
      "003-not-run.sql": "select 3;",
    });
    const pendingFiles = ["002-failing.sql", "003-not-run.sql"];
    const harness = createMigrationSqlHarness({
      appliedFiles: ["001-applied.sql"],
      onUnsafe: (statement) => {
        if (statement.includes("INSERT INTO _migrations")) {
          throw new Error("insert failed");
        }
      },
    });

    try {
      await expect(runMigrations(harness.sql, {
        migrationsDir,
        logger: { info: () => undefined },
      })).rejects.toThrow("insert failed");

      expect(harness.beginAttempts()).toBe(1);
      expect(harness.committedTransactions).toEqual([]);
      expect(pendingFiles).toHaveLength(2);
    } finally {
      await rm(migrationsDir, { recursive: true, force: true });
    }
  });

  test("rolls back applied migrations in descending order using paired down files", async () => {
    const migrationsDir = await makeMigrationDir({
      "001-base.sql": "select 1;",
      "002-keep.sql": "select 2;",
      "003-rollback.sql": "select 3;",
      "003-rollback.down.sql": "select down 3;",
    });
    const rolledBackFile = "003-rollback.sql";
    const harness = createMigrationSqlHarness({
      rollbackRows: [
        { id: 3, name: "003-rollback.sql" },
        { id: 2, name: "002-keep.sql" },
      ],
    });

    const runtimeConsole = globalThis["console"];
    const originalConsoleLog = runtimeConsole.log;
    runtimeConsole.log = () => undefined;

    try {
      await runRollback(harness.sql, 2, { migrationsDir });
    } finally {
      runtimeConsole.log = originalConsoleLog;
      await rm(migrationsDir, { recursive: true, force: true });
    }

    expect(harness.committedTransactions).toEqual([
      [
        { statement: "DELETE FROM _migrations WHERE name = $1", params: [rolledBackFile] },
        {
          statement: "select down 3;",
          params: undefined,
        },
      ],
    ]);
  });
});
