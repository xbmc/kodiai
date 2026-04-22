import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m059-s01.ts";
import {
  M059_S01_CHECK_IDS,
  buildM059S01ProofHarness,
  evaluateM059S01Proof,
  parseM059S01Args,
  renderM059S01Report,
} from "./verify-m059-s01.ts";

const EXPECTED_CHECK_IDS = [
  "M059-S01-REGISTRY-COVERAGE",
  "M059-S01-REGISTRY-DUPLICATES",
  "M059-S01-REGISTRY-USAGE-TRUTH",
  "M059-S01-SCOPE-CONTRACT",
  "M059-S01-PACKAGE-WIRING",
] as const;

const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m059-s01.ts";
const TRACKED_FILES = [
  "scripts/verify-m059-s01.ts",
  "scripts/backfill-issues.ts",
  "scripts/sync-triage-reactions.ts",
  "scripts/helpers/shared.sh",
] as const;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "verify:m059:s01": EXPECTED_PACKAGE_SCRIPT,
      "backfill:issues": "bun scripts/backfill-issues.ts --sync",
    },
  },
  null,
  2,
);

const PASSING_CI = `name: ci
jobs:
  test:
    steps:
      - run: bun run verify:m059:s01 --json
`;

const PASSING_NIGHTLY_ISSUE = `name: nightly-issue-sync
jobs:
  sync:
    steps:
      - run: bun scripts/backfill-issues.ts --sync
`;

const PASSING_NIGHTLY_REACTION = `name: nightly-reaction-sync
jobs:
  sync:
    steps:
      - run: bun scripts/sync-triage-reactions.ts
`;

const PASSING_REGISTRY = `# Script Registry

<!-- scope: .sh helpers under scripts/ must be listed or explicitly excluded -->

| path | purpose | owner | lifecycle | usage |
| --- | --- | --- | --- | --- |
| scripts/verify-m059-s01.ts | Verifies the script registry contract. | M059 | active | package:verify:m059:s01, workflow:.github/workflows/ci.yml#bun run verify:m059:s01 --json |
| scripts/backfill-issues.ts | Syncs GitHub issues into the local store. | M012 | active | package:backfill:issues, workflow:.github/workflows/nightly-issue-sync.yml#bun scripts/backfill-issues.ts --sync |
| scripts/sync-triage-reactions.ts | Syncs triage comment reactions. | M021 | active | workflow:.github/workflows/nightly-reaction-sync.yml#bun scripts/sync-triage-reactions.ts |
| scripts/helpers/shared.sh | Shared shell helpers for script wrappers. | M059 | internal | none |
`;

describe("verify m059 s01 proof harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M059_S01_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM059S01Args([])).toEqual({ json: false });
    expect(parseM059S01Args(["--json"])).toEqual({ json: true });
    expect(() => parseM059S01Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes when registry coverage, usage truth, scope contract, and package wiring all align", async () => {
    const report = await evaluateM059S01Proof({
      generatedAt: "2026-04-21T12:00:00.000Z",
      listTrackedScriptFiles: async () => [...TRACKED_FILES],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) return PASSING_REGISTRY;
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.command).toBe("verify:m059:s01");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M059-S01-REGISTRY-COVERAGE",
        passed: true,
        status_code: "registry_coverage_ok",
      }),
      expect.objectContaining({
        id: "M059-S01-REGISTRY-DUPLICATES",
        passed: true,
        status_code: "registry_duplicates_ok",
      }),
      expect.objectContaining({
        id: "M059-S01-REGISTRY-USAGE-TRUTH",
        passed: true,
        status_code: "registry_usage_truth_ok",
      }),
      expect.objectContaining({
        id: "M059-S01-SCOPE-CONTRACT",
        passed: true,
        status_code: "scope_contract_ok",
      }),
      expect.objectContaining({
        id: "M059-S01-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
    ]);

    const rendered = renderM059S01Report(report);
    expect(rendered).toContain("M059 S01 script registry verifier");
    expect(rendered).toContain("Script registry proof surface: PASS");
    expect(rendered).toContain("M059-S01-REGISTRY-COVERAGE PASS");
    expect(rendered).toContain("M059-S01-REGISTRY-DUPLICATES PASS");
    expect(rendered).toContain("M059-S01-REGISTRY-USAGE-TRUTH PASS");
    expect(rendered).toContain("M059-S01-SCOPE-CONTRACT PASS");
    expect(rendered).toContain("M059-S01-PACKAGE-WIRING PASS");
  });

  test("ignores non-script tracked files under scripts/ when checking coverage", async () => {
    const report = await evaluateM059S01Proof({
      listTrackedScriptFiles: async () => [...TRACKED_FILES, "scripts/REGISTRY.md"],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) return PASSING_REGISTRY;
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M059-S01-REGISTRY-COVERAGE",
        passed: true,
        status_code: "registry_coverage_ok",
      }),
    );
  });

  test("ignores deleted working-tree paths when listTrackedScriptFiles still reports them", async () => {
    const report = await evaluateM059S01Proof({
      listTrackedScriptFiles: async () => [...TRACKED_FILES],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) {
          return `${PASSING_REGISTRY}| scripts/deleted-but-tracked.ts | Removed local file awaiting commit. | M059 | sunset | none |\n`;
        }
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M059-S01-REGISTRY-COVERAGE",
        passed: false,
        status_code: "registry_rows_missing",
      }),
    );
    expect(report.checks[0]?.detail).toContain("Registry rows without tracked files: scripts/deleted-but-tracked.ts");
  });

  test("flags missing registry coverage, duplicate rows, and missing package wiring with stable status codes", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM059S01ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      listTrackedScriptFiles: async () => [...TRACKED_FILES],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({ name: "kodiai", scripts: {} });
        }
        if (filePath.endsWith("scripts/REGISTRY.md")) {
          return `# Script Registry

| path | purpose | owner | lifecycle | usage |
| --- | --- | --- | --- | --- |
| scripts/backfill-issues.ts | Syncs issues. | M012 | active | package:backfill:issues |
| scripts/backfill-issues.ts | Duplicate row. | M012 | active | package:backfill:issues |
| scripts/sync-triage-reactions.ts | Syncs reactions. | M021 | active | workflow:.github/workflows/nightly-reaction-sync.yml#bun scripts/sync-triage-reactions.ts |
`;
        }
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M059-S01-REGISTRY-COVERAGE",
        passed: false,
        status_code: "registry_rows_missing",
      }),
    );
    expect(report.checks[1]).toEqual(
      expect.objectContaining({
        id: "M059-S01-REGISTRY-DUPLICATES",
        passed: false,
        status_code: "duplicate_row",
      }),
    );
    expect(report.checks[4]).toEqual(
      expect.objectContaining({
        id: "M059-S01-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
    );
    expect(stderr.join(" ")).toContain("registry_rows_missing");
    expect(stderr.join(" ")).toContain("duplicate_row");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
  });

  test("flags malformed registry schema, unknown lifecycle, and missing usage values", async () => {
    const report = await evaluateM059S01Proof({
      listTrackedScriptFiles: async () => [...TRACKED_FILES],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) {
          return `# Script Registry

| path | purpose | owner | lifecycle | usage |
| --- | --- | --- | --- | --- |
| scripts/verify-m059-s01.ts | Missing usage value | M059 | sunset |
`;
        }
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M059-S01-REGISTRY-COVERAGE",
        passed: false,
        status_code: "registry_schema_invalid",
      }),
    );
    expect(report.checks[2]).toEqual(
      expect.objectContaining({
        id: "M059-S01-REGISTRY-USAGE-TRUTH",
        passed: false,
        status_code: "registry_schema_invalid",
      }),
    );
  });

  test("flags stale package and workflow usage references, including usage none drift", async () => {
    const report = await evaluateM059S01Proof({
      listTrackedScriptFiles: async () => [...TRACKED_FILES],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) {
          return `# Script Registry

<!-- scope: .sh helpers under scripts/ must be listed or explicitly excluded -->

| path | purpose | owner | lifecycle | usage |
| --- | --- | --- | --- | --- |
| scripts/verify-m059-s01.ts | Verifies the script registry contract. | M059 | active | none |
| scripts/backfill-issues.ts | Syncs GitHub issues into the local store. | M012 | active | package:backfill:missing |
| scripts/sync-triage-reactions.ts | Syncs triage comment reactions. | M021 | active | workflow:.github/workflows/nightly-reaction-sync.yml#bun scripts/does-not-exist.ts |
| scripts/helpers/shared.sh | Shared shell helpers for script wrappers. | M059 | internal | none |
`;
        }
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[2]).toEqual(
      expect.objectContaining({
        id: "M059-S01-REGISTRY-USAGE-TRUTH",
        passed: false,
        status_code: "usage_reference_invalid",
      }),
    );
    expect(report.checks[2]?.detail).toContain("package:backfill:missing");
    expect(report.checks[2]?.detail).toContain("scripts/does-not-exist.ts");
    expect(report.checks[2]?.detail).toContain("usage none");
  });

  test("flags missing scope declaration when tracked shell helpers are omitted", async () => {
    const report = await evaluateM059S01Proof({
      listTrackedScriptFiles: async () => [...TRACKED_FILES],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("scripts/REGISTRY.md")) {
          return `# Script Registry

| path | purpose | owner | lifecycle | usage |
| --- | --- | --- | --- | --- |
| scripts/verify-m059-s01.ts | Verifies the script registry contract. | M059 | active | package:verify:m059:s01 |
| scripts/backfill-issues.ts | Syncs GitHub issues into the local store. | M012 | active | package:backfill:issues |
| scripts/sync-triage-reactions.ts | Syncs triage comment reactions. | M021 | active | workflow:.github/workflows/nightly-reaction-sync.yml#bun scripts/sync-triage-reactions.ts |
`;
        }
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[3]).toEqual(
      expect.objectContaining({
        id: "M059-S01-SCOPE-CONTRACT",
        passed: false,
        status_code: "scope_contract_missing",
      }),
    );
  });

  test("flags missing registry file, unreadable workflow file, and invalid package json", async () => {
    const report = await evaluateM059S01Proof({
      listTrackedScriptFiles: async () => [...TRACKED_FILES],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return "{ not valid json";
        if (filePath.endsWith("scripts/REGISTRY.md")) throw new Error("ENOENT: REGISTRY.md");
        if (filePath.endsWith("ci.yml")) throw new Error("EACCES: ci.yml");
        if (filePath.endsWith("nightly-issue-sync.yml")) return PASSING_NIGHTLY_ISSUE;
        if (filePath.endsWith("nightly-reaction-sync.yml")) return PASSING_NIGHTLY_REACTION;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M059-S01-REGISTRY-COVERAGE",
        passed: false,
        status_code: "registry_missing",
      }),
    );
    expect(report.checks[2]).toEqual(
      expect.objectContaining({
        id: "M059-S01-REGISTRY-USAGE-TRUTH",
        passed: false,
        status_code: "workflow_file_unreadable",
      }),
    );
    expect(report.checks[4]).toEqual(
      expect.objectContaining({
        id: "M059-S01-PACKAGE-WIRING",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m059:s01"]).toBe(
      "bun scripts/verify-m059-s01.ts",
    );
  });
});
