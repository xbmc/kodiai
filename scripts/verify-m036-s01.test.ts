import { describe, expect, test } from "bun:test";
import {
  M036_S01_CHECK_IDS,
  evaluateM036S01,
  buildM036S01ProofHarness,
  runProposalCreatedFromPositiveCluster,
  runFailOpenCheck,
} from "./verify-m036-s01.ts";
import type { EvaluationReport } from "./verify-m036-s01.ts";

describe("M036-S01-PROPOSAL-CREATED", () => {
  test("passes with the real deterministic sweep fixture", async () => {
    const result = await runProposalCreatedFromPositiveCluster();
    expect(result.id).toBe("M036-S01-PROPOSAL-CREATED");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("proposal_created_from_positive_cluster");
    expect(result.detail).toContain("representativeMemoryId=1");
  });

  test("fails when injected run returns no persisted proposals", async () => {
    const result = await runProposalCreatedFromPositiveCluster(async () => ({
      result: {
        repoCount: 1,
        reposProcessed: 1,
        reposWithProposals: 0,
        reposFailed: 0,
        proposalsGenerated: 0,
        proposalsPersisted: 0,
        persistFailures: 0,
        dryRun: false,
        durationMs: 1,
        repoResults: [{
          repo: "xbmc/xbmc",
          proposalCount: 0,
          persistedCount: 0,
          persistFailureCount: 0,
          representativeMemoryIds: [],
        }],
      },
      savedRules: [],
    }));

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("proposal_not_created");
    expect(result.detail).toContain("no proposals were persisted");
  });
});

describe("M036-S01-FAIL-OPEN", () => {
  test("passes with the real fail-open fixture", async () => {
    const result = await runFailOpenCheck();
    expect(result.id).toBe("M036-S01-FAIL-OPEN");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("sweep_fail_open");
    expect(result.detail).toContain("reposFailed=1");
    expect(result.detail).toContain("persistFailures=1");
  });

  test("fails when injected run stops instead of continuing", async () => {
    const result = await runFailOpenCheck(async () => ({
      result: {
        repoCount: 3,
        reposProcessed: 1,
        reposWithProposals: 1,
        reposFailed: 0,
        proposalsGenerated: 1,
        proposalsPersisted: 0,
        persistFailures: 0,
        dryRun: false,
        durationMs: 1,
        repoResults: [{
          repo: "xbmc/xbmc",
          proposalCount: 1,
          persistedCount: 0,
          persistFailureCount: 0,
          representativeMemoryIds: [1],
        }],
      },
      warnCount: 0,
    }));

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("sweep_not_fail_open");
  });
});

describe("evaluateM036S01", () => {
  test("returns both check ids and passes with real fixtures", async () => {
    const report = await evaluateM036S01();
    expect(report.check_ids).toStrictEqual(M036_S01_CHECK_IDS);
    expect(report.checks.length).toBe(2);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed && !check.skipped)).toBe(true);
  });

  test("overallPassed is false when one check fails", async () => {
    const report = await evaluateM036S01({
      _proposalRunFn: async () => ({
        result: {
          repoCount: 1,
          reposProcessed: 1,
          reposWithProposals: 0,
          reposFailed: 0,
          proposalsGenerated: 0,
          proposalsPersisted: 0,
          persistFailures: 0,
          dryRun: false,
          durationMs: 1,
          repoResults: [{
            repo: "xbmc/xbmc",
            proposalCount: 0,
            persistedCount: 0,
            persistFailureCount: 0,
            representativeMemoryIds: [],
          }],
        },
        savedRules: [],
      }),
    });

    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((check) => !check.passed && !check.skipped);
    expect(failing.length).toBe(1);
    expect(failing[0]!.id).toBe("M036-S01-PROPOSAL-CREATED");
  });
});

describe("buildM036S01ProofHarness", () => {
  test("prints text output with both check ids", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    const { exitCode } = await buildM036S01ProofHarness({ stdout, stderr });
    const output = chunks.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("M036-S01-PROPOSAL-CREATED");
    expect(output).toContain("M036-S01-FAIL-OPEN");
    expect(output).toContain("Final verdict: PASS");
  });

  test("prints valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM036S01ProofHarness({ stdout, stderr, json: true });
    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;

    expect(parsed.check_ids).toStrictEqual(Array.from(M036_S01_CHECK_IDS));
    expect(parsed.checks.length).toBe(2);
    expect(typeof parsed.overallPassed).toBe("boolean");
  });

  test("returns exitCode 1 and stderr message when a check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderrChunks: string[] = [];
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };

    const { exitCode } = await buildM036S01ProofHarness({
      stdout,
      stderr,
      _proposalRunFn: async () => ({
        result: {
          repoCount: 1,
          reposProcessed: 1,
          reposWithProposals: 0,
          reposFailed: 0,
          proposalsGenerated: 0,
          proposalsPersisted: 0,
          persistFailures: 0,
          dryRun: false,
          durationMs: 1,
          repoResults: [{
            repo: "xbmc/xbmc",
            proposalCount: 0,
            persistedCount: 0,
            persistFailureCount: 0,
            representativeMemoryIds: [],
          }],
        },
        savedRules: [],
      }),
    });

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m036:s01 failed");
  });
});
