import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM074S05Contract,
  main,
  parseM074S05Args,
} from "./verify-m074-s05.ts";

describe("verify-m074-s05", () => {
  test("parses CLI arguments and rejects unknown flags", () => {
    expect(parseM074S05Args([])).toEqual({ json: false, help: false });
    expect(parseM074S05Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM074S05Args(["--help"])).toEqual({ json: false, help: true });
    expect(parseM074S05Args(["-h"])).toEqual({ json: false, help: true });
    expect(() => parseM074S05Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits compact PASS evidence for Review Details validation truth and operator counts", async () => {
    const report = await evaluateM074S05Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
    });

    expect(report).toMatchObject({
      command: "verify:m074:s05",
      generatedAt: "2026-05-18T18:00:00.000Z",
      success: true,
      statusCode: "m074_s05_ok",
      gate: "review-details-validation-truth",
      runtimeGate: "review-validation-truth",
      reviewOutputKey: "m074-s05-review-output",
      deliveryId: "delivery-m074-s05",
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
    });
    expect(report.counts).toEqual({
      detected: 27,
      suggested: 2,
      validated: 3,
      revalidated: 1,
      resolved: 1,
      blocked: 1,
      degraded: 1,
      open: 21,
      uncertain: 2,
    });
    expect(report.reasonCoverage).toMatchObject({
      eligible: 1,
      "missing-replacement": 1,
      "duplicate-fix": 1,
      "max-fixes-exceeded": 1,
      "secret-detected": 1,
      "candidate-denied": 1,
      "line-not-commentable": 1,
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
    expect(report.samePrFixEvidence).toMatchObject({
      eligible: 1,
      blocked: 5,
      capped: 1,
    });
    expect(report.boundedReviewDetails).toMatchObject({
      validationTruthLineCount: 1,
      referencesCapped: true,
      reasonCodesCapped: true,
      omittedReferences: 22,
      omittedReasonCodes: 3,
      projectedReferences: 5,
      projectedReasonCodes: 8,
      wordingPresent: true,
      correlationPresent: true,
    });
    expect(report.boundedReviewDetails.validationTruthLine).toContain("- Review validation truth: status=degraded");
    expect(report.boundedReviewDetails.validationTruthLine).toContain("counts=detected:27,suggested:2,validated:3,revalidated:1,resolved:1,blocked:1,degraded:1,open:21,uncertain:2");
    expect(report.boundedReviewDetails.validationTruthLine).toContain("+3 omitted");
    expect(report.boundedReviewDetails.validationTruthLine).toContain("+22 omitted");
    expect(report.visibleVolumeBounds).toMatchObject({
      maxAddedLines: 1,
      maxVisibleCharDelta: 1400,
      withinLineBound: true,
      withinCharBound: true,
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
      "validation-truth-lifecycle-counts",
      "reason-code-coverage",
      "review-details-wording-and-caps",
      "visible-volume-bounds",
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

  test("JSON-style report remains bounded and omits raw Review Details body", async () => {
    const report = await evaluateM074S05Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
    });
    const json = JSON.stringify(report);

    expect(json).toContain("review-details-validation-truth");
    expect(json).toContain("validationTruthLine");
    expect(json).not.toContain("<details>");
    expect(json).not.toContain("</details>");
    expect(json.length).toBeLessThan(8_000);
  });

  test("fails closed when package script wiring is absent", async () => {
    const report = await evaluateM074S05Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => "{\"scripts\":{}}",
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s05_contract_failed");
    expect(report.issues).toContain(`package-wiring: expected=${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`);
  });

  test("fails if Review Details validation truth wording disappears", async () => {
    const report = await evaluateM074S05Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReviewDetailsBody: (body) => body.replace("Review validation truth:", "Validation truth:"),
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("review-details-wording-and-caps:"))).toBe(true);
  });

  test("fails if visible Review Details volume expands unexpectedly", async () => {
    const report = await evaluateM074S05Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReviewDetailsBody: (body) => `${body}\n- Unexpected extra public line`,
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("visible-volume-bounds:"))).toBe(true);
  });

  test("fails if bounded Review Details projection caps are violated", async () => {
    const report = await evaluateM074S05Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReportForCanaryCheck: (base) => ({
        ...base,
        boundedReviewDetails: {
          ...base.boundedReviewDetails,
          projectedReferences: 9,
          referencesCapped: false,
        },
      }),
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("review-details-wording-and-caps:"))).toBe(true);
  });

  test("fails if reason coverage or lifecycle counts are missing", async () => {
    const report = await evaluateM074S05Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReportForCanaryCheck: (base) => ({
        ...base,
        counts: { ...base.counts, resolved: 0 },
        reasonCoverage: { ...base.reasonCoverage, resolved: 0 },
      }),
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("validation-truth-lifecycle-counts:"))).toBe(true);
    expect(report.issues.some((issue) => issue.startsWith("reason-code-coverage:"))).toBe(true);
  });

  test("fails if a raw private canary reaches the report surface", async () => {
    const report = await evaluateM074S05Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReportForCanaryCheck: (base) => ({
        ...base,
        boundedReviewDetails: {
          ...base.boundedReviewDetails,
          validationTruthLine: `${base.boundedReviewDetails.validationTruthLine} RAW_PROMPT_CANARY`,
        },
      }),
    });

    expect(report.success).toBe(false);
    expect(report.redaction.canariesAbsent).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("redaction-flags-and-canaries:"))).toBe(true);
  });

  test("fails if redaction flags become unsafe", async () => {
    const report = await evaluateM074S05Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReportForCanaryCheck: (base) => ({
        ...base,
        redaction: { ...base.redaction, privateOnly: false as never },
      }),
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("redaction-flags-and-canaries:"))).toBe(true);
  });

  test("main handles help and invalid CLI without throwing", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(await main(["--invalid"])).toBe(2);
  });
});
