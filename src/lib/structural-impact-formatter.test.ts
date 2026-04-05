import { describe, expect, it } from "bun:test";
import { buildStructuralImpactSection } from "./structural-impact-formatter.ts";
import type { StructuralImpactPayload } from "../structural-impact/types.ts";

function makePayload(overrides: Partial<StructuralImpactPayload> = {}): StructuralImpactPayload {
  return {
    status: "ok",
    changedFiles: ["src/auth.cpp"],
    seedSymbols: [
      {
        stableKey: "sym:auth:verifyToken",
        symbolName: "verifyToken",
        qualifiedName: "Auth::verifyToken",
        filePath: "src/auth.cpp",
      },
    ],
    probableCallers: [
      {
        stableKey: "sym:session:create",
        symbolName: "create",
        qualifiedName: "Session::create",
        filePath: "src/session.cpp",
        score: 0.94,
        confidence: 1,
        reasons: ["calls changed symbol Auth::verifyToken"],
      },
      {
        stableKey: "sym:auth:dispatch",
        symbolName: "dispatch",
        qualifiedName: "Auth::dispatch",
        filePath: "src/api.cpp",
        score: 0.82,
        confidence: 0.76,
        reasons: ["transitively depends on changed auth flow"],
      },
    ],
    impactedFiles: [
      {
        path: "src/session.cpp",
        score: 0.91,
        confidence: 1,
        reasons: ["contains direct callers of Auth::verifyToken"],
        languages: ["C++"],
      },
      {
        path: "src/api.cpp",
        score: 0.73,
        confidence: 0.67,
        reasons: ["imports changed auth path"],
        languages: ["C++"],
      },
    ],
    likelyTests: [
      {
        path: "tests/auth_test.cpp",
        score: 0.88,
        confidence: 0.89,
        reasons: ["test heuristic matches verifyToken"],
        testSymbols: ["test_verifyToken"],
      },
    ],
    graphStats: {
      files: 120,
      nodes: 840,
      edges: 2100,
      changedFilesFound: 1,
      changedFilesRequested: 1,
    },
    canonicalEvidence: [
      {
        filePath: "src/auth_guard.cpp",
        language: "C++",
        startLine: 10,
        endLine: 24,
        chunkType: "function",
        symbolName: "ensureAuthenticated",
        chunkText: "bool ensureAuthenticated(const Request& req) { return verifyToken(req.token()); }",
        distance: 0.11,
        commitSha: "abc123",
        canonicalRef: "main",
      },
    ],
    degradations: [],
    ...overrides,
  };
}

describe("buildStructuralImpactSection", () => {
  it("returns empty text for unavailable payload", () => {
    const result = buildStructuralImpactSection(makePayload({ status: "unavailable" }));
    expect(result.text).toBe("");
  });

  it("renders structural impact heading and graph coverage", () => {
    const result = buildStructuralImpactSection(makePayload());
    expect(result.text).toContain("### Structural Impact");
    expect(result.text).toContain("Graph coverage: 1/1 changed files resolved in graph");
    expect(result.text).toContain("Changed symbols: `Auth::verifyToken`");
  });

  it("uses truthful confidence language for stronger and probable graph evidence", () => {
    const result = buildStructuralImpactSection(makePayload());
    expect(result.text).toContain("stronger graph evidence");
    expect(result.text).toContain("probable graph evidence");
    expect(result.text).not.toContain("verified caller");
  });

  it("renders bounded summaries for callers, files, tests, and unchanged code evidence", () => {
    const result = buildStructuralImpactSection(makePayload());
    expect(result.text).toContain("Probable callers / dependents: 2/2 shown");
    expect(result.text).toContain("Impacted files: 2/2 shown");
    expect(result.text).toContain("Likely affected tests: 1/1 shown");
    expect(result.text).toContain("Unchanged-code evidence: 1/1 shown");
    expect(result.text).toContain("src/auth_guard.cpp:10-24");
  });

  it("tracks rendered counts and truncation metadata", () => {
    const result = buildStructuralImpactSection(makePayload({
      probableCallers: Array.from({ length: 8 }, (_, index) => ({
        stableKey: `caller:${index}`,
        symbolName: `caller${index}`,
        qualifiedName: `Namespace::caller${index}`,
        filePath: `src/file_${index}.cpp`,
        score: 0.9 - index * 0.05,
        confidence: 0.7,
        reasons: ["edge"],
      })),
    }));

    expect(result.stats.callersRendered).toBe(4);
    expect(result.stats.callersTotal).toBe(8);
    expect(result.stats.callersTruncated).toBe(true);
    expect(result.text).toContain("Probable callers / dependents: 4/8 shown (truncated)");
    expect(result.text).toContain("...4 more omitted to keep Review Details bounded.");
  });

  it("respects hard caps even when larger limits are requested", () => {
    const result = buildStructuralImpactSection(
      makePayload({ impactedFiles: Array.from({ length: 20 }, (_, index) => ({
        path: `src/impact_${index}.cpp`,
        score: 0.99 - index * 0.01,
        confidence: 0.8,
        reasons: ["edge"],
        languages: ["C++"],
      })) }),
      { maxFiles: 99 },
    );

    expect(result.stats.filesRendered).toBe(6);
    expect(result.stats.filesTruncated).toBe(true);
    expect(result.text).toContain("Impacted files: 6/20 shown (truncated)");
    expect(result.text).not.toContain("src/impact_6.cpp");
  });

  it("renders partial-evidence wording when only degraded data is available", () => {
    const result = buildStructuralImpactSection(makePayload({
      status: "partial",
      graphStats: null,
      probableCallers: [],
      impactedFiles: [],
      likelyTests: [],
      canonicalEvidence: [
        {
          filePath: "src/auth.py",
          language: "Python",
          startLine: 1,
          endLine: 8,
          chunkType: "function",
          symbolName: "verify_token",
          chunkText: "def verify_token(token: str) -> bool:\n    return token in cache",
          distance: 0.22,
          commitSha: "def456",
          canonicalRef: "main",
        },
      ],
      degradations: [{ source: "graph", reason: "timeout" }],
    }));

    expect(result.text).toContain("Partial structural evidence available");
    expect(result.text).toContain("Unchanged-code evidence: 1/1 shown");
    expect(result.text).not.toContain("Graph coverage:");
  });

  it("returns empty text when payload has no renderable content", () => {
    const result = buildStructuralImpactSection(makePayload({
      probableCallers: [],
      impactedFiles: [],
      likelyTests: [],
      canonicalEvidence: [],
    }));
    expect(result.text).toBe("");
  });
});
