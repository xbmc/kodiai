import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  M075_S02_CHECK_IDS,
  evaluateM075S02Contract,
  main,
  parseM075S02Args,
} from "./verify-m075-s02.ts";
import type { LearningMemoryRecord } from "../src/knowledge/types.ts";
import type { BuildReviewLearningMemoryRecordInput, ReviewLearningMemoryDecision } from "../src/handlers/review-learning-memory.ts";

function packageJsonWithExpectedScript(): string {
  return JSON.stringify({ scripts: { [COMMAND_NAME]: EXPECTED_PACKAGE_SCRIPT } });
}

describe("verify-m075-s02", () => {
  test("parses bounded CLI arguments and rejects unknown flags", () => {
    expect(parseM075S02Args([])).toEqual({ json: false, help: false, simulateUnsafeBoundary: false });
    expect(parseM075S02Args(["--json"])).toEqual({ json: true, help: false, simulateUnsafeBoundary: false });
    expect(parseM075S02Args(["--simulate-unsafe-boundary"])).toEqual({ json: false, help: false, simulateUnsafeBoundary: true });
    expect(parseM075S02Args(["--help"])).toEqual({ json: false, help: true, simulateUnsafeBoundary: false });
    expect(parseM075S02Args(["-h"])).toEqual({ json: false, help: true, simulateUnsafeBoundary: false });
    expect(() => parseM075S02Args(["--fixture", ".gsd/secret.json"])).toThrow(/invalid_cli_args/);
  });

  test("emits a passing report for the hardened memory-store and review-helper contract", async () => {
    const report = await evaluateM075S02Contract({
      generatedAt: "2026-05-20T14:00:00.000Z",
      readPackageJsonText: async () => packageJsonWithExpectedScript(),
    });

    expect(report).toMatchObject({
      command: COMMAND_NAME,
      generatedAt: "2026-05-20T14:00:00.000Z",
      success: true,
      statusCode: "m075_s02_ok",
      failedCheckIds: [],
    });
    expect(report.checks.map((check) => check.id)).toEqual([...M075_S02_CHECK_IDS]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("fails closed when required undefined fields are allowed through the SQL boundary", async () => {
    const report = await evaluateM075S02Contract({
      readPackageJsonText: async () => packageJsonWithExpectedScript(),
      prepareRecordForSql: (record: LearningMemoryRecord) => ({
        repo: record.repo,
        owner: record.owner,
        findingId: record.findingId,
        reviewId: record.reviewId,
        sourceRepo: record.sourceRepo,
        findingText: record.findingText,
        severity: record.severity,
        category: record.category,
        filePath: record.filePath,
        language: record.language as string | null,
        outcome: record.outcome,
        embeddingModel: record.embeddingModel,
        embeddingDim: record.embeddingDim,
        stale: record.stale,
        id: record.id as number | null,
        createdAt: record.createdAt as string | null,
      }),
    });

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("memory-store-required-fields");
    expect(report.failedCheckIds).toContain("memory-store-optional-fields");
  });

  test("fails closed when missing comment ids become candidates instead of bounded skips", async () => {
    const unsafeBuilder = (_input: BuildReviewLearningMemoryRecordInput): ReviewLearningMemoryDecision => ({
      kind: "candidate",
      embeddingText: "unsafe candidate",
      toRecord: () => ({
        repo: "acme/widgets",
        owner: "acme",
        findingId: undefined as unknown as number,
        reviewId: 42,
        sourceRepo: "acme/widgets",
        findingText: "Unsafe",
        severity: "major",
        category: "correctness",
        filePath: "src/widget.ts",
        outcome: "accepted",
        embeddingModel: "voyage-code-3",
        embeddingDim: 1024,
        stale: false,
      }),
    });

    const report = await evaluateM075S02Contract({
      readPackageJsonText: async () => packageJsonWithExpectedScript(),
      buildReviewRecord: unsafeBuilder,
    });

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("review-helper-missing-comment-id");
  });

  test("fails closed when package wiring drifts", async () => {
    const report = await evaluateM075S02Contract({
      readPackageJsonText: async () => JSON.stringify({ scripts: { [COMMAND_NAME]: "bun scripts/other.ts" } }),
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m075_s02_contract_failed");
    expect(report.failedCheckIds).toEqual(["package-wiring"]);
  });

  test("CLI exits nonzero for the simulated unsafe boundary", async () => {
    const exitCode = await main(["--simulate-unsafe-boundary", "--json"]);
    expect(exitCode).toBe(1);
  });
});
