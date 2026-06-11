import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM074S01Contract,
  main,
  parseM074S01Args,
} from "./verify-m074-s01.ts";
import { toFindingLifecyclePublicProjection } from "../src/review-lifecycle/finding-lifecycle.ts";

describe("verify-m074-s01", () => {
  test("parses CLI arguments and rejects unknown flags", () => {
    expect(parseM074S01Args([])).toEqual({ json: false, help: false });
    expect(parseM074S01Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM074S01Args(["--help"])).toEqual({ json: false, help: true });
    expect(parseM074S01Args(["-h"])).toEqual({ json: false, help: true });
    expect(() => parseM074S01Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits a passing bounded report for the deterministic lifecycle fixture", async () => {
    const report = await evaluateM074S01Contract({
      generatedAt: "2026-05-18T16:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
    });

    expect(report).toMatchObject({
      command: "verify:m074:s01",
      generatedAt: "2026-05-18T16:00:00.000Z",
      success: true,
      statusCode: "m074_s01_ok",
      lifecycleRecordCount: 40,
      stableIdDeterministic: true,
      boundedProjection: {
        referenceCount: 5,
        omittedReferences: 35,
        reasonCodeCount: 8,
      },
    });
    expect(report.statusCounts.detected).toBe(40);
    expect(report.statusCounts.open).toBeGreaterThan(0);
    expect(report.statusCounts.validated).toBeGreaterThan(0);
    expect(report.actionabilityCounts.actionable).toBeGreaterThan(0);
    expect(report.validationNeedCounts["needs-tests"]).toBeGreaterThan(0);
    expect(report.revalidationStateCounts.pending).toBeGreaterThan(0);
    expect(report.redactionFlags).toMatchObject({
      privateOnly: true,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      toolPayloadsIncluded: false,
      secretLikeStringsIncluded: false,
      diffsIncluded: false,
      unboundedArraysIncluded: false,
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "lifecycle-record-counts",
      "status-counts-present",
      "actionability-validation-present",
      "redaction-flags-and-canaries",
      "stable-id-determinism",
      "bounded-projection",
      "missing-correlation-negative",
      "malformed-status-transition-negative",
      "package-wiring",
    ]);
  });

  test("fails closed when package wiring is missing without leaking fixture payloads", async () => {
    const report = await evaluateM074S01Contract({
      generatedAt: "2026-05-18T16:00:00.000Z",
      readPackageJsonText: async () => "{\"scripts\":{}}",
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s01_contract_failed");
    expect(report.issues).toContain(`package-wiring: expected=${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`);
    expect(JSON.stringify(report)).not.toContain("Private fixture body omitted from public projection");
  });

  test("fails on intentionally unsafe public projection flags and canary strings", async () => {
    const report = await evaluateM074S01Contract({
      generatedAt: "2026-05-18T16:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      projectPrimary: (result) => {
        const projection = toFindingLifecyclePublicProjection(result);
        return {
          ...projection,
          redaction: {
            ...projection.redaction,
            rawPromptsIncluded: true,
          },
          references: [
            ...projection.references,
            {
              id: "unsafe-extra-reference",
              status: "open",
              severity: "major",
              category: "correctness",
              actionability: "actionable",
              validationNeeds: ["needs-tests"],
              revalidationState: "pending",
              reasonCodes: ["RAW_PROMPT_CANARY"],
              evidenceRefs: [],
            },
          ],
        } as any;
      },
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("redaction-flags-and-canaries:"))).toBe(true);
    expect(report.issues.some((issue) => issue.startsWith("bounded-projection:"))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("BEGIN PROMPT");
  });

  test("fails when the missing-correlation negative fixture does not fail closed", async () => {
    const report = await evaluateM074S01Contract({
      generatedAt: "2026-05-18T16:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      missingCorrelationInput: {
        repo: "acme/widgets",
        pullNumber: 74,
        reviewOutputKey: "present-when-it-should-be-missing",
        commitSha: "abc123def456",
        findings: [{ filePath: "src/ok.ts", title: "Valid finding" }],
      },
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("missing-correlation-negative:"))).toBe(true);
  });

  test("fails when malformed status transition pressure is not detected", async () => {
    const report = await evaluateM074S01Contract({
      generatedAt: "2026-05-18T16:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      malformedStatusInput: {
        repo: "acme/widgets",
        pullNumber: 74,
        reviewOutputKey: "m074-s01-review-output",
        commitSha: "abc123def456",
        findings: [
          {
            filePath: "src/ordered.ts",
            startLine: 1,
            endLine: 1,
            title: "Ordered transition should not trip detector",
            statusHistory: [
              { status: "detected", reasonCode: "detected" },
              { status: "open", reasonCode: "open" },
            ],
          },
        ],
      },
    });

    expect(report.success).toBe(false);
    expect(report.issues).toContain("malformed-status-transition-negative: malformedTransitionDetected=false");
  });

  test("main handles help and invalid CLI without throwing", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(await main(["--invalid"])).toBe(2);
  });
});
