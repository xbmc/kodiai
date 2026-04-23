import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { CheckerReport } from "./check-migrations-have-downs.ts";
import {
  CHECK_MIGRATIONS_HAVE_DOWNS_CHECK_IDS,
  buildCheckMigrationsHaveDownsHarness,
  evaluateMigrationPairing,
  parseCheckMigrationsHaveDownsArgs,
  renderCheckMigrationsHaveDownsReport,
} from "./check-migrations-have-downs.ts";

const EXPECTED_CHECK_IDS = [
  "MIGRATIONS-DIR-STATE",
  "MIGRATION-ALLOWLIST-STATE",
  "MIGRATION-PAIRS",
  "PACKAGE-WIRING",
] as const;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "check:migrations-have-downs": "bun scripts/check-migrations-have-downs.ts",
    },
  },
  null,
  2,
);

describe("check migrations have downs", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(CHECK_MIGRATIONS_HAVE_DOWNS_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseCheckMigrationsHaveDownsArgs([])).toEqual({ json: false });
    expect(parseCheckMigrationsHaveDownsArgs(["--json"])).toEqual({ json: true });
    expect(() => parseCheckMigrationsHaveDownsArgs(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for a fully paired migration set with an empty allowlist and canonical package wiring", async () => {
    const report = await evaluateMigrationPairing({
      generatedAt: "2026-04-21T09:00:00.000Z",
      readDir: async () => [
        "001-init.sql",
        "001-init.down.sql",
        "002-users.sql",
        "002-users.down.sql",
      ],
      readPackageJson: async () => PASSING_PACKAGE_JSON,
      readTextFile: async () => "-- ok\n",
      allowlistEntries: [],
    });

    expect(report.command).toBe("check:migrations-have-downs");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "MIGRATIONS-DIR-STATE",
        passed: true,
        status_code: "migrations_dir_ok",
      }),
      expect.objectContaining({
        id: "MIGRATION-ALLOWLIST-STATE",
        passed: true,
        status_code: "allowlist_empty",
      }),
      expect.objectContaining({
        id: "MIGRATION-PAIRS",
        passed: true,
        status_code: "all_rollbacks_present",
      }),
      expect.objectContaining({
        id: "PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
    ]);

    const rendered = renderCheckMigrationsHaveDownsReport(report);
    expect(rendered).toContain("Migration rollback sibling gate: PASS");
    expect(rendered).toContain("MIGRATIONS-DIR-STATE PASS");
    expect(rendered).toContain("MIGRATION-ALLOWLIST-STATE PASS");
    expect(rendered).toContain("MIGRATION-PAIRS PASS");
    expect(rendered).toContain("PACKAGE-WIRING PASS");
  });

  test("fails with stable status codes for missing rollback siblings, malformed allowlist entries, and package drift", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildCheckMigrationsHaveDownsHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readDir: async () => [
        "001-init.sql",
        "001-init.down.sql",
        "002-users.sql",
        "README.md",
      ],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("001-init.down.sql")) {
          return "-- ok\n";
        }
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      },
      readPackageJson: async () => JSON.stringify({ name: "kodiai", scripts: {} }),
      allowlistEntries: [
        {
          migration: "002-users.sql",
          rationale: "legacy exception",
        },
        {
          migration: "999-missing.sql",
          rationale: "stale entry",
        },
      ],
    });

    const report = JSON.parse(stdout.join("")) as CheckerReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "MIGRATIONS-DIR-STATE",
        passed: true,
        status_code: "migrations_dir_ok",
      }),
      expect.objectContaining({
        id: "MIGRATION-ALLOWLIST-STATE",
        passed: false,
        status_code: "allowlist_entry_missing_forward_migration",
      }),
      expect.objectContaining({
        id: "MIGRATION-PAIRS",
        passed: false,
        status_code: "rollback_missing",
      }),
      expect.objectContaining({
        id: "PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
    ]);
    expect(report.checks[1]?.detail).toContain("999-missing.sql");
    expect(report.checks[2]?.detail).toContain("002-users.sql");
    expect(report.checks[3]?.detail).toContain("check:migrations-have-downs");
    expect(stderr.join(" ")).toContain("allowlist_entry_missing_forward_migration");
    expect(stderr.join(" ")).toContain("rollback_missing");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
  });

  test("fails closed for unreadable directory state, invalid package json, duplicate allowlist entries, unreadable migration files, and malformed allowlist rationale", async () => {
    const dirUnreadable = await evaluateMigrationPairing({
      readDir: async () => {
        throw new Error("EACCES: src/db/migrations");
      },
      readPackageJson: async () => PASSING_PACKAGE_JSON,
      allowlistEntries: [],
    });

    expect(dirUnreadable.checks[0]).toEqual(
      expect.objectContaining({
        id: "MIGRATIONS-DIR-STATE",
        passed: false,
        status_code: "migrations_dir_unreadable",
      }),
    );
    expect(dirUnreadable.checks[2]).toEqual(
      expect.objectContaining({
        id: "MIGRATION-PAIRS",
        passed: false,
        status_code: "migrations_scan_unavailable",
      }),
    );

    const malformedInputs = await evaluateMigrationPairing({
      readDir: async () => [
        "001-init.sql",
        "001-init.down.sql",
        "002-users.sql",
        "002-users.down.sql",
      ],
      readPackageJson: async () => "{ nope",
      allowlistEntries: [
        {
          migration: "002-users.sql",
          rationale: "valid rationale",
        },
        {
          migration: "002-users.sql",
          rationale: "duplicate",
        },
      ],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("002-users.down.sql")) {
          throw new Error("EACCES: 002-users.down.sql");
        }
        return "-- ok\n";
      },
    });

    expect(malformedInputs.checks[1]).toEqual(
      expect.objectContaining({
        id: "MIGRATION-ALLOWLIST-STATE",
        passed: false,
        status_code: "allowlist_duplicate_migration",
      }),
    );
    expect(malformedInputs.checks[1]?.detail).toContain("002-users.sql");
    expect(malformedInputs.checks[2]).toEqual(
      expect.objectContaining({
        id: "MIGRATION-PAIRS",
        passed: false,
        status_code: "rollback_file_unreadable",
      }),
    );
    expect(malformedInputs.checks[2]?.detail).toContain("002-users.down.sql");
    expect(malformedInputs.checks[3]).toEqual(
      expect.objectContaining({
        id: "PACKAGE-WIRING",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );

    const malformedRationale = await evaluateMigrationPairing({
      readDir: async () => [
        "001-init.sql",
        "001-init.down.sql",
      ],
      readPackageJson: async () => PASSING_PACKAGE_JSON,
      readTextFile: async () => "-- ok\n",
      allowlistEntries: [
        {
          migration: "001-init.sql",
          rationale: "",
        },
      ],
    });

    expect(malformedRationale.checks[1]).toEqual(
      expect.objectContaining({
        id: "MIGRATION-ALLOWLIST-STATE",
        passed: false,
        status_code: "allowlist_rationale_invalid",
      }),
    );
  });

  test("uses the same forward-file discovery rule as src/db/migrate.ts and ignores non-sql files plus .down.sql entries", async () => {
    const report = await evaluateMigrationPairing({
      readDir: async () => [
        "001-init.sql",
        "001-init.down.sql",
        "002-users.sql",
        "002-users.down.sql",
        "notes.txt",
        "nested",
      ],
      readPackageJson: async () => PASSING_PACKAGE_JSON,
      readTextFile: async () => "-- ok\n",
      allowlistEntries: [],
    });

    const pairCheck = report.checks.find((check) => check.id === "MIGRATION-PAIRS");
    expect(pairCheck?.passed).toBe(true);
    expect(pairCheck?.detail).toContain("001-init.sql -> 001-init.down.sql");
    expect(pairCheck?.detail).toContain("002-users.sql -> 002-users.down.sql");
    expect(pairCheck?.detail).not.toContain("001-init.down.sql ->");
    expect(pairCheck?.detail).not.toContain("notes.txt");
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["check:migrations-have-downs"]).toBe(
      "bun scripts/check-migrations-have-downs.ts",
    );
  });
});
