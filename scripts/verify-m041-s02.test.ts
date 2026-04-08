import { describe, expect, test } from "bun:test";
import {
  M041_S02_CHECK_IDS,
  evaluateM041S02,
  buildM041S02ProofHarness,
  runBackfillStoresCanonicalChunksCheck,
  runRetrievalReturnsCanonicalCurrentCodeCheck,
  runRetrievalPreservesCorpusSeparationCheck,
  runNonMainDefaultBranchCheck,
  type M041S02ProofFixtureResult,
  type M041S02EvaluationReport,
} from "./verify-m041-s02.ts";

function makeFixtureResult(overrides?: Partial<M041S02ProofFixtureResult>): M041S02ProofFixtureResult {
  const base: M041S02ProofFixtureResult = {
    backfill: {
      status: "completed",
      canonicalRef: "trunk",
      commitSha: "abc123",
      filesDone: 3,
      chunksDone: 3,
      chunksFailed: 0,
      warnings: 0,
    },
    canonicalStoreRows: [
      {
        repo: "repo",
        owner: "owner",
        canonicalRef: "trunk",
        commitSha: "abc123",
        filePath: "src/auth/token.ts",
        chunkType: "function",
        symbolName: "rotateToken",
        contentHash: "sha256:token",
      },
    ],
    retrieval: {
      canonicalRefRequested: "trunk",
      canonicalCodeCount: 1,
      snippetCount: 1,
      unifiedSources: ["canonical_code", "snippet"],
      topUnifiedSource: "canonical_code",
      topUnifiedLabel: "[canonical: src/auth/token.ts:1-4 @ trunk]",
      topCanonicalFilePath: "src/auth/token.ts",
      topSnippetFilePath: "src/legacy/token-rotation.patch.ts",
      contextWindow: "[canonical: src/auth/token.ts:1-4 @ trunk]: current code\n\n[snippet] PR #41: old diff",
    },
  };

  return {
    ...base,
    ...overrides,
    backfill: { ...base.backfill, ...overrides?.backfill },
    retrieval: { ...base.retrieval, ...overrides?.retrieval },
    canonicalStoreRows: overrides?.canonicalStoreRows ?? base.canonicalStoreRows,
  };
}

describe("M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runBackfillStoresCanonicalChunksCheck();

    expect(result.id).toBe("M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("backfill_persisted_canonical_snapshot_rows");
    expect(result.detail).toContain("storedRows=");
  });

  test("fails when backfill is partial", async () => {
    const result = await runBackfillStoresCanonicalChunksCheck(async () =>
      makeFixtureResult({ backfill: { status: "partial", chunksFailed: 1, canonicalRef: "trunk", commitSha: "abc123", filesDone: 3, chunksDone: 3, warnings: 0 } }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("canonical_backfill_verification_failed");
    expect(result.detail).toContain("backfill status=partial");
  });

  test("fails when no canonical rows were stored", async () => {
    const result = await runBackfillStoresCanonicalChunksCheck(async () =>
      makeFixtureResult({ canonicalStoreRows: [] }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("canonicalStoreRows is empty");
  });
});

describe("M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runRetrievalReturnsCanonicalCurrentCodeCheck();

    expect(result.id).toBe("M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("retrieval_prefers_canonical_current_code");
    expect(result.detail).toContain("canonicalCodeCount=");
    expect(result.detail).toContain("topCanonicalFilePath=src/auth/token.ts");
  });

  test("fails when canonical evidence disappears from the returned retrieval surface", async () => {
    const result = await runRetrievalReturnsCanonicalCurrentCodeCheck(async () =>
      makeFixtureResult({
        retrieval: {
          canonicalRefRequested: "trunk",
          canonicalCodeCount: 0,
          snippetCount: 1,
          unifiedSources: ["snippet"],
          topUnifiedSource: "snippet",
          topUnifiedLabel: "[snippet] PR #41: old diff",
          topCanonicalFilePath: null,
          topSnippetFilePath: "src/legacy/token-rotation.patch.ts",
          contextWindow: "[snippet] PR #41: old diff",
        },
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("canonicalCodeCount=0");
  });

  test("fails when canonical count is zero", async () => {
    const result = await runRetrievalReturnsCanonicalCurrentCodeCheck(async () =>
      makeFixtureResult({ retrieval: { canonicalRefRequested: "trunk", canonicalCodeCount: 0, snippetCount: 1, unifiedSources: ["canonical_code", "snippet"], topUnifiedSource: "canonical_code", topUnifiedLabel: "[canonical: src/auth/token.ts:1-4 @ trunk]", topCanonicalFilePath: "src/auth/token.ts", topSnippetFilePath: "src/legacy/token-rotation.patch.ts", contextWindow: "[canonical: src/auth/token.ts:1-4 @ trunk]: current code\n\n[snippet] PR #41: old diff" } }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("canonicalCodeCount=0");
  });
});

describe("M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runRetrievalPreservesCorpusSeparationCheck();

    expect(result.id).toBe("M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("retrieval_keeps_canonical_and_historical_corpora_distinct");
    expect(result.detail).toContain("snippetCount=1");
  });

  test("fails when snippet provenance disappears", async () => {
    const result = await runRetrievalPreservesCorpusSeparationCheck(async () =>
      makeFixtureResult({
        retrieval: {
          canonicalRefRequested: "trunk",
          canonicalCodeCount: 1,
          snippetCount: 0,
          unifiedSources: ["canonical_code"],
          topUnifiedSource: "canonical_code",
          topUnifiedLabel: "[canonical: src/auth/token.ts:1-4 @ trunk]",
          topCanonicalFilePath: "src/auth/token.ts",
          topSnippetFilePath: null,
          contextWindow: "[canonical: src/auth/token.ts:1-4 @ trunk]: current code",
        },
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("snippetCount=0");
    expect(result.detail).toContain("contextWindow missing snippet label");
  });
});

describe("M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runNonMainDefaultBranchCheck();

    expect(result.id).toBe("M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("nonmain_default_branch_propagated_end_to_end");
    expect(result.detail).toContain("trunk");
  });

  test("fails when retrieval still asks for main", async () => {
    const result = await runNonMainDefaultBranchCheck(async () =>
      makeFixtureResult({ retrieval: { canonicalRefRequested: "main", canonicalCodeCount: 1, snippetCount: 1, unifiedSources: ["canonical_code", "snippet"], topUnifiedSource: "canonical_code", topUnifiedLabel: "[canonical: src/auth/token.ts:1-4 @ trunk]", topCanonicalFilePath: "src/auth/token.ts", topSnippetFilePath: "src/legacy/token-rotation.patch.ts", contextWindow: "[canonical: src/auth/token.ts:1-4 @ trunk]: current code\n\n[snippet] PR #41: old diff" } }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("canonical_ref_propagation_failed");
    expect(result.detail).toContain("retrieval canonicalRefRequested=main");
  });
});

describe("evaluateM041S02", () => {
  test("returns all four check ids and passes with real fixtures", async () => {
    const report = await evaluateM041S02();

    expect(report.check_ids).toStrictEqual(M041_S02_CHECK_IDS);
    expect(report.checks).toHaveLength(4);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed && !check.skipped)).toBe(true);
  });

  test("overallPassed is false when a check fails", async () => {
    const report = await evaluateM041S02({
      _runFixture: async () =>
        makeFixtureResult({
          retrieval: {
            canonicalRefRequested: "main",
            canonicalCodeCount: 1,
            snippetCount: 1,
            unifiedSources: ["canonical_code", "snippet"],
            topUnifiedSource: "canonical_code",
            topUnifiedLabel: "[canonical: src/auth/token.ts:1-4 @ trunk]",
            topCanonicalFilePath: "src/auth/token.ts",
            topSnippetFilePath: "src/legacy/token-rotation.patch.ts",
            contextWindow: "[canonical: src/auth/token.ts:1-4 @ trunk]: current code\n\n[snippet] PR #41: old diff",
          },
        }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => !check.passed)?.id).toBe(
      "M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED",
    );
  });
});

describe("buildM041S02ProofHarness", () => {
  test("prints text output containing all four check ids", async () => {
    const chunks: string[] = [];
    const stdout = { write: (chunk: string) => void chunks.push(chunk) };
    const stderr = { write: (_chunk: string) => undefined };

    const { exitCode } = await buildM041S02ProofHarness({ stdout, stderr });
    const output = chunks.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS");
    expect(output).toContain("M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE");
    expect(output).toContain("M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION");
    expect(output).toContain("M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED");
    expect(output).toContain("Final verdict: PASS");
  });

  test("prints valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (chunk: string) => void chunks.push(chunk) };
    const stderr = { write: (_chunk: string) => undefined };

    await buildM041S02ProofHarness({ stdout, stderr, json: true });
    const parsed = JSON.parse(chunks.join("")) as M041S02EvaluationReport;

    expect(parsed.check_ids).toStrictEqual(Array.from(M041_S02_CHECK_IDS));
    expect(parsed.checks).toHaveLength(4);
    expect(parsed.overallPassed).toBe(true);
  });

  test("returns exitCode 1 and stderr message when a check fails", async () => {
    const stdout = { write: (_chunk: string) => undefined };
    const stderrChunks: string[] = [];
    const stderr = { write: (chunk: string) => void stderrChunks.push(chunk) };

    const { exitCode } = await buildM041S02ProofHarness({
      stdout,
      stderr,
      _runFixture: async () =>
        makeFixtureResult({
          retrieval: {
            canonicalRefRequested: "main",
            canonicalCodeCount: 1,
            snippetCount: 1,
            unifiedSources: ["canonical_code", "snippet"],
            topUnifiedSource: "canonical_code",
            topUnifiedLabel: "[canonical: src/auth/token.ts:1-4 @ trunk]",
            topCanonicalFilePath: "src/auth/token.ts",
            topSnippetFilePath: "src/legacy/token-rotation.patch.ts",
            contextWindow: "[canonical: src/auth/token.ts:1-4 @ trunk]: current code\n\n[snippet] PR #41: old diff",
          },
        }),
    });

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m041:s02 failed");
    expect(stderrChunks.join("")).toContain("M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED");
  });
});
