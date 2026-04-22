import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m058-s02.ts";
import {
  M058_S02_CHECK_IDS,
  buildM058S02ProofHarness,
  evaluateM058S02Proof,
  parseM058S02Args,
  renderM058S02Report,
} from "./verify-m058-s02.ts";

const EXPECTED_CHECK_IDS = [
  "M058-S02-PACKAGE-CONTRACT",
  "M058-S02-PACKAGE-WIRING",
  "M058-S02-WORKFLOW-ALIGNMENT",
  "M058-S02-DOCS-TRUTH",
] as const;

const PINNED_BUN_VERSION = "1.3.8" as const;
const EXPECTED_PACKAGE_MANAGER = `bun@${PINNED_BUN_VERSION}`;
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m058-s02.ts";

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    packageManager: EXPECTED_PACKAGE_MANAGER,
    engines: {
      bun: PINNED_BUN_VERSION,
    },
    scripts: {
      "verify:m058:s02": EXPECTED_PACKAGE_SCRIPT,
    },
    devDependencies: {
      "@types/bun": "latest",
    },
  },
  null,
  2,
);

const PASSING_CI = `name: ci
jobs:
  test:
    steps:
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${PINNED_BUN_VERSION}
      - run: bun install
`;

const PASSING_NIGHTLY_ISSUE = `name: nightly-issue-sync
jobs:
  sync:
    steps:
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${PINNED_BUN_VERSION}
      - run: bun install --frozen-lockfile
`;

const PASSING_NIGHTLY_REACTION = `name: nightly-reaction-sync
jobs:
  sync:
    steps:
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${PINNED_BUN_VERSION}
      - run: bun install --frozen-lockfile
`;

const PASSING_CONTRIBUTING = `# Contributing

- package.json pins \`packageManager\` to \`${EXPECTED_PACKAGE_MANAGER}\`.
- package.json pins \`engines.bun\` to \`${PINNED_BUN_VERSION}\`.
- GitHub Actions workflows use \`oven-sh/setup-bun@v2\` with \`bun-version: ${PINNED_BUN_VERSION}\`.
- \`@types/bun\` remains a separate devDependency surface and is not the runtime pin.
- Run \`bun run verify:m058:s02\` to inspect Bun contract drift.
`;

describe("verify m058 s02 proof harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M058_S02_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM058S02Args([])).toEqual({ json: false });
    expect(parseM058S02Args(["--json"])).toEqual({ json: true });
    expect(() => parseM058S02Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes when package, workflows, and docs all align to one pinned Bun contract", async () => {
    const report = await evaluateM058S02Proof({
      generatedAt: "2026-04-21T12:00:00.000Z",
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        if (filePath.endsWith("CONTRIBUTING.md")) return PASSING_CONTRIBUTING;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.command).toBe("verify:m058:s02");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M058-S02-PACKAGE-CONTRACT",
        passed: true,
        status_code: "package_contract_ok",
      }),
      expect.objectContaining({
        id: "M058-S02-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
      expect.objectContaining({
        id: "M058-S02-WORKFLOW-ALIGNMENT",
        passed: true,
        status_code: "workflow_alignment_ok",
      }),
      expect.objectContaining({
        id: "M058-S02-DOCS-TRUTH",
        passed: true,
        status_code: "docs_truth_ok",
      }),
    ]);

    const rendered = renderM058S02Report(report);
    expect(rendered).toContain("M058 S02 Bun contract verifier");
    expect(rendered).toContain("Bun contract proof surface: PASS");
    expect(rendered).toContain("M058-S02-PACKAGE-CONTRACT PASS");
    expect(rendered).toContain("M058-S02-PACKAGE-WIRING PASS");
    expect(rendered).toContain("M058-S02-WORKFLOW-ALIGNMENT PASS");
    expect(rendered).toContain("M058-S02-DOCS-TRUTH PASS");
  });

  test("flags missing exact contract fields and package script wiring", async () => {
    const report = await evaluateM058S02Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({
            name: "kodiai",
            engines: {},
            scripts: {},
          });
        }
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        if (filePath.endsWith("CONTRIBUTING.md")) return PASSING_CONTRIBUTING;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M058-S02-PACKAGE-CONTRACT",
        passed: false,
        status_code: "package_manager_missing",
      }),
    );
    expect(report.checks[1]).toEqual(
      expect.objectContaining({
        id: "M058-S02-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
    );
  });

  test("flags malformed package data, mismatched exact pins, and invalid package json", async () => {
    const mismatchedReport = await evaluateM058S02Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({
            name: "kodiai",
            packageManager: "bun@1.3.7",
            engines: { bun: PINNED_BUN_VERSION },
            scripts: { "verify:m058:s02": EXPECTED_PACKAGE_SCRIPT },
          });
        }
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        if (filePath.endsWith("CONTRIBUTING.md")) return PASSING_CONTRIBUTING;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(mismatchedReport.checks[0]).toEqual(
      expect.objectContaining({
        id: "M058-S02-PACKAGE-CONTRACT",
        passed: false,
        status_code: "bun_version_mismatch",
      }),
    );

    const malformedReport = await evaluateM058S02Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return "{ not valid json";
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        if (filePath.endsWith("CONTRIBUTING.md")) return PASSING_CONTRIBUTING;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(malformedReport.checks[0]).toEqual(
      expect.objectContaining({
        id: "M058-S02-PACKAGE-CONTRACT",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );
    expect(malformedReport.checks[1]).toEqual(
      expect.objectContaining({
        id: "M058-S02-PACKAGE-WIRING",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );
  });

  test("isolates stale workflow and docs drift from an otherwise valid package contract", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM058S02ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE.replace(
          PINNED_BUN_VERSION,
          "latest",
        );
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        if (filePath.endsWith("CONTRIBUTING.md")) {
          return `# Contributing\n\nThis repository does not pin a single Bun version in source control yet.\n`;
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M058-S02-PACKAGE-CONTRACT",
        passed: true,
        status_code: "package_contract_ok",
      }),
    );
    expect(report.checks[2]).toEqual(
      expect.objectContaining({
        id: "M058-S02-WORKFLOW-ALIGNMENT",
        passed: false,
        status_code: "workflow_bun_version_drift",
      }),
    );
    expect(report.checks[3]).toEqual(
      expect.objectContaining({
        id: "M058-S02-DOCS-TRUTH",
        passed: false,
        status_code: "docs_truth_stale",
      }),
    );
    expect(stderr.join(" ")).toContain("workflow_bun_version_drift");
    expect(stderr.join(" ")).toContain("docs_truth_stale");
  });

  test("flags unreadable workflow and docs files with stable status codes", async () => {
    const report = await evaluateM058S02Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("ci.yml")) throw new Error("EACCES: ci.yml");
        if (filePath.endsWith("nightly-issue-sync.yml")) throw new Error("EACCES: nightly issue");
        if (filePath.endsWith("nightly-reaction-sync.yml")) throw new Error("EACCES: nightly reaction");
        if (filePath.endsWith("CONTRIBUTING.md")) throw new Error("EACCES: CONTRIBUTING.md");
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[2]).toEqual(
      expect.objectContaining({
        id: "M058-S02-WORKFLOW-ALIGNMENT",
        passed: false,
        status_code: "workflow_file_unreadable",
      }),
    );
    expect(report.checks[3]).toEqual(
      expect.objectContaining({
        id: "M058-S02-DOCS-TRUTH",
        passed: false,
        status_code: "contributing_file_unreadable",
      }),
    );
  });

  test("wires the canonical package script and Bun contract in package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      packageManager?: string;
      engines?: { bun?: string };
      scripts?: Record<string, string>;
    };

    expect(packageJson.packageManager).toBe(EXPECTED_PACKAGE_MANAGER);
    expect(packageJson.engines?.bun).toBe(PINNED_BUN_VERSION);
    expect(packageJson.scripts?.["verify:m058:s02"]).toBe(EXPECTED_PACKAGE_SCRIPT);
  });
});
