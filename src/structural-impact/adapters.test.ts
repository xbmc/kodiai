import { describe, expect, test } from "bun:test";
import type { GraphAdapter, GraphBlastRadiusResult, CorpusAdapter, CorpusCodeMatch } from "./adapters.ts";
import { boundStructuralImpactPayload } from "./adapters.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeGraphResult(overrides?: Partial<GraphBlastRadiusResult>): GraphBlastRadiusResult {
  return {
    changedFiles: ["src/service.cpp"],
    seedSymbols: [
      {
        stableKey: "src/service.cpp::helper",
        symbolName: "helper",
        qualifiedName: "helper",
        filePath: "src/service.cpp",
      },
    ],
    impactedFiles: [
      {
        path: "src/controller.cpp",
        score: 0.92,
        confidence: 1.0,
        reasons: ["calls changed symbol helper"],
        languages: ["cpp"],
      },
      {
        path: "tests/service_test.cpp",
        score: 0.88,
        confidence: 0.95,
        reasons: ["tests changed symbol helper"],
        languages: ["cpp"],
      },
    ],
    probableDependents: [
      {
        stableKey: "src/controller.cpp::executeController",
        symbolName: "executeController",
        qualifiedName: "executeController",
        filePath: "src/controller.cpp",
        score: 0.92,
        confidence: 1.0,
        reasons: ["calls changed symbol helper"],
      },
    ],
    likelyTests: [
      {
        path: "tests/service_test.cpp",
        score: 1.03,
        confidence: 0.95,
        reasons: ["tests changed symbol helper"],
        testSymbols: ["ServiceTest_runs_helper"],
      },
    ],
    graphStats: {
      files: 4,
      nodes: 12,
      edges: 8,
      changedFilesFound: 1,
    },
    ...overrides,
  };
}

function makeCorpusMatch(overrides?: Partial<CorpusCodeMatch>): CorpusCodeMatch {
  return {
    filePath: "src/parser.py",
    language: "python",
    startLine: 10,
    endLine: 25,
    chunkType: "function",
    symbolName: "parse_token",
    chunkText: "def parse_token(value):\n    return value.strip()\n",
    distance: 0.18,
    commitSha: "abc123",
    canonicalRef: "main",
    ...overrides,
  };
}

// ── Stub implementations ──────────────────────────────────────────────────────

function makeGraphAdapter(result: GraphBlastRadiusResult): GraphAdapter {
  return {
    async queryBlastRadius() {
      return result;
    },
  };
}

function makeFailingGraphAdapter(message: string): GraphAdapter {
  return {
    async queryBlastRadius() {
      throw new Error(message);
    },
  };
}

function makeCorpusAdapter(matches: CorpusCodeMatch[]): CorpusAdapter {
  return {
    async searchCanonicalCode() {
      return matches;
    },
  };
}

function makeFailingCorpusAdapter(message: string): CorpusAdapter {
  return {
    async searchCanonicalCode() {
      throw new Error(message);
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("boundStructuralImpactPayload", () => {
  test("status is 'ok' when both graph and corpus return results", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: makeGraphResult(),
      corpusMatches: [makeCorpusMatch()],
      changedPaths: ["src/service.cpp"],
      degradations: [],
    });

    expect(payload.status).toBe("ok");
    expect(payload.degradations).toHaveLength(0);
  });

  test("status is 'partial' when only graph returns results", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: makeGraphResult(),
      corpusMatches: [],
      changedPaths: ["src/service.cpp"],
      degradations: [{ source: "corpus", reason: "timeout" }],
    });

    expect(payload.status).toBe("partial");
    expect(payload.canonicalEvidence).toHaveLength(0);
    expect(payload.degradations).toHaveLength(1);
    expect(payload.degradations[0]?.source).toBe("corpus");
  });

  test("status is 'partial' when only corpus returns results", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: null,
      corpusMatches: [makeCorpusMatch()],
      changedPaths: ["src/service.cpp"],
      degradations: [{ source: "graph", reason: "graph not indexed for this repo" }],
    });

    expect(payload.status).toBe("partial");
    expect(payload.canonicalEvidence).toHaveLength(1);
    expect(payload.impactedFiles).toHaveLength(0);
    expect(payload.probableCallers).toHaveLength(0);
    expect(payload.graphStats).toBeNull();
  });

  test("status is 'unavailable' when both sources produce no results", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: null,
      corpusMatches: [],
      changedPaths: ["src/service.cpp"],
      degradations: [
        { source: "graph", reason: "timeout" },
        { source: "corpus", reason: "timeout" },
      ],
    });

    expect(payload.status).toBe("unavailable");
    expect(payload.degradations).toHaveLength(2);
    expect(payload.impactedFiles).toHaveLength(0);
    expect(payload.canonicalEvidence).toHaveLength(0);
    expect(payload.graphStats).toBeNull();
  });

  test("propagates changedFiles from changedPaths when graph is null", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: null,
      corpusMatches: [],
      changedPaths: ["src/foo.cpp", "src/bar.cpp"],
      degradations: [{ source: "graph", reason: "error" }],
    });

    expect(payload.changedFiles).toEqual(["src/foo.cpp", "src/bar.cpp"]);
  });

  test("translates graph impactedFiles to StructuralImpactFile shape", () => {
    const graphResult = makeGraphResult();
    const payload = boundStructuralImpactPayload({
      graphResult,
      corpusMatches: [],
      changedPaths: ["src/service.cpp"],
      degradations: [],
    });

    expect(payload.impactedFiles).toHaveLength(2);
    const controller = payload.impactedFiles.find((f) => f.path === "src/controller.cpp");
    expect(controller).toBeDefined();
    expect(controller?.score).toBe(0.92);
    expect(controller?.confidence).toBe(1.0);
    expect(controller?.languages).toContain("cpp");
    expect(controller?.reasons).toContain("calls changed symbol helper");
  });

  test("translates probableDependents to StructuralCaller shape", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: makeGraphResult(),
      corpusMatches: [],
      changedPaths: ["src/service.cpp"],
      degradations: [],
    });

    expect(payload.probableCallers).toHaveLength(1);
    const caller = payload.probableCallers[0]!;
    expect(caller.symbolName).toBe("executeController");
    expect(caller.qualifiedName).toBe("executeController");
    expect(caller.filePath).toBe("src/controller.cpp");
    expect(caller.confidence).toBe(1.0);
    expect(caller.reasons).toContain("calls changed symbol helper");
  });

  test("translates likelyTests to StructuralLikelyTest shape", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: makeGraphResult(),
      corpusMatches: [],
      changedPaths: ["src/service.cpp"],
      degradations: [],
    });

    expect(payload.likelyTests).toHaveLength(1);
    const test_ = payload.likelyTests[0]!;
    expect(test_.path).toBe("tests/service_test.cpp");
    expect(test_.testSymbols).toContain("ServiceTest_runs_helper");
  });

  test("translates graphStats with changedFilesRequested from changedPaths", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: makeGraphResult(),
      corpusMatches: [],
      changedPaths: ["src/service.cpp", "src/other.cpp"],
      degradations: [],
    });

    expect(payload.graphStats).not.toBeNull();
    expect(payload.graphStats?.files).toBe(4);
    expect(payload.graphStats?.nodes).toBe(12);
    expect(payload.graphStats?.edges).toBe(8);
    expect(payload.graphStats?.changedFilesFound).toBe(1);
    expect(payload.graphStats?.changedFilesRequested).toBe(2);
  });

  test("translates corpus matches to CanonicalCodeEvidence shape", () => {
    const match = makeCorpusMatch();
    const payload = boundStructuralImpactPayload({
      graphResult: null,
      corpusMatches: [match],
      changedPaths: ["src/service.py"],
      degradations: [],
    });

    expect(payload.canonicalEvidence).toHaveLength(1);
    const evidence = payload.canonicalEvidence[0]!;
    expect(evidence.filePath).toBe("src/parser.py");
    expect(evidence.language).toBe("python");
    expect(evidence.symbolName).toBe("parse_token");
    expect(evidence.distance).toBe(0.18);
    expect(evidence.commitSha).toBe("abc123");
    expect(evidence.canonicalRef).toBe("main");
  });

  test("preserves seedSymbols from graph result", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: makeGraphResult(),
      corpusMatches: [],
      changedPaths: ["src/service.cpp"],
      degradations: [],
    });

    expect(payload.seedSymbols).toHaveLength(1);
    expect(payload.seedSymbols[0]?.symbolName).toBe("helper");
    expect(payload.seedSymbols[0]?.filePath).toBe("src/service.cpp");
  });

  test("multiple corpus matches are all included in canonicalEvidence", () => {
    const matches = [
      makeCorpusMatch({ filePath: "src/a.py", symbolName: "func_a", distance: 0.1 }),
      makeCorpusMatch({ filePath: "src/b.py", symbolName: "func_b", distance: 0.3 }),
    ];
    const payload = boundStructuralImpactPayload({
      graphResult: null,
      corpusMatches: matches,
      changedPaths: ["src/service.py"],
      degradations: [],
    });

    expect(payload.canonicalEvidence).toHaveLength(2);
    expect(payload.canonicalEvidence.map((e) => e.symbolName)).toEqual(["func_a", "func_b"]);
  });

  test("empty changedPaths with null graph produces unavailable payload", () => {
    const payload = boundStructuralImpactPayload({
      graphResult: null,
      corpusMatches: [],
      changedPaths: [],
      degradations: [],
    });

    expect(payload.status).toBe("unavailable");
    expect(payload.changedFiles).toEqual([]);
  });

  test("degradations are forwarded verbatim to payload", () => {
    const degradations = [
      { source: "graph" as const, reason: "workspace not indexed" },
      { source: "corpus" as const, reason: "embedding model unavailable" },
    ];
    const payload = boundStructuralImpactPayload({
      graphResult: null,
      corpusMatches: [],
      changedPaths: [],
      degradations,
    });

    expect(payload.degradations).toEqual(degradations);
  });
});

// ── Adapter shape tests ───────────────────────────────────────────────────────

describe("GraphAdapter contract", () => {
  test("stub adapter fulfills the GraphAdapter interface", async () => {
    const adapter = makeGraphAdapter(makeGraphResult());
    const result = await adapter.queryBlastRadius({
      repo: "owner/repo",
      workspaceKey: "wk-1",
      changedPaths: ["src/service.cpp"],
    });

    expect(result.changedFiles).toContain("src/service.cpp");
    expect(result.graphStats.files).toBeGreaterThan(0);
  });

  test("failing stub throws as expected", async () => {
    const adapter = makeFailingGraphAdapter("graph unavailable");
    await expect(adapter.queryBlastRadius({
      repo: "owner/repo",
      workspaceKey: "wk-1",
      changedPaths: ["src/service.cpp"],
    })).rejects.toThrow("graph unavailable");
  });
});

describe("CorpusAdapter contract", () => {
  test("stub adapter fulfills the CorpusAdapter interface", async () => {
    const adapter = makeCorpusAdapter([makeCorpusMatch()]);
    const results = await adapter.searchCanonicalCode({
      repo: "owner/repo",
      canonicalRef: "main",
      query: "helper function",
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.language).toBe("python");
  });

  test("failing stub throws as expected", async () => {
    const adapter = makeFailingCorpusAdapter("corpus unavailable");
    await expect(adapter.searchCanonicalCode({
      repo: "owner/repo",
      canonicalRef: "main",
      query: "helper function",
    })).rejects.toThrow("corpus unavailable");
  });
});
