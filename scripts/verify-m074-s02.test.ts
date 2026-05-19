import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM074S02Contract,
  main,
  parseM074S02Args,
} from "./verify-m074-s02.ts";

describe("verify-m074-s02", () => {
  test("parses CLI arguments and rejects unknown flags", () => {
    expect(parseM074S02Args([])).toEqual({ json: false, help: false });
    expect(parseM074S02Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM074S02Args(["--help"])).toEqual({ json: false, help: true });
    expect(parseM074S02Args(["-h"])).toEqual({ json: false, help: true });
    expect(() => parseM074S02Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits compact PASS evidence for automatic and mention lifecycle equivalence", async () => {
    const report = await evaluateM074S02Contract({
      generatedAt: "2026-05-18T17:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
    });

    expect(report).toMatchObject({
      command: "verify:m074:s02",
      generatedAt: "2026-05-18T17:00:00.000Z",
      success: true,
      statusCode: "m074_s02_ok",
      gate: "review-finding-lifecycle",
      equivalentAggregateProjection: true,
      stableIdDeterministic: true,
      boundedReferences: true,
    });
    expect(report.automatic).toMatchObject({
      source: "automatic",
      trigger: "pull_request",
      normalizedStatus: "normalized",
      reviewOutputKeyPresent: true,
      deliveryIdPresent: true,
      counts: { input: 3, recorded: 3, rejected: 0 },
    });
    expect(report.mention).toMatchObject({
      source: "mention",
      trigger: "issue_comment",
      normalizedStatus: "normalized",
      counts: { input: 3, recorded: 3, rejected: 0 },
    });
    expect(report.automatic.statusSummary.detected).toBe(3);
    expect(report.automatic.statusSummary.open).toBe(3);
    expect(report.automatic.severitySummary.major).toBeGreaterThan(0);
    expect(report.automatic.actionabilitySummary.actionable).toBeGreaterThan(0);
    expect(report.automatic.validationNeedSummary["needs-tests"]).toBeGreaterThan(0);
    expect(report.automatic.revalidationStateSummary.pending).toBeGreaterThan(0);
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
      "automatic-mention-equivalence",
      "gate-log-evidence",
      "stable-id-determinism",
      "bounded-references-and-reason-codes",
      "redaction-flags-and-canaries",
      "missing-correlation-negative",
      "package-wiring",
    ]);
    for (const forbidden of [
      "PRIVATE_BODY_CANARY",
      "RAW_PROMPT_CANARY",
      "RAW_MODEL_OUTPUT_CANARY",
      "CANDIDATE_BODY_CANARY",
      "TOOL_PAYLOAD_CANARY",
      "SECRET_TOKEN_CANARY",
      "sk-supersecret12345",
      "DIFF_TEXT_CANARY",
      "diff --git",
    ]) {
      expect(JSON.stringify(report)).not.toContain(forbidden);
    }
  });

  test("fails closed when package wiring is absent without leaking raw fixture payloads", async () => {
    const report = await evaluateM074S02Contract({
      generatedAt: "2026-05-18T17:00:00.000Z",
      readPackageJsonText: async () => "{\"scripts\":{}}",
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s02_contract_failed");
    expect(report.issues).toContain(`package-wiring: expected=${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_BODY_CANARY");
  });

  test("fails when automatic and mention aggregate projections diverge", async () => {
    const report = await evaluateM074S02Contract({
      generatedAt: "2026-05-18T17:00:00.000Z",
      readPackageJsonText: async () => `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`,
      mentionFindings: [
        {
          filePath: "src/mention-only.ts",
          startLine: 1,
          severity: "minor",
          category: "documentation",
          title: "Mention diverges from automatic",
          actionability: "not-actionable",
          validationNeeds: ["none"],
          revalidationState: "not-required",
        },
      ],
    });

    expect(report.success).toBe(false);
    expect(report.issues.some((issue) => issue.startsWith("automatic-mention-equivalence:"))).toBe(true);
  });

  test("main handles help and invalid CLI without throwing", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(await main(["--invalid"])).toBe(2);
  });
});
