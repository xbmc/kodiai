import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport, RuntimeResult } from "./verify-m056-s02.ts";
import {
  M056_S02_CHECK_IDS,
  buildM056S02ProofHarness,
  evaluateM056S02RollbackContract,
  parseM056S02Args,
  renderM056S02Report,
} from "./verify-m056-s02.ts";

const EXPECTED_CHECK_IDS = [
  "M056-S02-ROLLBACK-FILES",
  "M056-S02-SLOT-030",
  "M056-S02-PACKAGE-WIRING",
  "M056-S02-DATABASE-ACCESS",
  "M056-S02-ROLLBACK-ROUNDTRIP",
] as const;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "verify:m056:s02": "bun scripts/verify-m056-s02.ts",
    },
  },
  null,
  2,
);

const REQUIRED_DOWN_FILES = [
  "src/db/migrations/033-canonical-code-corpus.down.sql",
  "src/db/migrations/034-review-graph.down.sql",
  "src/db/migrations/035-generated-rules.down.sql",
  "src/db/migrations/036-suggestion-cluster-models.down.sql",
] as const;

const REQUIRED_SLOT_030_FILES = [
  "src/db/migrations/030-reserved.sql",
  "src/db/migrations/030-reserved.down.sql",
] as const;

describe("verify m056 s02 rollback contract harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M056_S02_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM056S02Args([])).toEqual({ json: false });
    expect(parseM056S02Args(["--json"])).toEqual({ json: true });
    expect(() => parseM056S02Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes when rollback files, slot 030, package wiring, db access, and runtime checks succeed", async () => {
    const report = await evaluateM056S02RollbackContract({
      generatedAt: "2026-04-21T09:00:00.000Z",
      env: { TEST_DATABASE_URL: "postgres://test-db" },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("030-reserved.sql")) {
          return "-- reserved slot 030 up migration; intentionally schema-neutral\n";
        }
        if (filePath.endsWith("030-reserved.down.sql")) {
          return "-- reserved slot 030 down migration; intentionally schema-neutral\n";
        }
        if (filePath.endsWith(".down.sql")) {
          return "DROP TABLE IF EXISTS sample;\n";
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
      runRuntimeRoundTrip: async ({ connectionString }) => {
        expect(connectionString).toBe("postgres://test-db");
        return {
          ok: true,
          status_code: "rollback_roundtrip_ok",
          detail:
            "All targeted tables existed after migrate-up, disappeared after rollback to 32, and returned after re-apply.",
        } satisfies RuntimeResult;
      },
    });

    expect(report.command).toBe("verify:m056:s02");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M056-S02-ROLLBACK-FILES",
        passed: true,
        status_code: "rollback_files_ok",
      }),
      expect.objectContaining({
        id: "M056-S02-SLOT-030",
        passed: true,
        status_code: "slot_030_ok",
      }),
      expect.objectContaining({
        id: "M056-S02-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
      expect.objectContaining({
        id: "M056-S02-DATABASE-ACCESS",
        passed: true,
        status_code: "database_url_ok",
      }),
      expect.objectContaining({
        id: "M056-S02-ROLLBACK-ROUNDTRIP",
        passed: true,
        status_code: "rollback_roundtrip_ok",
      }),
    ]);

    const rendered = renderM056S02Report(report);
    expect(rendered).toContain("Rollback proof surface: PASS");
    expect(rendered).toContain("M056-S02-ROLLBACK-FILES PASS");
    expect(rendered).toContain("M056-S02-SLOT-030 PASS");
    expect(rendered).toContain("M056-S02-PACKAGE-WIRING PASS");
    expect(rendered).toContain("M056-S02-DATABASE-ACCESS PASS");
    expect(rendered).toContain("M056-S02-ROLLBACK-ROUNDTRIP PASS");
  });

  test("fails with stable status codes for missing rollback files, ambiguous slot 030, package drift, and missing db access", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM056S02ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      env: {},
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({ name: "kodiai", scripts: {} });
        }
        if (filePath.endsWith("033-canonical-code-corpus.down.sql")) {
          throw new Error("ENOENT: missing");
        }
        if (filePath.endsWith("030-reserved.down.sql")) {
          throw new Error("ENOENT: missing");
        }
        return "-- present\n";
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M056-S02-ROLLBACK-FILES",
        passed: false,
        status_code: "rollback_files_missing",
      }),
      expect.objectContaining({
        id: "M056-S02-SLOT-030",
        passed: false,
        status_code: "slot_030_ambiguous",
      }),
      expect.objectContaining({
        id: "M056-S02-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
      expect.objectContaining({
        id: "M056-S02-DATABASE-ACCESS",
        passed: false,
        status_code: "database_url_missing",
      }),
      expect.objectContaining({
        id: "M056-S02-ROLLBACK-ROUNDTRIP",
        passed: false,
        status_code: "database_url_missing",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain(REQUIRED_DOWN_FILES[0]);
    expect(report.checks[1]?.detail).toContain(REQUIRED_SLOT_030_FILES[1]);
    expect(report.checks[2]?.detail).toContain("verify:m056:s02");
    expect(report.checks[3]?.detail).toContain("TEST_DATABASE_URL");
    expect(report.checks[4]?.detail).toContain("runtime check skipped");
    expect(stderr.join(" ")).toContain("rollback_files_missing");
    expect(stderr.join(" ")).toContain("slot_030_ambiguous");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
    expect(stderr.join(" ")).toContain("database_url_missing");
  });

  test("surfaces invalid json, unreadable slot files, runtime schema drift, and thrown db access failures", async () => {
    const invalidPackage = await evaluateM056S02RollbackContract({
      env: { DATABASE_URL: "postgres://fallback" },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return "{ not valid json";
        if (filePath.endsWith("030-reserved.sql")) {
          throw new Error("EACCES: 030-reserved.sql");
        }
        if (filePath.endsWith(".down.sql")) {
          return "DROP TABLE IF EXISTS sample;\n";
        }
        return "-- present\n";
      },
      runRuntimeRoundTrip: async () => ({
        ok: false,
        status_code: "rollback_roundtrip_schema_drift",
        detail: "Still present after rollback to 32: canonical_code_chunks, review_graph_builds",
      }),
    });

    expect(invalidPackage.checks[0]).toEqual(
      expect.objectContaining({
        id: "M056-S02-ROLLBACK-FILES",
        passed: true,
        status_code: "rollback_files_ok",
      }),
    );
    expect(invalidPackage.checks[1]).toEqual(
      expect.objectContaining({
        id: "M056-S02-SLOT-030",
        passed: false,
        status_code: "slot_030_unreadable",
      }),
    );
    expect(invalidPackage.checks[2]).toEqual(
      expect.objectContaining({
        id: "M056-S02-PACKAGE-WIRING",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );
    expect(invalidPackage.checks[3]).toEqual(
      expect.objectContaining({
        id: "M056-S02-DATABASE-ACCESS",
        passed: true,
        status_code: "database_url_ok",
      }),
    );
    expect(invalidPackage.checks[4]).toEqual(
      expect.objectContaining({
        id: "M056-S02-ROLLBACK-ROUNDTRIP",
        passed: false,
        status_code: "rollback_roundtrip_schema_drift",
      }),
    );
    expect(invalidPackage.checks[4]?.detail).toContain("rollback to 32");

    const runtimeError = await evaluateM056S02RollbackContract({
      env: { DATABASE_URL: "postgres://fallback" },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("030-reserved.sql")) {
          return "-- reserved\n";
        }
        if (filePath.endsWith("030-reserved.down.sql")) {
          return "-- reserved\n";
        }
        return "DROP TABLE IF EXISTS sample;\n";
      },
      runRuntimeRoundTrip: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      },
    });

    expect(runtimeError.checks[4]).toEqual(
      expect.objectContaining({
        id: "M056-S02-ROLLBACK-ROUNDTRIP",
        passed: false,
        status_code: "database_access_failed",
      }),
    );
    expect(runtimeError.checks[4]?.detail).toContain("ECONNREFUSED");
  });

  test("prefers TEST_DATABASE_URL over DATABASE_URL for the runtime round trip", async () => {
    let observedConnectionString = "";

    const report = await evaluateM056S02RollbackContract({
      env: {
        TEST_DATABASE_URL: "postgres://preferred-db",
        DATABASE_URL: "postgres://fallback-db",
      },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("030-reserved.sql")) {
          return "-- reserved\n";
        }
        if (filePath.endsWith("030-reserved.down.sql")) {
          return "-- reserved\n";
        }
        return "DROP TABLE IF EXISTS sample;\n";
      },
      runRuntimeRoundTrip: async ({ connectionString }) => {
        observedConnectionString = connectionString;
        return {
          ok: true,
          status_code: "rollback_roundtrip_ok",
          detail: "preferred test database used",
        } satisfies RuntimeResult;
      },
    });

    expect(observedConnectionString).toBe("postgres://preferred-db");
    expect(report.checks[3]).toEqual(
      expect.objectContaining({
        id: "M056-S02-DATABASE-ACCESS",
        passed: true,
        status_code: "database_url_ok",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m056:s02"]).toBe(
      "bun scripts/verify-m056-s02.ts",
    );
  });
});
