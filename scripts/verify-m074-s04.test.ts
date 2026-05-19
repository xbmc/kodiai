import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM074S04Contract,
  main,
  parseM074S04Args,
} from "./verify-m074-s04.ts";

describe("verify-m074-s04", () => {
  test("parses CLI arguments and rejects unknown flags", () => {
    expect(parseM074S04Args([])).toEqual({ json: false, help: false });
    expect(parseM074S04Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM074S04Args(["--help"])).toEqual({ json: false, help: true });
    expect(parseM074S04Args(["-h"])).toEqual({ json: false, help: true });
    expect(() => parseM074S04Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits compact PASS evidence for validation truth lifecycle closure", async () => {
    const report = await evaluateM074S04Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
    });

    expect(report).toMatchObject({
      command: "verify:m074:s04",
      generatedAt: "2026-05-18T18:00:00.000Z",
      success: true,
      statusCode: "m074_s04_ok",
      gate: "review-validation-truth",
      reviewOutputKey: "m074-s04-review-output",
      deliveryId: "delivery-m074-s04",
      statusByCase: {
        "detected-open": "open",
        "suggested-unresolved": "suggested",
        "validation-without-revalidation": "uncertain",
        "fresh-revalidation": "resolved",
        "failed-validation": "open",
        "stale-validation": "uncertain",
        "failed-revalidation": "open",
        "blocked-evidence": "blocked",
        "degraded-evidence": "degraded",
      },
      closureSemantics: {
        suggestedResolved: 0,
        validationOnlyResolved: 0,
        freshRevalidationResolved: 1,
        staleValidationResolved: 0,
        failedValidationResolved: 0,
        failedRevalidationResolved: 0,
        blockedOrDegradedResolved: 0,
      },
    });
    expect(report.counts).toMatchObject({
      detected: 27,
      suggested: 2,
      validated: 3,
      revalidated: 1,
      resolved: 1,
      blocked: 1,
      degraded: 1,
    });
    expect(report.reasonCoverage).toMatchObject({
      "suggested-but-open": 2,
      "validation-missing": 20,
      "validation-passed": 3,
      "validation-failed": 1,
      "validation-stale": 1,
      "revalidation-missing": 1,
      "revalidation-passed": 1,
      "revalidation-failed": 1,
      blocked: 1,
      degraded: 1,
      resolved: 1,
    });
    expect(report.boundedPublicSummary).toMatchObject({
      referencesCapped: true,
      reasonCodesCapped: true,
      omittedReferences: 22,
      projectedReferences: 5,
    });
    expect(report.redaction).toMatchObject({
      privateOnly: true,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      replacementTextIncluded: false,
      toolPayloadsIncluded: false,
      secretLikeStringsIncluded: false,
      diffsIncluded: false,
      unboundedArraysIncluded: false,
      canariesAbsent: true,
    });
    expect(report.redaction.unsafeInputFieldCount).toBeGreaterThan(0);
    expect(report.checks.map((check) => check.id)).toEqual([
      "lifecycle-closure-semantics",
      "reason-code-coverage",
      "bounded-public-summary",
      "redaction-flags-and-canaries",
      "diagnostic-correlation",
      "package-wiring",
    ]);
    for (const forbidden of [
      "RAW_PROMPT_CANARY",
      "RAW_MODEL_OUTPUT_CANARY",
      "CANDIDATE_BODY_CANARY",
      "TOOL_PAYLOAD_CANARY",
      "RAW_PAYLOAD_CANARY",
      "REPLACEMENT_CANARY",
      "SECRET_TOKEN_CANARY",
      "sk-supersecret12345",
      "DIFF_TEXT_CANARY",
      "diff --git",
      "PRIVATE_CANDIDATE_BODY",
    ]) {
      expect(JSON.stringify(report)).not.toContain(forbidden);
    }
  });

  test("fails closed when package wiring is absent", async () => {
    const report = await evaluateM074S04Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => "{\"scripts\":{}}",
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s04_contract_failed");
    expect(report.issues).toContain(`package-wiring: expected=${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`);
  });

  test("fails if stale validation is accepted as resolved", async () => {
    const report = await evaluateM074S04Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReportForCanaryCheck: (base) => ({
        ...base,
        statusByCase: { ...base.statusByCase, "stale-validation": "resolved" },
        closureSemantics: { ...base.closureSemantics, staleValidationResolved: 1 },
      }),
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("lifecycle-closure-semantics:"))).toBe(true);
  });

  test("fails if suggested fixes are counted as resolved", async () => {
    const report = await evaluateM074S04Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReportForCanaryCheck: (base) => ({
        ...base,
        statusByCase: { ...base.statusByCase, "suggested-unresolved": "resolved" },
        closureSemantics: { ...base.closureSemantics, suggestedResolved: 1 },
      }),
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("lifecycle-closure-semantics:"))).toBe(true);
  });

  test("fails if a raw private canary reaches the report surface", async () => {
    const report = await evaluateM074S04Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReportForCanaryCheck: (base) => ({
        ...base,
        reasonCoverage: { ...base.reasonCoverage, RAW_PROMPT_CANARY: 1 } as never,
      }),
    });

    expect(report.success).toBe(false);
    expect(report.redaction.canariesAbsent).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("redaction-flags-and-canaries:"))).toBe(true);
  });

  test("main handles help and invalid CLI without throwing", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(await main(["--invalid"])).toBe(2);
  });
});
