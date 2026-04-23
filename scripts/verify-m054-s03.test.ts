import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m054-s03.ts";
import {
  M054_S03_CHECK_IDS,
  buildM054S03ProofHarness,
  evaluateM054S03RecentHistory,
  parseM054S03Args,
  renderM054S03Report,
} from "./verify-m054-s03.ts";

function requireLastPathSegment(filePath: string): string {
  const segment = filePath.replace(/\\/g, "/").split("/").at(-1);
  if (segment == null) {
    throw new Error(`Missing trailing path segment for: ${filePath}`);
  }
  return segment;
}

const EXPECTED_CHECK_IDS = [
  "M054-S03-RECENT-INVENTORY-M048-M050",
  "M054-S03-RECENT-SUMMARIES-M051-M052",
  "M054-S03-M052-SLICE-TASK-SUMMARIES",
  "M054-S03-PACKAGE-SCRIPT-WIRING",
] as const;

describe("verify m054 s03 recent-history harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M054_S03_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM054S03Args([])).toEqual({ json: false });
    expect(parseM054S03Args(["--json"])).toEqual({ json: true });
    expect(() => parseM054S03Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the repaired recent-history contract", async () => {
    const report = await evaluateM054S03RecentHistory({
      generatedAt: "2026-04-21T07:05:00.000Z",
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({
            scripts: {
              "verify:m054:s03": "bun scripts/verify-m054-s03.ts",
            },
          });
        }

        return `${filePath} content`;
      },
      listTopLevelFiles: async (dirPath: string) => {
        const milestoneId = requireLastPathSegment(dirPath);
        if (["M048", "M049", "M050"].includes(milestoneId)) {
          return [
            `${milestoneId}-CONTEXT.md`,
            `${milestoneId}-SUMMARY.md`,
          ];
        }

        throw new Error(`Unexpected top-level listing request: ${dirPath}`);
      },
      listTaskSummaryFiles: async () => {
        return ["T01-SUMMARY.md", "T02-SUMMARY.md"];
      },
    });

    expect(report.command).toBe("verify:m054:s03");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M054-S03-RECENT-INVENTORY-M048-M050",
        passed: true,
        status_code: "recent_inventory_ok",
      }),
      expect.objectContaining({
        id: "M054-S03-RECENT-SUMMARIES-M051-M052",
        passed: true,
        status_code: "recent_milestone_summaries_ok",
      }),
      expect.objectContaining({
        id: "M054-S03-M052-SLICE-TASK-SUMMARIES",
        passed: true,
        status_code: "m052_slice_task_summaries_ok",
      }),
      expect.objectContaining({
        id: "M054-S03-PACKAGE-SCRIPT-WIRING",
        passed: true,
        status_code: "package_script_wiring_ok",
      }),
    ]);

    const rendered = renderM054S03Report(report);
    expect(rendered).toContain("Recent-history proof surface: PASS");
    expect(rendered).toContain("M054-S03-RECENT-INVENTORY-M048-M050 PASS");
    expect(rendered).toContain("M054-S03-RECENT-SUMMARIES-M051-M052 PASS");
    expect(rendered).toContain("M054-S03-M052-SLICE-TASK-SUMMARIES PASS");
    expect(rendered).toContain("M054-S03-PACKAGE-SCRIPT-WIRING PASS");
  });

  test("fails with named status codes for strict inventory drift, missing M052 summary surfaces, and script mismatch", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM054S03ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({
            scripts: {
              "verify:m054:s03": "bun scripts/not-the-canonical-path.ts",
            },
          });
        }

        const normalized = filePath.replace(/\\/g, "/");
        if (normalized.endsWith("/M052/slices/S03/tasks/T03-SUMMARY.md")) {
          throw new Error("EACCES: T03-SUMMARY.md");
        }

        return `${normalized} content`;
      },
      listTopLevelFiles: async (dirPath: string) => {
        const milestoneId = requireLastPathSegment(dirPath);
        if (milestoneId === "M048") {
          return ["M048-CONTEXT.md", "M048-SUMMARY.md", "M048-CONTEXT-DRAFT.md"];
        }
        if (milestoneId === "M049") {
          return ["M049-CONTEXT.md", "M049-SUMMARY.md"];
        }
        if (milestoneId === "M050") {
          return ["M050-SUMMARY.md"];
        }

        throw new Error(`Unexpected top-level listing request: ${dirPath}`);
      },
      listTaskSummaryFiles: async (sliceTaskDir: string) => {
        const normalized = sliceTaskDir.replace(/\\/g, "/");
        if (normalized.endsWith("/S01/tasks")) {
          return ["T01-SUMMARY.md"];
        }
        if (normalized.endsWith("/S02/tasks")) {
          return [];
        }
        if (normalized.endsWith("/S03/tasks")) {
          return ["T03-SUMMARY.md"];
        }

        throw new Error(`Unexpected task listing request: ${sliceTaskDir}`);
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M054-S03-RECENT-INVENTORY-M048-M050",
        passed: false,
        status_code: "recent_inventory_drift",
      }),
      expect.objectContaining({
        id: "M054-S03-RECENT-SUMMARIES-M051-M052",
        passed: true,
        status_code: "recent_milestone_summaries_ok",
      }),
      expect.objectContaining({
        id: "M054-S03-M052-SLICE-TASK-SUMMARIES",
        passed: false,
        status_code: "m052_slice_task_summaries_drift",
      }),
      expect.objectContaining({
        id: "M054-S03-PACKAGE-SCRIPT-WIRING",
        passed: false,
        status_code: "package_script_wiring_mismatch",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain("unexpected: M048-CONTEXT-DRAFT.md");
    expect(report.checks[0]?.detail).toContain("M050");
    expect(report.checks[0]?.detail).toContain("missing: M050-CONTEXT.md");
    expect(report.checks[2]?.detail).toContain("S02");
    expect(report.checks[2]?.detail).toContain("no task summary files found");
    expect(report.checks[2]?.detail).toContain("EACCES: T03-SUMMARY.md");
    expect(stderr.join(" ")).toContain("recent_inventory_drift");
    expect(stderr.join(" ")).toContain("m052_slice_task_summaries_drift");
    expect(stderr.join(" ")).toContain("package_script_wiring_mismatch");
  });

  test("surfaces stable malformed-input failures for unreadable summaries and malformed package json", async () => {
    const malformedPackage = await evaluateM054S03RecentHistory({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return "{ not valid json";
        }

        return `${filePath} content`;
      },
      listTopLevelFiles: async (dirPath: string) => {
        const milestoneId = requireLastPathSegment(dirPath);
        return [`${milestoneId}-CONTEXT.md`, `${milestoneId}-SUMMARY.md`];
      },
      listTaskSummaryFiles: async () => ["T01-SUMMARY.md"],
    });

    expect(malformedPackage.checks[3]).toEqual(
      expect.objectContaining({
        id: "M054-S03-PACKAGE-SCRIPT-WIRING",
        passed: false,
        status_code: "package_json_malformed",
      }),
    );

    const unreadableSummary = await evaluateM054S03RecentHistory({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({
            scripts: {
              "verify:m054:s03": "bun scripts/verify-m054-s03.ts",
            },
          });
        }

        const normalized = filePath.replace(/\\/g, "/");
        if (normalized.endsWith("/M051/M051-SUMMARY.md")) {
          throw new Error("EACCES: M051-SUMMARY.md");
        }

        return `${normalized} content`;
      },
      listTopLevelFiles: async (dirPath: string) => {
        const milestoneId = requireLastPathSegment(dirPath);
        return [`${milestoneId}-CONTEXT.md`, `${milestoneId}-SUMMARY.md`];
      },
      listTaskSummaryFiles: async () => ["T01-SUMMARY.md"],
    });

    expect(unreadableSummary.checks[1]).toEqual(
      expect.objectContaining({
        id: "M054-S03-RECENT-SUMMARIES-M051-M052",
        passed: false,
        status_code: "recent_milestone_summaries_unreadable",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m054:s03"]).toBe(
      "bun scripts/verify-m054-s03.ts",
    );
  });
});
