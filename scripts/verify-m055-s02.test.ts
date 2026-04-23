import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m055-s02.ts";
import {
  M055_S02_CHECK_IDS,
  buildM055S02ProofHarness,
  evaluateM055S02DocsTruth,
  parseM055S02Args,
  renderM055S02Report,
} from "./verify-m055-s02.ts";

const EXPECTED_CHECK_IDS = [
  "M055-S02-LICENSE-CONTRACT",
  "M055-S02-CONTRIBUTING-PLANNING",
  "M055-S02-CONTRIBUTING-MIGRATIONS",
  "M055-S02-CONTRIBUTING-VERIFICATION",
  "M055-S02-PACKAGE-WIRING",
] as const;

const PASSING_LICENSE = `KodiAI
Copyright (c) 2026 KodiAI contributors
Proprietary.
All rights reserved.

This repository and all associated source code, documentation, assets, and configuration files are proprietary.
No license or other right to use, copy, modify, merge, publish, distribute, sublicense, sell, or create derivative works from this repository is granted except through prior written permission from the repository owner.

If you submit a pull request, patch, issue text, documentation change, code sample, or other contribution to this repository, you represent that you have the necessary rights to submit that material. Unless a separate written agreement says otherwise, you agree that the repository owner may use, modify, adapt, and distribute your submitted contribution as part of this repository and its related materials without any additional obligation to you. Submission of a contribution does not, by itself, transfer ownership of your underlying copyright except to the extent required by separate written agreement.
`;

const PASSING_CONTRIBUTING = `# Contributing to KodiAI

KodiAI uses checked-in .gsd/ artifacts to make roadmap, slice, and task intent explicit.

Current checked-in examples use the naming hierarchy M###, S##, and T##.

Typical artifact layout:
- .gsd/milestones/M051/M051-ROADMAP.md
- .gsd/milestones/M051/slices/S01/S01-PLAN.md
- .gsd/milestones/M051/slices/S01/tasks/T01-SUMMARY.md
- .gsd/DECISIONS.md
- .gsd/REQUIREMENTS.md

Migration behavior should match the code in src/db/migrate.ts.
Rollbacks use bun run src/db/migrate.ts down <version> semantics and require a paired .down.sql file.
If a new migration intentionally does not have a rollback file, treat that as an explicit exception.
Do **not** assume every historical migration already meets the paired-file rule.

The repository uses a mix of broad and targeted proof commands.
Run bun test and bunx tsc --noEmit when typed runtime surfaces change.
Targeted verifier commands such as verify:*, verify:m053, verify:m054:s01, and verify:m055:s01 should also be run when applicable.
See .github/workflows/ci.yml for the current CI verification contract.
`;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "verify:m055:s02": "bun scripts/verify-m055-s02.ts",
    },
  },
  null,
  2,
);

describe("verify m055 s02 docs truth harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M055_S02_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM055S02Args([])).toEqual({ json: false });
    expect(parseM055S02Args(["--json"])).toEqual({ json: true });
    expect(() => parseM055S02Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the current docs truth contract", async () => {
    const report = await evaluateM055S02DocsTruth({
      generatedAt: "2026-04-21T07:00:00.000Z",
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("LICENSE")) return PASSING_LICENSE;
        if (filePath.endsWith("CONTRIBUTING.md")) return PASSING_CONTRIBUTING;
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.command).toBe("verify:m055:s02");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M055-S02-LICENSE-CONTRACT",
        passed: true,
        status_code: "license_contract_ok",
      }),
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-PLANNING",
        passed: true,
        status_code: "contributing_planning_markers_ok",
      }),
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-MIGRATIONS",
        passed: true,
        status_code: "contributing_migration_markers_ok",
      }),
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-VERIFICATION",
        passed: true,
        status_code: "contributing_verification_markers_ok",
      }),
      expect.objectContaining({
        id: "M055-S02-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
    ]);

    const rendered = renderM055S02Report(report);
    expect(rendered).toContain("Docs contract proof surface: PASS");
    expect(rendered).toContain("M055-S02-LICENSE-CONTRACT PASS");
    expect(rendered).toContain("M055-S02-CONTRIBUTING-PLANNING PASS");
    expect(rendered).toContain("M055-S02-CONTRIBUTING-MIGRATIONS PASS");
    expect(rendered).toContain("M055-S02-CONTRIBUTING-VERIFICATION PASS");
    expect(rendered).toContain("M055-S02-PACKAGE-WIRING PASS");
  });

  test("fails with named status codes for drifted docs and missing package wiring", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM055S02ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("LICENSE")) {
          return PASSING_LICENSE.replace("All rights reserved.", "Some rights reserved.");
        }
        if (filePath.endsWith("CONTRIBUTING.md")) {
          return PASSING_CONTRIBUTING
            .replace(".gsd/", "planning artifacts")
            .replace(".down.sql", "rollback SQL")
            .replace("bunx tsc --noEmit", "tsc");
        }
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({ name: "kodiai", scripts: {} });
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M055-S02-LICENSE-CONTRACT",
        passed: false,
        status_code: "license_contract_missing",
      }),
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-PLANNING",
        passed: true,
        status_code: "contributing_planning_markers_ok",
      }),
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-MIGRATIONS",
        passed: false,
        status_code: "contributing_migration_markers_missing",
      }),
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-VERIFICATION",
        passed: false,
        status_code: "contributing_verification_markers_missing",
      }),
      expect.objectContaining({
        id: "M055-S02-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain("All rights reserved.");
    expect(report.checks[1]?.detail).toContain(".gsd artifact model");
    expect(report.checks[2]?.detail).toContain(".down.sql");
    expect(report.checks[3]?.detail).toContain("bunx tsc --noEmit");
    expect(report.checks[4]?.detail).toContain("verify:m055:s02");
    expect(stderr.join(" ")).toContain("license_contract_missing");
    expect(stderr.join(" ")).not.toContain("contributing_planning_markers_missing");
    expect(stderr.join(" ")).toContain("contributing_migration_markers_missing");
    expect(stderr.join(" ")).toContain("contributing_verification_markers_missing");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
  });

  test("surfaces stable malformed-input and unreadable-file failures", async () => {
    const malformedInputs = await evaluateM055S02DocsTruth({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("LICENSE")) return "KodiAI\nProprietary.\n";
        if (filePath.endsWith("CONTRIBUTING.md")) return "# Contributing\n\nNo current workflow markers here.\n";
        if (filePath.endsWith("package.json")) return "{ not valid json";
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(malformedInputs.checks[0]).toEqual(
      expect.objectContaining({
        id: "M055-S02-LICENSE-CONTRACT",
        passed: false,
        status_code: "license_contract_missing",
      }),
    );
    expect(malformedInputs.checks[1]).toEqual(
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-PLANNING",
        passed: false,
        status_code: "contributing_planning_markers_missing",
      }),
    );
    expect(malformedInputs.checks[2]).toEqual(
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-MIGRATIONS",
        passed: false,
        status_code: "contributing_migration_markers_missing",
      }),
    );
    expect(malformedInputs.checks[3]).toEqual(
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-VERIFICATION",
        passed: false,
        status_code: "contributing_verification_markers_missing",
      }),
    );
    expect(malformedInputs.checks[4]).toEqual(
      expect.objectContaining({
        id: "M055-S02-PACKAGE-WIRING",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );

    const unreadableLicense = await evaluateM055S02DocsTruth({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("LICENSE")) throw new Error("EACCES: LICENSE");
        if (filePath.endsWith("CONTRIBUTING.md")) return PASSING_CONTRIBUTING;
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(unreadableLicense.checks[0]).toEqual(
      expect.objectContaining({
        id: "M055-S02-LICENSE-CONTRACT",
        passed: false,
        status_code: "license_file_unreadable",
      }),
    );

    const unreadableContributing = await evaluateM055S02DocsTruth({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("LICENSE")) return PASSING_LICENSE;
        if (filePath.endsWith("CONTRIBUTING.md")) throw new Error("EACCES: CONTRIBUTING.md");
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(unreadableContributing.checks[1]).toEqual(
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-PLANNING",
        passed: false,
        status_code: "contributing_file_unreadable",
      }),
    );
    expect(unreadableContributing.checks[2]).toEqual(
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-MIGRATIONS",
        passed: false,
        status_code: "contributing_file_unreadable",
      }),
    );
    expect(unreadableContributing.checks[3]).toEqual(
      expect.objectContaining({
        id: "M055-S02-CONTRIBUTING-VERIFICATION",
        passed: false,
        status_code: "contributing_file_unreadable",
      }),
    );

    const unreadablePackage = await evaluateM055S02DocsTruth({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("LICENSE")) return PASSING_LICENSE;
        if (filePath.endsWith("CONTRIBUTING.md")) return PASSING_CONTRIBUTING;
        if (filePath.endsWith("package.json")) throw new Error("EACCES: package.json");
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(unreadablePackage.checks[4]).toEqual(
      expect.objectContaining({
        id: "M055-S02-PACKAGE-WIRING",
        passed: false,
        status_code: "package_file_unreadable",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m055:s02"]).toBe(
      "bun scripts/verify-m055-s02.ts",
    );
  });
});
