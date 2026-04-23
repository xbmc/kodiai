import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m059-s02.ts";
import {
  M059_S02_CHECK_IDS,
  buildM059S02ProofHarness,
  evaluateM059S02Proof,
  parseM059S02Args,
  renderM059S02Report,
} from "./verify-m059-s02.ts";

const EXPECTED_CHECK_IDS = [
  "M059-S02-APPENDIX-COVERAGE",
  "M059-S02-RETAINED-TRUTH",
  "M059-S02-REMOVAL-TRUTH",
  "M059-S02-PACKAGE-WIRING",
] as const;

const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m059-s02.ts";
const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "verify:m059:s02": EXPECTED_PACKAGE_SCRIPT,
    },
  },
  null,
  2,
);

const PASSING_REGISTRY = `# Script Registry

This document is the canonical inventory for tracked files under \`scripts/\`.

Scope: every tracked \`scripts/*.ts\`, \`scripts/*.test.ts\`, and \`scripts/*.sh\` file must appear exactly once in the table below.

Usage contract:
- Use \`package:<name>\` for package-script entrypoints from \`package.json\`.
- Use \`workflow:<path>#<command>\` for direct workflow commands.
- Use \`none\` only when no package-script or direct workflow command references the file.
- \`.sh\` helpers and wrappers are represented inline as first-class rows; they are not implied by a separate appendix.

Lifecycle vocabulary:
- \`active\` — current operational or verification surface.
- \`internal\` — repo-local helper, test, or maintenance surface not intended as a primary operator entrypoint.
- \`deprecated\` — retained compatibility surface that should not gain new callers.
- \`sunset\` — retained only for bounded removal or historical verification.

| path | purpose | owner | lifecycle | usage |
| --- | --- | --- | --- | --- |
| scripts/keep-me.ts | Retained orphan script. | M059 | active | none |
| scripts/verify-m059-s02.ts | S02 verifier. | M059 | active | package:verify:m059:s02 |

## S02 Orphan Audit

| path | disposition | rationale |
| --- | --- | --- |
| scripts/keep-me.ts | retained | Keep for explicit one-off operator recovery flow. |
| scripts/remove-me.ts | removed | Removed from the repo after the audit. |
`;

describe("verify m059 s02 proof harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M059_S02_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM059S02Args([])).toEqual({ json: false });
    expect(parseM059S02Args(["--json"])).toEqual({ json: true });
    expect(() => parseM059S02Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes when every usage none registry row has a truthful orphan-audit disposition and package wiring matches", async () => {
    const report = await evaluateM059S02Proof({
      generatedAt: "2026-04-21T16:00:00.000Z",
      listTrackedScriptFiles: async () => ["scripts/keep-me.ts", "scripts/verify-m059-s02.ts"],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) return PASSING_REGISTRY;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.command).toBe("verify:m059:s02");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M059-S02-APPENDIX-COVERAGE",
        passed: true,
        status_code: "appendix_coverage_ok",
      }),
      expect.objectContaining({
        id: "M059-S02-RETAINED-TRUTH",
        passed: true,
        status_code: "retained_truth_ok",
      }),
      expect.objectContaining({
        id: "M059-S02-REMOVAL-TRUTH",
        passed: true,
        status_code: "removal_truth_ok",
      }),
      expect.objectContaining({
        id: "M059-S02-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
    ]);

    const rendered = renderM059S02Report(report);
    expect(rendered).toContain("M059 S02 orphan audit verifier");
    expect(rendered).toContain("Orphan audit proof surface: PASS");
    expect(rendered).toContain("M059-S02-APPENDIX-COVERAGE PASS");
  });

  test("flags missing orphan-audit entries for live usage none rows", async () => {
    const report = await evaluateM059S02Proof({
      listTrackedScriptFiles: async () => ["scripts/keep-me.ts", "scripts/verify-m059-s02.ts"],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) {
          return PASSING_REGISTRY.replace(
            "| scripts/keep-me.ts | retained | Keep for explicit one-off operator recovery flow. |\n",
            "",
          );
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M059-S02-APPENDIX-COVERAGE",
        passed: false,
        status_code: "orphan_audit_missing_row",
      }),
    );
    expect(report.checks[0]?.detail).toContain("scripts/keep-me.ts");
  });

  test("flags malformed appendix rows", async () => {
    const report = await evaluateM059S02Proof({
      listTrackedScriptFiles: async () => ["scripts/keep-me.ts", "scripts/verify-m059-s02.ts"],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) {
          return PASSING_REGISTRY.replace(
            "| scripts/remove-me.ts | removed | Removed from the repo after the audit. |",
            "| scripts/remove-me.ts | retained | |",
          );
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M059-S02-APPENDIX-COVERAGE",
        passed: false,
        status_code: "orphan_audit_malformed",
      }),
    );
  });

  test("flags stale deleted rows left in the main registry table", async () => {
    const report = await evaluateM059S02Proof({
      listTrackedScriptFiles: async () => ["scripts/keep-me.ts", "scripts/verify-m059-s02.ts"],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) {
          return PASSING_REGISTRY.replace(
            "| scripts/verify-m059-s02.ts | S02 verifier. | M059 | active | package:verify:m059:s02 |",
            "| scripts/remove-me.ts | Deleted orphan script. | M059 | sunset | none |\n| scripts/verify-m059-s02.ts | S02 verifier. | M059 | active | package:verify:m059:s02 |",
          );
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[2]).toEqual(
      expect.objectContaining({
        id: "M059-S02-REMOVAL-TRUTH",
        passed: false,
        status_code: "orphan_removal_stale_registry_row",
      }),
    );
  });

  test("flags removed appendix entries that still resolve to live tracked files", async () => {
    const report = await evaluateM059S02Proof({
      listTrackedScriptFiles: async () => ["scripts/keep-me.ts", "scripts/remove-me.ts", "scripts/verify-m059-s02.ts"],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) return PASSING_REGISTRY;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[2]).toEqual(
      expect.objectContaining({
        id: "M059-S02-REMOVAL-TRUTH",
        passed: false,
        status_code: "orphan_removed_file_still_exists",
      }),
    );
    expect(report.checks[2]?.detail).toContain("scripts/remove-me.ts");
  });

  test("flags appendix entries that lie about retained vs removed state", async () => {
    const report = await evaluateM059S02Proof({
      listTrackedScriptFiles: async () => ["scripts/keep-me.ts", "scripts/verify-m059-s02.ts"],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) {
          return PASSING_REGISTRY
            .replace(
              "| scripts/keep-me.ts | retained | Keep for explicit one-off operator recovery flow. |",
              "| scripts/keep-me.ts | removed | Claimed removed even though the file still exists. |",
            )
            .replace(
              "| scripts/remove-me.ts | removed | Removed from the repo after the audit. |",
              "| scripts/remove-me.ts | retained | Claimed retained even though the file is gone. |",
            );
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[1]).toEqual(
      expect.objectContaining({
        id: "M059-S02-RETAINED-TRUTH",
        passed: false,
        status_code: "orphan_retained_missing_file",
      }),
    );
    expect(report.checks[2]).toEqual(
      expect.objectContaining({
        id: "M059-S02-REMOVAL-TRUTH",
        passed: false,
        status_code: "orphan_removed_file_still_exists",
      }),
    );
  });

  test("flags missing or incorrect package wiring", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM059S02ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      listTrackedScriptFiles: async () => ["scripts/keep-me.ts", "scripts/verify-m059-s02.ts"],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({
            name: "kodiai",
            scripts: {
              "verify:m059:s02": "bun scripts/not-the-right-file.ts",
            },
          });
        }
        if (filePath.endsWith("scripts/REGISTRY.md")) return PASSING_REGISTRY;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.checks[3]).toEqual(
      expect.objectContaining({
        id: "M059-S02-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_incorrect",
      }),
    );
    expect(stderr.join(" ")).toContain("package_wiring_incorrect");
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m059:s02"]).toBe(
      "bun scripts/verify-m059-s02.ts",
    );
  });
});
