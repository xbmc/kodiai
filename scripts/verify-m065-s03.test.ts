import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { M065S03Report } from "./verify-m065-s03.ts";
import {
  M065_S03_CHECK_IDS,
  buildM065S03ProofHarness,
  evaluateM065S03,
  parseVerifyM065S03Args,
  renderM065S03Report,
} from "./verify-m065-s03.ts";

const FIXED_TIME = "2026-04-24T10:15:00.000Z";

const EXPECTED_CHECK_IDS = [
  "M065-S03-FRESH-REGRESSION-EVIDENCE",
  "M065-S03-RUNBOOK-PRESENCE",
  "M065-S03-RERUN-COMMAND-RESOLUTION",
  "M065-S03-PACKAGE-WIRING",
] as const;

const PASSING_REGRESSION_GATE_REPORT = {
  overallPassed: true,
  checks: [
    {
      id: "M061-REG-MENTION-01",
      title: "Mention path regression suites pass",
      passed: true,
      details: "suite passed",
    },
    {
      id: "M061-REG-REVIEW-01",
      title: "Review path regression suites pass",
      passed: true,
      details: "suite passed",
    },
  ],
};

const FAILING_REGRESSION_GATE_REPORT = {
  overallPassed: false,
  checks: [
    {
      id: "M061-REG-MENTION-01",
      title: "Mention path regression suites pass",
      passed: false,
      details: "status=1; stderr=mention suite failed",
    },
    {
      id: "M061-REG-REVIEW-01",
      title: "Review path regression suites pass",
      passed: true,
      details: "suite passed",
    },
  ],
};

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "verify:m061:regression": "bun scripts/phase-m061-token-regression-gate.ts",
      "verify:m065": "bun scripts/verify-m065.ts",
      "verify:m065:s02": "bun scripts/verify-m065-s02.ts",
      "verify:m065:s03": "bun scripts/verify-m065-s03.ts",
    },
  },
  null,
  2,
);

const PASSING_RUNBOOK = `# M065 Rollout Proof

Use this runbook only for supported M065 rollout proof and rerun packaging. The only supported manual rerun trigger is an explicit PR-scoped \`@kodiai review\` comment. Team reviewer requests are debug-only signals and must not be used as manual rerun evidence.

## Identity capture order

1. Start from the delivery-scoped proof bundle and capture the GitHub \`deliveryId\`.
2. Use the evidence bundle / completion surface to capture the matching \`reviewOutputKey\`.
3. Carry both identifiers into every nested verifier rerun so the same run stays correlated.

## Machine-checkable rerun commands

- Top-level closure proof: \`bun run verify:m065 -- --json\`
- Large-PR drill-down: \`bun run verify:m065:s02 -- --json\`
- Fresh regression drill-down: \`bun run verify:m065:s03 -- --json\`
- Fresh non-large regression suites: \`bun run verify:m061:regression\`

## Nested drill-down map

- \`nested_reports.s03\` localizes fresh-regression proof and rollout packaging failures.
- \`nested_reports.s03.nested_reports.regression_gate\` preserves the authoritative wrapped regression-gate payload.
- If the wrapped suites are red, start with \`bun run verify:m061:regression\`; if packaging drifts, repair the runbook/package wiring before retrying top-level closure.
`;

describe("verify-m065-s03", () => {
  test("parse args accepts --json and --help and rejects unknown flags", () => {
    expect(parseVerifyM065S03Args([])).toEqual({ help: false, json: false });
    expect(parseVerifyM065S03Args(["--json"])).toEqual({ help: false, json: true });
    expect(parseVerifyM065S03Args(["--help"])).toEqual({ help: true, json: false });
    expect(() => parseVerifyM065S03Args(["--wat"])).toThrow(
      "invalid_cli_args: Unknown argument: --wat",
    );
  });

  test("exports stable check ids, preserves nested regression payload, and satisfies rollout packaging when all proofs are present", async () => {
    expect(M065_S03_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);

    const report = await evaluateM065S03({
      generatedAt: FIXED_TIME,
      evaluateRegressionGate: () => PASSING_REGRESSION_GATE_REPORT,
      readTextFile: async (filePath: string) => {
        if (normalize(filePath) === "docs/runbooks/m065-rollout-proof.md") return PASSING_RUNBOOK;
        if (normalize(filePath) === "package.json") return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      fileExists: async (filePath: string) => normalize(filePath) === "docs/runbooks/m065-rollout-proof.md",
    });

    expect(report).toMatchObject({
      command: "verify:m065:s03",
      generated_at: FIXED_TIME,
      success: true,
      status_code: "m065_s03_ok",
      check_ids: EXPECTED_CHECK_IDS,
      failing_check_id: null,
      nested_reports: {
        regression_gate: PASSING_REGRESSION_GATE_REPORT,
      },
      rollout_package: {
        runbook_path: "docs/runbooks/m065-rollout-proof.md",
        rerun_commands: [
          "bun run verify:m065 -- --json",
          "bun run verify:m065:s02 -- --json",
          "bun run verify:m065:s03 -- --json",
          "bun run verify:m061:regression",
        ],
      },
      proof_surface: {
        report_key: "nested_reports.regression_gate",
        rollout_obligation_key: "rollout_obligation",
      },
      rollout_obligation: {
        state: "satisfied",
        source: "nested_reports.regression_gate",
        detail: "Fresh non-large regression proof is satisfied by authoritative verify:m061:regression evidence.",
        drill_down_command: "bun run verify:m061:regression",
      },
    } satisfies Partial<M065S03Report>);

    expect(report.checks).toEqual([
      {
        id: "M065-S03-FRESH-REGRESSION-EVIDENCE",
        passed: true,
        skipped: false,
        status_code: "fresh_regression_ok",
        detail: "Preserved authoritative verify:m061:regression evidence under nested_reports.regression_gate.",
        drill_down: {
          command: "bun run verify:m061:regression",
          report_key: "nested_reports.regression_gate",
          nested_status_code: "regression_gate_passed",
        },
      },
      {
        id: "M065-S03-RUNBOOK-PRESENCE",
        passed: true,
        skipped: false,
        status_code: "runbook_present",
        detail: "docs/runbooks/m065-rollout-proof.md is present.",
        drill_down: {
          command: "bun run verify:m065:s03 -- --json",
          report_key: "rollout_package.runbook_path",
        },
      },
      {
        id: "M065-S03-RERUN-COMMAND-RESOLUTION",
        passed: true,
        skipped: false,
        status_code: "rerun_commands_resolved",
        detail: "Resolved rerun commands in docs/runbooks/m065-rollout-proof.md.",
        drill_down: {
          command: "bun run verify:m065:s03 -- --json",
          report_key: "rollout_package.rerun_commands",
        },
      },
      {
        id: "M065-S03-PACKAGE-WIRING",
        passed: true,
        skipped: false,
        status_code: "package_wiring_ok",
        detail: "package.json wires verify:m065:s03 to bun scripts/verify-m065-s03.ts.",
        drill_down: {
          command: "bun run verify:m065:s03 -- --json",
          report_key: "checks[3]",
        },
      },
    ]);

    const rendered = renderM065S03Report(report);
    expect(rendered).toContain("# M065 S03 — Fresh Regression Proof Verifier");
    expect(rendered).toContain("Status: m065_s03_ok");
    expect(rendered).toContain("M065-S03-FRESH-REGRESSION-EVIDENCE: fresh_regression_ok");
    expect(rendered).toContain("Next drill-down: bun run verify:m061:regression");
  });

  test("fails the fresh regression check but preserves wrapped suite ids when the authoritative regression gate is red", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM065S03ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      evaluateRegressionGate: () => FAILING_REGRESSION_GATE_REPORT,
      readTextFile: async (filePath: string) => {
        if (normalize(filePath) === "docs/runbooks/m065-rollout-proof.md") return PASSING_RUNBOOK;
        if (normalize(filePath) === "package.json") return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      fileExists: async (filePath: string) => normalize(filePath) === "docs/runbooks/m065-rollout-proof.md",
    });

    const report = JSON.parse(stdout.join("")) as M065S03Report;

    expect(result.exitCode).toBe(1);
    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m065_s03_verifier_failed");
    expect(report.failing_check_id).toBe("M065-S03-FRESH-REGRESSION-EVIDENCE");
    expect(report.nested_reports.regression_gate).toEqual(FAILING_REGRESSION_GATE_REPORT);
    expect(report.rollout_obligation).toEqual({
      state: "failed",
      source: "nested_reports.regression_gate",
      detail: "Fresh non-large regression proof is failing and requires rerun packaging.",
      drill_down_command: "bun run verify:m065:s03 -- --json",
    });
    expect(report.checks[0]).toEqual({
      id: "M065-S03-FRESH-REGRESSION-EVIDENCE",
      passed: false,
      skipped: false,
      status_code: "fresh_regression_failed",
      detail: "verify:m061:regression reported one or more failing regression suites: M061-REG-MENTION-01.",
      drill_down: {
        command: "bun run verify:m061:regression",
        report_key: "nested_reports.regression_gate",
        nested_status_code: "regression_gate_failed",
      },
    });
    expect(stderr.join(" ")).toContain("M065-S03-FRESH-REGRESSION-EVIDENCE:fresh_regression_failed");
  });

  test("fails loudly for malformed nested proof, missing runbook, unresolved commands, and missing package wiring", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM065S03ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      evaluateRegressionGate: () => ({ checks: [] }),
      readTextFile: async (filePath: string) => {
        if (normalize(filePath) === "docs/runbooks/m065-rollout-proof.md") {
          return PASSING_RUNBOOK
            .replace("bun run verify:m065:s02 -- --json", "bun run verify:m065:s02-missing -- --json")
            .replace("explicit PR-scoped `@kodiai review` comment", "reviewer request");
        }
        if (normalize(filePath) === "package.json") {
          return JSON.stringify({ name: "kodiai", scripts: { "verify:m065": "bun scripts/verify-m065.ts" } }, null, 2);
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
      fileExists: async () => false,
    });

    const report = JSON.parse(stdout.join("")) as M065S03Report;

    expect(result.exitCode).toBe(1);
    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m065_s03_nested_contract_failed");
    expect(report.failing_check_id).toBe("M065-S03-FRESH-REGRESSION-EVIDENCE");
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M065-S03-FRESH-REGRESSION-EVIDENCE",
        passed: false,
        status_code: "fresh_regression_malformed",
      }),
      expect.objectContaining({
        id: "M065-S03-RUNBOOK-PRESENCE",
        passed: false,
        status_code: "runbook_missing",
      }),
      expect.objectContaining({
        id: "M065-S03-RERUN-COMMAND-RESOLUTION",
        passed: false,
        status_code: "rerun_command_unresolved",
      }),
      expect.objectContaining({
        id: "M065-S03-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
    ]);
    expect(report.checks[2]?.detail).toContain("verify:m065:s02-missing");
    expect(report.checks[2]?.detail).toContain("unsupported reviewer-request wording");
    expect(report.rollout_obligation).toEqual({
      state: "failed",
      source: null,
      detail: "Fresh non-large regression proof is malformed and cannot be trusted.",
      drill_down_command: "bun run verify:m065:s03 -- --json",
    });
    expect(stderr.join(" ")).toContain("M065-S03-FRESH-REGRESSION-EVIDENCE:fresh_regression_malformed");
  });

  test("package.json wires verify:m065:s03 to the dedicated verifier script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m065:s03"]).toBe("bun scripts/verify-m065-s03.ts");
  });
});

function normalize(filePath: string): string {
  return filePath.split(/\\/g).join("/").replace(/^.*\/(docs\/runbooks\/m065-rollout-proof\.md|package\.json)$/, "$1");
}
