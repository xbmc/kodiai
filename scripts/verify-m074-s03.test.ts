import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM074S03Contract,
  main,
  parseM074S03Args,
} from "./verify-m074-s03.ts";

describe("verify-m074-s03", () => {
  test("parses CLI arguments and rejects unknown flags", () => {
    expect(parseM074S03Args([])).toEqual({ json: false, help: false });
    expect(parseM074S03Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM074S03Args(["--help"])).toEqual({ json: false, help: true });
    expect(parseM074S03Args(["-h"])).toEqual({ json: false, help: true });
    expect(() => parseM074S03Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits compact PASS evidence for S03 fix eligibility and publication contract", async () => {
    const report = await evaluateM074S03Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
    });

    expect(report).toMatchObject({
      command: "verify:m074:s03",
      generatedAt: "2026-05-18T18:00:00.000Z",
      success: true,
      statusCode: "m074_s03_ok",
      eligibleCount: 1,
      blockedCount: 7,
      cappedCount: 1,
      boundedPublicSummary: true,
      samePrPublicationShape: {
        owner: "acme",
        repo: "widgets",
        pullNumber: 74,
        commitSha: "abc123def456",
        path: "src/eligible.ts",
        line: 10,
        side: "RIGHT",
        suggestionBlockPresent: true,
        markerPresent: true,
      },
      idempotency: {
        firstStatus: "published",
        replayStatus: "skipped",
        replayReason: "already-published",
        createReviewCommentCalls: 1,
      },
      commentability: {
        status: "failed",
        reason: "line-not-commentable-in-pr-diff",
      },
    });
    expect(report.reasonCoverage).toMatchObject({
      eligible: 1,
      "unmappable-location": 1,
      "duplicate-fix": 1,
      "max-fixes-exceeded": 1,
      "secret-detected": 1,
      "reducer-denied": 1,
      "candidate-denied": 1,
      "formatter-owned": 1,
      "line-not-commentable": 1,
      "already-published": 1,
    });
    expect(report.redaction).toMatchObject({
      privateOnly: true,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      toolPayloadsIncluded: false,
      diffsIncluded: false,
      unboundedDiffsIncluded: false,
      secretDetected: true,
      canariesAbsent: true,
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "reason-code-coverage",
      "bounded-counts",
      "redaction-flags-and-canaries",
      "same-pr-suggestion-shape",
      "idempotency-already-published",
      "commentability-negative",
      "package-wiring",
    ]);
    for (const forbidden of [
      "RAW_PROMPT_CANARY",
      "RAW_MODEL_OUTPUT_CANARY",
      "CANDIDATE_BODY_CANARY",
      "TOOL_PAYLOAD_CANARY",
      "SECRET_TOKEN_CANARY",
      "sk-supersecret12345",
      "UNBOUNDED_DIFF_CANARY",
      "diff --git a/private",
      "PRIVATE_REPLACEMENT_CANARY",
    ]) {
      expect(JSON.stringify(report)).not.toContain(forbidden);
    }
  });

  test("fails closed when package wiring is absent", async () => {
    const report = await evaluateM074S03Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => "{\"scripts\":{}}",
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s03_contract_failed");
    expect(report.issues).toContain(`package-wiring: expected=${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`);
  });

  test("fails if published body loses suggestion block shape", async () => {
    const report = await evaluateM074S03Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutatePublishedBody: (body) => body.replace("```suggestion", "```text"),
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("same-pr-suggestion-shape:"))).toBe(true);
  });

  test("fails if a raw private canary reaches the report surface", async () => {
    const report = await evaluateM074S03Contract({
      generatedAt: "2026-05-18T18:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mutateReportForCanaryCheck: (base) => ({
        ...base,
        reasonCoverage: { ...base.reasonCoverage, "RAW_PROMPT_CANARY" : 1 } as never,
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
