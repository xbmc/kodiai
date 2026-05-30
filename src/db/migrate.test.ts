import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "./migrate.ts";

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
      data: { migrationId: "001", status: "skipped" },
      message: "Database migration skipped because it is already applied",
    });
    expect(JSON.stringify(infoEntries).toLowerCase()).not.toContain("timeout");
    expect(infoEntries.at(-1)).toEqual({
      data: { migrationCount: migrationFiles.length },
      message: "Database migrations complete",
    });
  });
});
