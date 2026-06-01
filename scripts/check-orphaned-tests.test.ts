import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { OrphanedTestCheckerReport } from "./check-orphaned-tests.ts";
import {
  CHECK_ORPHANED_TESTS_CHECK_IDS,
  EXPLICIT_TEST_TARGET_MAP,
  buildCheckOrphanedTestsHarness,
  evaluateOrphanedTests,
  parseCheckOrphanedTestsArgs,
  renderCheckOrphanedTestsReport,
} from "./check-orphaned-tests.ts";

const EXPECTED_CHECK_IDS = [
  "TRACKED-FILE-DISCOVERY",
  "TARGET-MAP-STATE",
  "ORPHANED-TESTS",
  "PACKAGE-WIRING",
] as const;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "check:orphaned-tests": "bun scripts/check-orphaned-tests.ts",
    },
  },
  null,
  2,
);

describe("check orphaned tests", () => {
  test("exports stable check ids, explicit mappings, and strict cli parsing", () => {
    expect(CHECK_ORPHANED_TESTS_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(EXPLICIT_TEST_TARGET_MAP).toEqual({
      "scripts/deploy.test.ts": "deploy.sh",
      "scripts/deploy-timeout-alignment.test.ts": "deploy.sh",
      "src/execution/prepare-agent-workspace.test.ts": "src/execution/executor.ts",
      "src/handlers/review-candidate-verification-evidence.test.ts": "src/handlers/review-m070-integration-harness.ts",
      "src/handlers/review-candidate-verification-integration.test.ts": "src/handlers/review-m070-integration-harness.ts",
      "src/handlers/review-candidate-verification-publication.test.ts": "src/handlers/review-m070-integration-harness.ts",
      "src/handlers/review-shadow-specialist-metrics.test.ts": "src/handlers/review-m070-integration-harness.ts",
      "src/handlers/review-shadow-specialist-publication.test.ts": "src/handlers/review-m070-integration-harness.ts",
      "src/handlers/review-shadow-specialist.test.ts": "src/handlers/review.test.ts",
      "src/lib/review-details-formatting-architecture.test.ts": "src/lib/review-details-formatting.ts",
      "src/slack/v1-safety-contract.test.ts": "src/slack/safety-rails.ts",
      "src/specialists/shadow-specialist-runner.test.ts": "src/specialists/shadow-specialist-subflow.test.ts",
    });
    expect(parseCheckOrphanedTestsArgs([])).toEqual({ json: false });
    expect(parseCheckOrphanedTestsArgs(["--json"])).toEqual({ json: true });
    expect(() => parseCheckOrphanedTestsArgs(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes when sibling ownership and explicit mappings resolve every tracked src/scripts test and package wiring is canonical", async () => {
    const report = await evaluateOrphanedTests({
      generatedAt: "2026-04-21T11:00:00.000Z",
      listTrackedFiles: async () => [
        "deploy.sh",
        "scripts/check-orphaned-tests.ts",
        "scripts/deploy.test.ts",
        "scripts/deploy-timeout-alignment.test.ts",
        "src/execution/executor.test.ts",
        "src/execution/executor.ts",
        "src/execution/prepare-agent-workspace.test.ts",
        "src/handlers/review-candidate-verification-evidence.test.ts",
        "src/handlers/review-candidate-verification-integration.test.ts",
        "src/handlers/review-candidate-verification-publication.test.ts",
        "src/handlers/review-m070-integration-harness.ts",
        "src/handlers/review-shadow-specialist-metrics.test.ts",
        "src/handlers/review-shadow-specialist-publication.test.ts",
        "src/handlers/review-shadow-specialist.test.ts",
        "src/handlers/review.test.ts",
        "src/handlers/review.ts",
        "src/knowledge/retrieval.e2e.test.ts",
        "src/knowledge/retrieval.ts",
        "src/lib/review-details-formatting-architecture.test.ts",
        "src/lib/review-details-formatting.ts",
        "src/slack/safety-rails.ts",
        "src/slack/v1-safety-contract.test.ts",
        "src/specialists/shadow-specialist-runner.test.ts",
        "src/specialists/shadow-specialist-subflow.test.ts",
        "src/specialists/shadow-specialist-subflow.ts",
      ],
      readPackageJson: async () => PASSING_PACKAGE_JSON,
    });

    expect(report.command).toBe("check:orphaned-tests");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "TRACKED-FILE-DISCOVERY",
        passed: true,
        status_code: "tracked_files_ok",
      }),
      expect.objectContaining({
        id: "TARGET-MAP-STATE",
        passed: true,
        status_code: "target_map_ok",
      }),
      expect.objectContaining({
        id: "ORPHANED-TESTS",
        passed: true,
        status_code: "all_tests_resolved",
      }),
      expect.objectContaining({
        id: "PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
    ]);

    const rendered = renderCheckOrphanedTestsReport(report);
    expect(rendered).toContain("Orphaned test ownership gate: PASS");
    expect(rendered).toContain("TRACKED-FILE-DISCOVERY PASS");
    expect(rendered).toContain("TARGET-MAP-STATE PASS");
    expect(rendered).toContain("ORPHANED-TESTS PASS");
    expect(rendered).toContain("PACKAGE-WIRING PASS");
  });

  test("fails with stable orphan and package status codes when a tracked test has no sibling and package wiring drifts", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildCheckOrphanedTestsHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      listTrackedFiles: async () => [
        "deploy.sh",
        "scripts/check-orphaned-tests.ts",
        "scripts/deploy.test.ts",
        "scripts/deploy-timeout-alignment.test.ts",
        "src/execution/executor.ts",
        "src/execution/prepare-agent-workspace.test.ts",
        "src/execution/missing-owner.test.ts",
        "src/handlers/review-candidate-verification-evidence.test.ts",
        "src/handlers/review-candidate-verification-integration.test.ts",
        "src/handlers/review-candidate-verification-publication.test.ts",
        "src/handlers/review-m070-integration-harness.ts",
        "src/handlers/review-shadow-specialist-metrics.test.ts",
        "src/handlers/review-shadow-specialist-publication.test.ts",
        "src/handlers/review-shadow-specialist.test.ts",
        "src/handlers/review.test.ts",
        "src/handlers/review.ts",
        "src/lib/review-details-formatting-architecture.test.ts",
        "src/lib/review-details-formatting.ts",
        "src/slack/safety-rails.ts",
        "src/slack/v1-safety-contract.test.ts",
        "src/specialists/shadow-specialist-runner.test.ts",
        "src/specialists/shadow-specialist-subflow.test.ts",
        "src/specialists/shadow-specialist-subflow.ts",
      ],
      readPackageJson: async () => JSON.stringify({ name: "kodiai", scripts: {} }),
    });

    const report = JSON.parse(stdout.join("")) as OrphanedTestCheckerReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "TRACKED-FILE-DISCOVERY",
        passed: true,
        status_code: "tracked_files_ok",
      }),
      expect.objectContaining({
        id: "TARGET-MAP-STATE",
        passed: true,
        status_code: "target_map_ok",
      }),
      expect.objectContaining({
        id: "ORPHANED-TESTS",
        passed: false,
        status_code: "orphaned_tests_found",
      }),
      expect.objectContaining({
        id: "PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
    ]);
    expect(report.checks[2]?.detail).toContain("src/execution/missing-owner.test.ts");
    expect(stderr.join(" ")).toContain("orphaned_tests_found");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
  });

  test("fails closed when explicit mappings drift away from tracked targets", async () => {
    const report = await evaluateOrphanedTests({
      listTrackedFiles: async () => [
        "scripts/check-orphaned-tests.ts",
        "scripts/deploy.test.ts",
        "src/slack/safety-rails.ts",
      ],
      readPackageJson: async () => PASSING_PACKAGE_JSON,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks[1]).toEqual(
      expect.objectContaining({
        id: "TARGET-MAP-STATE",
        passed: false,
        status_code: "mapped_target_missing",
      }),
    );
    expect(report.checks[1]?.detail).toContain("scripts/deploy-timeout-alignment.test.ts -> deploy.sh");
    expect(report.checks[1]?.detail).toContain("src/execution/prepare-agent-workspace.test.ts -> src/execution/executor.ts");
    expect(report.checks[1]?.detail).toContain("src/slack/v1-safety-contract.test.ts -> src/slack/safety-rails.ts");
    expect(report.checks[2]).toEqual(
      expect.objectContaining({
        id: "ORPHANED-TESTS",
        passed: false,
        status_code: "ownership_map_unusable",
      }),
    );
  });

  test("wires the canonical package script in the real package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["check:orphaned-tests"]).toBe(
      "bun scripts/check-orphaned-tests.ts",
    );
  });
});
