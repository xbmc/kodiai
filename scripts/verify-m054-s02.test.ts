import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m054-s02.ts";
import {
  M054_S02_CHECK_IDS,
  buildM054S02ProofHarness,
  evaluateM054S02HistoricalFolders,
  parseM054S02Args,
  renderM054S02Report,
} from "./verify-m054-s02.ts";

function requireLastPathSegment(filePath: string): string {
  const segment = filePath.split("/").at(-1);
  if (segment == null) {
    throw new Error(`Missing trailing path segment for: ${filePath}`);
  }
  return segment;
}

const EXPECTED_CHECK_IDS = [
  "M054-S02-HISTORICAL-INVENTORY-M035-M042",
  "M054-S02-HISTORICAL-INVENTORY-M043",
  "M054-S02-PACKAGE-SCRIPT-WIRING",
] as const;

describe("verify m054 s02 historical folder harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M054_S02_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM054S02Args([])).toEqual({ json: false });
    expect(parseM054S02Args(["--json"])).toEqual({ json: true });
    expect(() => parseM054S02Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the repaired M035-M043 historical folder contract", async () => {
    const report = await evaluateM054S02HistoricalFolders({
      generatedAt: "2026-04-21T06:10:00.000Z",
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({
            scripts: {
              "verify:m054:s02": "bun scripts/verify-m054-s02.ts",
            },
          });
        }

        const normalized = filePath.replace(/\\/g, "/");
        const match = normalized.match(/\/(M0\d{2})\/\1-(.+)$/);
        if (!match) {
          throw new Error(`Unexpected file path: ${filePath}`);
        }

        const milestoneId = match[1];
        const suffix = match[2];
        if (milestoneId == null || suffix == null) {
          throw new Error(`Unexpected file path groups: ${filePath}`);
        }

        if (milestoneId === "M043") {
          if (["CONTEXT.md", "ROADMAP.md", "SUMMARY.md", "VALIDATION.md"].includes(suffix)) {
            return `${milestoneId} ${suffix} content`;
          }
          throw new Error(`Unexpected M043 file: ${suffix}`);
        }

        if (["CONTEXT-DRAFT.md", "CONTEXT.md", "SUMMARY.md"].includes(suffix)) {
          return `${milestoneId} ${suffix} content`;
        }

        throw new Error(`Unexpected repaired milestone file: ${suffix}`);
      },
      listTopLevelFiles: async (milestoneDir: string) => {
        const milestoneId = requireLastPathSegment(milestoneDir);
        if (milestoneId === "M043") {
          return [
            "M043-CONTEXT.md",
            "M043-ROADMAP.md",
            "M043-SUMMARY.md",
            "M043-VALIDATION.md",
          ];
        }

        return [
          `${milestoneId}-CONTEXT-DRAFT.md`,
          `${milestoneId}-CONTEXT.md`,
          `${milestoneId}-SUMMARY.md`,
        ];
      },
    });

    expect(report.command).toBe("verify:m054:s02");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M054-S02-HISTORICAL-INVENTORY-M035-M042",
        passed: true,
        status_code: "historical_inventory_ok",
      }),
      expect.objectContaining({
        id: "M054-S02-HISTORICAL-INVENTORY-M043",
        passed: true,
        status_code: "historical_inventory_ok",
      }),
      expect.objectContaining({
        id: "M054-S02-PACKAGE-SCRIPT-WIRING",
        passed: true,
        status_code: "package_script_wiring_ok",
      }),
    ]);

    const rendered = renderM054S02Report(report);
    expect(rendered).toContain("Historical folder proof surface: PASS");
    expect(rendered).toContain("M054-S02-HISTORICAL-INVENTORY-M035-M042 PASS");
    expect(rendered).toContain("M054-S02-HISTORICAL-INVENTORY-M043 PASS");
    expect(rendered).toContain("M054-S02-PACKAGE-SCRIPT-WIRING PASS");
  });

  test("fails with named status codes for inventory drift, unreadable files, and script mismatch", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM054S02ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({
            scripts: {
              "verify:m054:s02": "bun scripts/not-the-canonical-path.ts",
            },
          });
        }

        const normalized = filePath.replace(/\\/g, "/");
        if (normalized.endsWith("/M035/M035-CONTEXT.md")) {
          throw new Error("EACCES: M035-CONTEXT.md");
        }

        return `${normalized} content`;
      },
      listTopLevelFiles: async (milestoneDir: string) => {
        const milestoneId = requireLastPathSegment(milestoneDir);
        if (milestoneId === "M043") {
          return [
            "M043-CONTEXT.md",
            "M043-SUMMARY.md",
            "M043-VALIDATION.md",
          ];
        }

        return [
          `${milestoneId}-CONTEXT.md`,
          `${milestoneId}-SUMMARY.md`,
          `${milestoneId}-UNEXPECTED.md`,
        ];
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M054-S02-HISTORICAL-INVENTORY-M035-M042",
        passed: false,
        status_code: "historical_inventory_drift",
      }),
      expect.objectContaining({
        id: "M054-S02-HISTORICAL-INVENTORY-M043",
        passed: false,
        status_code: "historical_inventory_drift",
      }),
      expect.objectContaining({
        id: "M054-S02-PACKAGE-SCRIPT-WIRING",
        passed: false,
        status_code: "package_script_wiring_mismatch",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain("M035");
    expect(report.checks[0]?.detail).toContain("M035-UNEXPECTED.md");
    expect(report.checks[0]?.detail).toContain("EACCES: M035-CONTEXT.md");
    expect(report.checks[1]?.detail).toContain("M043");
    expect(report.checks[1]?.detail).toContain("missing: M043-ROADMAP.md");
    expect(stderr.join(" ")).toContain("historical_inventory_drift");
    expect(stderr.join(" ")).toContain("package_script_wiring_mismatch");
  });

  test("surfaces stable malformed-input and unreadable-package failures", async () => {
    const malformedPackage = await evaluateM054S02HistoricalFolders({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return "{ not valid json";
        }

        return `${filePath} content`;
      },
      listTopLevelFiles: async (milestoneDir: string) => {
        const milestoneId = requireLastPathSegment(milestoneDir);
        if (milestoneId === "M043") {
          return [
            "M043-CONTEXT.md",
            "M043-ROADMAP.md",
            "M043-SUMMARY.md",
            "M043-VALIDATION.md",
          ];
        }

        return [
          `${milestoneId}-CONTEXT-DRAFT.md`,
          `${milestoneId}-CONTEXT.md`,
          `${milestoneId}-SUMMARY.md`,
        ];
      },
    });

    expect(malformedPackage.checks[2]).toEqual(
      expect.objectContaining({
        id: "M054-S02-PACKAGE-SCRIPT-WIRING",
        passed: false,
        status_code: "package_json_malformed",
      }),
    );

    const unreadableInventory = await evaluateM054S02HistoricalFolders({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({
            scripts: {
              "verify:m054:s02": "bun scripts/verify-m054-s02.ts",
            },
          });
        }

        return `${filePath} content`;
      },
      listTopLevelFiles: async (milestoneDir: string) => {
        if (milestoneDir.endsWith("/M043")) {
          throw new Error("EACCES: M043 directory");
        }

        const milestoneId = requireLastPathSegment(milestoneDir);
        return [
          `${milestoneId}-CONTEXT-DRAFT.md`,
          `${milestoneId}-CONTEXT.md`,
          `${milestoneId}-SUMMARY.md`,
        ];
      },
    });

    expect(unreadableInventory.checks[1]).toEqual(
      expect.objectContaining({
        id: "M054-S02-HISTORICAL-INVENTORY-M043",
        passed: false,
        status_code: "historical_inventory_unreadable",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m054:s02"]).toBe(
      "bun scripts/verify-m054-s02.ts",
    );
  });
});
