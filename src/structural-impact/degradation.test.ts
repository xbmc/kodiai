import { describe, expect, test } from "bun:test";
import type { StructuralImpactPayload } from "./types.ts";
import { summarizeStructuralImpactDegradation } from "./degradation.ts";

function makePayload(overrides: Partial<StructuralImpactPayload> = {}): StructuralImpactPayload {
  return {
    status: "ok",
    changedFiles: ["src/service.ts"],
    seedSymbols: [],
    impactedFiles: [],
    probableCallers: [],
    likelyTests: [],
    graphStats: null,
    canonicalEvidence: [],
    degradations: [],
    ...overrides,
  };
}

describe("summarizeStructuralImpactDegradation", () => {
  test("keeps ok status when both substrates are available even if corpus returns no matches", () => {
    const summary = summarizeStructuralImpactDegradation(
      makePayload({
        status: "ok",
        graphStats: {
          files: 12,
          nodes: 42,
          edges: 90,
          changedFilesFound: 1,
          changedFilesRequested: 1,
        },
      }),
    );

    expect(summary.status).toBe("ok");
    expect(summary.availability).toEqual({ graphAvailable: true, corpusAvailable: true });
    expect(summary.truthfulnessSignals).toContain("corpus-empty");
    expect(summary.fallbackUsed).toBe(false);
  });

  test("forces partial status when graph degradation exists even if payload status was ok", () => {
    const summary = summarizeStructuralImpactDegradation(
      makePayload({
        status: "ok",
        canonicalEvidence: [
          {
            filePath: "src/related.ts",
            language: "ts",
            startLine: 1,
            endLine: 4,
            chunkType: "function",
            symbolName: "helper",
            chunkText: "export function helper() {}",
            distance: 0.2,
            commitSha: "abc",
            canonicalRef: "main",
          },
        ],
        degradations: [{ source: "graph", reason: "graph adapter unavailable" }],
      }),
    );

    expect(summary.status).toBe("partial");
    expect(summary.availability.graphAvailable).toBe(false);
    expect(summary.availability.corpusAvailable).toBe(true);
    expect(summary.truthfulnessSignals).toContain("graph-unavailable");
    expect(summary.fallbackUsed).toBe(true);
  });

  test("forces unavailable status when both substrates degraded", () => {
    const summary = summarizeStructuralImpactDegradation(
      makePayload({
        status: "partial",
        degradations: [
          { source: "graph", reason: "timed out after 50ms" },
          { source: "corpus", reason: "timed out after 50ms" },
        ],
      }),
    );

    expect(summary.status).toBe("unavailable");
    expect(summary.availability).toEqual({ graphAvailable: false, corpusAvailable: false });
    expect(summary.truthfulnessSignals).toEqual([
      "graph-unavailable",
      "corpus-unavailable",
      "no-structural-evidence",
    ]);
  });

  test("marks graph-empty when graph is available but contributes no evidence", () => {
    const summary = summarizeStructuralImpactDegradation(
      makePayload({
        status: "ok",
        canonicalEvidence: [
          {
            filePath: "src/related.ts",
            language: "ts",
            startLine: 10,
            endLine: 18,
            chunkType: "function",
            symbolName: "helper",
            chunkText: "export function helper() { return true; }",
            distance: 0.12,
            commitSha: "abc",
            canonicalRef: "main",
          },
        ],
      }),
    );

    expect(summary.status).toBe("ok");
    expect(summary.truthfulnessSignals).toContain("graph-empty");
    expect(summary.truthfulnessSignals).not.toContain("no-structural-evidence");
    expect(summary.hasRenderableEvidence).toBe(true);
  });
});
