import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m054-s01.ts";
import {
  M054_S01_CHECK_IDS,
  buildM054S01ProofHarness,
  evaluateM054S01QueueTruth,
  parseM054S01Args,
  renderM054S01Report,
} from "./verify-m054-s01.ts";

const EXPECTED_CHECK_IDS = [
  "M054-S01-PENDING-QUEUE-MEMBERSHIP",
  "M054-S01-NOT-PENDING-REDIRECT",
  "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
] as const;

describe("verify m054 s01 queue truth harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M054_S01_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM054S01Args([])).toEqual({ json: false });
    expect(parseM054S01Args(["--json"])).toEqual({ json: true });
    expect(() => parseM054S01Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the current compact queue format and shipped milestone redirect contract", async () => {
    const report = await evaluateM054S01QueueTruth({
      generatedAt: "2026-04-21T04:40:00.000Z",
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("QUEUE.md")) {
          return `# Queue\n\n## Pending Milestones\n\n### M027 — Embedding Integrity\n- GitHub backlog: \`#91\`\n\n### M028 — Wiki Modification\n- GitHub backlog: \`#91\`\n\n### M029 — Wiki Generation\n- GitHub backlog: \`#91\`\n\n### M031 — Security Hardening\n- GitHub backlog: \`#91\`\n\n### M032 — Agent Process Isolation\n- GitHub backlog: \`#91\`\n\n### M053 — Unsafe new Function Removal\n- GitHub backlog: \`#92\`\n\n### M054 — Queue Repair\n- GitHub backlog: \`#93\`\n\n### M055 — Docs Pass\n- GitHub backlog: \`#94\`\n\n### M056 — Rollback Completeness\n- GitHub backlog: \`#95\`\n\n### M057 — Test Backfill\n- GitHub backlog: \`#96\`\n\n### M058 — CI Hardening\n- GitHub backlog: \`#97\`\n\n### M059 — Script Registry\n- GitHub backlog: \`#98\`\n\n### M060 — Knowledge Tests\n- GitHub backlog: \`#99\`\n\n## Not Pending\n\nCompleted milestones are tracked in \`.gsd/PROJECT.md\`. M044 through M052 are complete and are intentionally omitted from the pending queue.\n`;
        }

        return `# Kodiai\n\nMilestones M043, M044, M045, M046, M047, M051, M052, and **M053** are complete.\n`;
      },
    });

    expect(report.command).toBe("verify:m054:s01");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M054-S01-PENDING-QUEUE-MEMBERSHIP",
        passed: true,
        status_code: "pending_queue_membership_ok",
      }),
      expect.objectContaining({
        id: "M054-S01-NOT-PENDING-REDIRECT",
        passed: true,
        status_code: "not_pending_redirect_present",
      }),
      expect.objectContaining({
        id: "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
        passed: true,
        status_code: "project_shipped_alignment_ok",
      }),
    ]);

    const rendered = renderM054S01Report(report);
    expect(rendered).toContain("Queue truth proof surface: PASS");
    expect(rendered).toContain("M054-S01-PENDING-QUEUE-MEMBERSHIP PASS");
    expect(rendered).toContain("M054-S01-NOT-PENDING-REDIRECT PASS");
    expect(rendered).toContain("M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT PASS");
  });

  test("fails with named status codes for missing queue entries, stale pending milestones, and missing project redirect guidance", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM054S01ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("QUEUE.md")) {
          return `# Queue\n\n## Pending Milestones\n\n### M027 — Embedding Integrity\n### M028 — Wiki Modification\n### M029 — Wiki Generation\n### M031 — Security Hardening\n### M032 — Agent Process Isolation\n### M053 — Unsafe new Function Removal\n### M054 — Queue Repair\n### M055 — Docs Pass\n### M056 — Rollback Completeness\n### M057 — Test Backfill\n### M058 — CI Hardening\n### M059 — Script Registry\n### M044 — Already Complete\n\n## Not Pending\n\nCompleted milestones live elsewhere.\n`;
        }

        return `# Kodiai\n\nMilestones M043, M044, M045, M046, M047, M051, M052, and **M053** are complete.\n`;
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M054-S01-PENDING-QUEUE-MEMBERSHIP",
        passed: false,
        status_code: "pending_queue_membership_mismatch",
      }),
      expect.objectContaining({
        id: "M054-S01-NOT-PENDING-REDIRECT",
        passed: false,
        status_code: "not_pending_redirect_missing_project_reference",
      }),
      expect.objectContaining({
        id: "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
        passed: false,
        status_code: "project_shipped_milestone_still_pending",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain("missing: M060");
    expect(report.checks[0]?.detail).toContain("unexpected: M044");
    expect(report.checks[2]?.detail).toContain("M044");
    expect(stderr.join(" ")).toContain("pending_queue_membership_mismatch");
    expect(stderr.join(" ")).toContain("not_pending_redirect_missing_project_reference");
    expect(stderr.join(" ")).toContain("project_shipped_milestone_still_pending");
  });

  test("surfaces stable malformed-input and unreadable-file failures", async () => {
    const missingSection = await evaluateM054S01QueueTruth({
      readTextFile: async () => "# Queue\n\nNo pending milestones section here.\n",
    });
    expect(missingSection.checks[0]).toEqual(
      expect.objectContaining({
        id: "M054-S01-PENDING-QUEUE-MEMBERSHIP",
        passed: false,
        status_code: "pending_section_missing",
      }),
    );

    const unreadableProject = await evaluateM054S01QueueTruth({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("QUEUE.md")) {
          return `# Queue\n\n## Pending Milestones\n\n### M027 — Embedding Integrity\n### M028 — Wiki Modification\n### M029 — Wiki Generation\n### M031 — Security Hardening\n### M032 — Agent Process Isolation\n### M053 — Unsafe new Function Removal\n### M054 — Queue Repair\n### M055 — Docs Pass\n### M056 — Rollback Completeness\n### M057 — Test Backfill\n### M058 — CI Hardening\n### M059 — Script Registry\n### M060 — Knowledge Tests\n\n## Not Pending\n\nCompleted milestones are tracked in \`.gsd/PROJECT.md\`.\n`;
        }

        throw new Error("EACCES: PROJECT.md");
      },
    });

    expect(unreadableProject.checks[2]).toEqual(
      expect.objectContaining({
        id: "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
        passed: false,
        status_code: "project_file_unreadable",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m054:s01"]).toBe(
      "bun scripts/verify-m054-s01.ts",
    );
  });
});
