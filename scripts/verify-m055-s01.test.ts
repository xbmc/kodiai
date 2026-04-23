import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m055-s01.ts";
import {
  M055_S01_CHECK_IDS,
  buildM055S01ProofHarness,
  evaluateM055S01DocsTruth,
  parseM055S01Args,
  renderM055S01Report,
} from "./verify-m055-s01.ts";

const EXPECTED_CHECK_IDS = [
  "M055-S01-README-SHIPPED-COUNT",
  "M055-S01-README-RECENT-FEATURES",
  "M055-S01-README-NIGHTLY-WORKFLOWS",
  "M055-S01-CHANGELOG-RECENT-RELEASES",
  "M055-S01-PACKAGE-WIRING",
] as const;

const PASSING_README = `# Kodiai

Kodiai is an installable GitHub App that delivers AI-powered code review, conversational assistance, issue intelligence, and Slack integration. One installation replaces per-repo workflow YAML — configure behavior with an optional .kodiai.yml file.

31 milestones shipped (v0.1 through v0.31). See [CHANGELOG.md](CHANGELOG.md) for release history.

## Recent Shipped Milestones

- **M051 — manual rereview truthfulness:** @kodiai review is the only supported manual rereview trigger.
- **M052 — Slack webhook relay:** Kodiai can accept authenticated inbound relay payloads.
- **M053 — no dynamic evaluators in src/:** shipped code removes the committed helper that used new Function() and carries bun run verify:m053 as the durable proof command for the invariant.
- **M054 — planning-artifact truth repair:** milestone-specific verifier commands verify:m054:s01 through verify:m054:s04 are shipped.

## Nightly Workflows

Two nightly GitHub Actions keep the issue-intelligence surfaces current:

- nightly-issue-sync runs bun scripts/backfill-issues.ts --sync on a daily cron.
- nightly-reaction-sync runs bun scripts/sync-triage-reactions.ts shortly after issue sync.

Both workflows also support manual workflow_dispatch runs for testing, and any failures surface through the normal GitHub Actions workflow run status for the repository.
`;

const PASSING_CHANGELOG = `# Changelog

## v0.31 (2026-04-21)

Planning Artifact Repair.

### Added

- Milestone-specific verifier family verify:m054:s01 through verify:m054:s04 covering pending-queue truth.

## v0.30 (2026-04-21)

No-Dynamic-Evaluator Guardrail.

### Added

- bun run verify:m053 as a dedicated proof command enforcing the no-new-Function invariant under importable src code.

## v0.29 (2026-04-15)

Explicit Review Lane Hardening.
`;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "verify:m055:s01": "bun scripts/verify-m055-s01.ts",
    },
  },
  null,
  2,
);

describe("verify m055 s01 docs truth harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M055_S01_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM055S01Args([])).toEqual({ json: false });
    expect(parseM055S01Args(["--json"])).toEqual({ json: true });
    expect(() => parseM055S01Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the current docs truth contract", async () => {
    const report = await evaluateM055S01DocsTruth({
      generatedAt: "2026-04-21T06:30:00.000Z",
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("README.md")) return PASSING_README;
        if (filePath.endsWith("CHANGELOG.md")) return PASSING_CHANGELOG;
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.command).toBe("verify:m055:s01");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M055-S01-README-SHIPPED-COUNT",
        passed: true,
        status_code: "readme_shipped_count_ok",
      }),
      expect.objectContaining({
        id: "M055-S01-README-RECENT-FEATURES",
        passed: true,
        status_code: "readme_recent_features_ok",
      }),
      expect.objectContaining({
        id: "M055-S01-README-NIGHTLY-WORKFLOWS",
        passed: true,
        status_code: "readme_nightly_workflows_ok",
      }),
      expect.objectContaining({
        id: "M055-S01-CHANGELOG-RECENT-RELEASES",
        passed: true,
        status_code: "changelog_recent_releases_ok",
      }),
      expect.objectContaining({
        id: "M055-S01-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
    ]);

    const rendered = renderM055S01Report(report);
    expect(rendered).toContain("Docs truth proof surface: PASS");
    expect(rendered).toContain("M055-S01-README-SHIPPED-COUNT PASS");
    expect(rendered).toContain("M055-S01-README-RECENT-FEATURES PASS");
    expect(rendered).toContain("M055-S01-README-NIGHTLY-WORKFLOWS PASS");
    expect(rendered).toContain("M055-S01-CHANGELOG-RECENT-RELEASES PASS");
    expect(rendered).toContain("M055-S01-PACKAGE-WIRING PASS");
  });

  test("fails with named status codes for stale doc truths and missing package wiring", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM055S01ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("README.md")) {
          return PASSING_README
            .replace("31 milestones shipped (v0.1 through v0.31).", "30 milestones shipped (v0.1 through v0.30).")
            .replace("Slack webhook relay", "Slack integration")
            .replace("nightly-reaction-sync runs bun scripts/sync-triage-reactions.ts shortly after issue sync.", "Nightly workflows keep things current.");
        }
        if (filePath.endsWith("CHANGELOG.md")) {
          return `# Changelog\n\n## v0.29 (2026-04-15)\n\nExplicit Review Lane Hardening.\n`;
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
        id: "M055-S01-README-SHIPPED-COUNT",
        passed: false,
        status_code: "readme_shipped_count_stale",
      }),
      expect.objectContaining({
        id: "M055-S01-README-RECENT-FEATURES",
        passed: false,
        status_code: "readme_recent_features_missing",
      }),
      expect.objectContaining({
        id: "M055-S01-README-NIGHTLY-WORKFLOWS",
        passed: false,
        status_code: "readme_nightly_workflows_missing",
      }),
      expect.objectContaining({
        id: "M055-S01-CHANGELOG-RECENT-RELEASES",
        passed: false,
        status_code: "changelog_recent_releases_missing",
      }),
      expect.objectContaining({
        id: "M055-S01-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain("31 milestones shipped");
    expect(report.checks[1]?.detail).toContain("Slack webhook relay");
    expect(report.checks[2]?.detail).toContain("nightly-reaction-sync");
    expect(report.checks[3]?.detail).toContain("v0.30");
    expect(report.checks[3]?.detail).toContain("v0.31");
    expect(report.checks[4]?.detail).toContain("verify:m055:s01");
    expect(stderr.join(" ")).toContain("readme_shipped_count_stale");
    expect(stderr.join(" ")).toContain("readme_recent_features_missing");
    expect(stderr.join(" ")).toContain("readme_nightly_workflows_missing");
    expect(stderr.join(" ")).toContain("changelog_recent_releases_missing");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
  });

  test("surfaces stable malformed-input and unreadable-file failures", async () => {
    const missingSections = await evaluateM055S01DocsTruth({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("README.md")) return "# Kodiai\n\nNo shipped count or workflow section here.\n";
        if (filePath.endsWith("CHANGELOG.md")) return "# Changelog\n\nNo recent releases here.\n";
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(missingSections.checks[0]).toEqual(
      expect.objectContaining({
        id: "M055-S01-README-SHIPPED-COUNT",
        passed: false,
        status_code: "readme_shipped_count_missing",
      }),
    );
    expect(missingSections.checks[2]).toEqual(
      expect.objectContaining({
        id: "M055-S01-README-NIGHTLY-WORKFLOWS",
        passed: false,
        status_code: "readme_nightly_workflows_missing",
      }),
    );
    expect(missingSections.checks[3]).toEqual(
      expect.objectContaining({
        id: "M055-S01-CHANGELOG-RECENT-RELEASES",
        passed: false,
        status_code: "changelog_recent_releases_missing",
      }),
    );

    const unreadableReadme = await evaluateM055S01DocsTruth({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("README.md")) {
          throw new Error("EACCES: README.md");
        }
        if (filePath.endsWith("CHANGELOG.md")) return PASSING_CHANGELOG;
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(unreadableReadme.checks[0]).toEqual(
      expect.objectContaining({
        id: "M055-S01-README-SHIPPED-COUNT",
        passed: false,
        status_code: "readme_file_unreadable",
      }),
    );
    expect(unreadableReadme.checks[1]).toEqual(
      expect.objectContaining({
        id: "M055-S01-README-RECENT-FEATURES",
        passed: false,
        status_code: "readme_file_unreadable",
      }),
    );
    expect(unreadableReadme.checks[2]).toEqual(
      expect.objectContaining({
        id: "M055-S01-README-NIGHTLY-WORKFLOWS",
        passed: false,
        status_code: "readme_file_unreadable",
      }),
    );

    const unreadablePackage = await evaluateM055S01DocsTruth({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("README.md")) return PASSING_README;
        if (filePath.endsWith("CHANGELOG.md")) return PASSING_CHANGELOG;
        if (filePath.endsWith("package.json")) {
          throw new Error("EACCES: package.json");
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(unreadablePackage.checks[4]).toEqual(
      expect.objectContaining({
        id: "M055-S01-PACKAGE-WIRING",
        passed: false,
        status_code: "package_file_unreadable",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m055:s01"]).toBe(
      "bun scripts/verify-m055-s01.ts",
    );
  });
});
