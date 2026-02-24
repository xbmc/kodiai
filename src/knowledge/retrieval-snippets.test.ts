import { describe, expect, test } from "bun:test";
import type { RetrievalResult } from "./types.ts";
import {
  buildSnippetAnchors,
  trimSnippetAnchorsToBudget,
  type SnippetAnchor,
} from "./retrieval-snippets.ts";

type FindingOverrides = Partial<Omit<RetrievalResult, "record">> & {
  record?: Partial<RetrievalResult["record"]>;
};

function makeFinding(overrides: FindingOverrides = {}): RetrievalResult {
  const base: RetrievalResult = {
    memoryId: 1,
    distance: 0.22,
    sourceRepo: "acme/service",
    record: {
      id: 1,
      repo: "service",
      owner: "acme",
      findingId: 1,
      reviewId: 101,
      sourceRepo: "acme/service",
      findingText: "Missing null check before reading session token",
      severity: "major",
      category: "correctness",
      filePath: "src/auth/session.ts",
      outcome: "accepted",
      embeddingModel: "test",
      embeddingDim: 1024,
      stale: false,
      createdAt: "2026-02-17T00:00:00.000Z",
    },
  };

  return {
    ...base,
    ...overrides,
    record: {
      ...base.record,
      ...(overrides.record ?? {}),
    },
  };
}

describe("buildSnippetAnchors", () => {
  test("creates path:line anchors with bounded snippets when evidence matches", async () => {
    const finding = makeFinding({
      record: {
        findingText: "missing null check before reading session token",
        filePath: "src/auth/session.ts",
      },
    });

    const anchors = await buildSnippetAnchors({
      workspaceDir: "/repo",
      findings: [finding],
      readFile: async () => [
        "export function readSession(session: Session | null) {",
        "  const token = session.token;",
        "  return token;",
        "}",
      ].join("\n"),
    });

    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.anchor).toBe("src/auth/session.ts:2");
    expect(anchors[0]?.line).toBe(2);
    expect(anchors[0]?.snippet).toContain("const token = session.token;");
    expect(anchors[0]?.snippet).not.toContain("\n");
    expect(anchors[0]?.snippet).not.toContain("`");
  });

  test("fails open to path-only anchors when file read fails", async () => {
    const finding = makeFinding({
      record: {
        filePath: "src/missing/file.ts",
      },
    });

    const anchors = await buildSnippetAnchors({
      workspaceDir: "/repo",
      findings: [finding],
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });

    expect(anchors).toEqual([
      {
        path: "src/missing/file.ts",
        line: undefined,
        anchor: "src/missing/file.ts",
        snippet: undefined,
        distance: finding.distance,
      } satisfies SnippetAnchor,
    ]);
  });

  test("returns empty list for empty findings", async () => {
    const anchors = await buildSnippetAnchors({
      workspaceDir: "/repo",
      findings: [],
      readFile: async () => "",
    });

    expect(anchors).toEqual([]);
  });
});

describe("trimSnippetAnchorsToBudget", () => {
  const anchors: SnippetAnchor[] = [
    { path: "src/a.ts", line: 10, anchor: "src/a.ts:10", snippet: "critical null check", distance: 0.1 },
    { path: "src/b.ts", line: 20, anchor: "src/b.ts:20", snippet: "error handling", distance: 0.2 },
    { path: "src/c.ts", line: 30, anchor: "src/c.ts:30", snippet: "slow query", distance: 0.7 },
    { path: "src/d.ts", line: 40, anchor: "src/d.ts:40", snippet: "unused branch", distance: 0.9 },
  ];

  test("drops highest-distance anchors first when caps are exceeded", () => {
    const trimmed = trimSnippetAnchorsToBudget({
      anchors,
      maxItems: 2,
      maxChars: 10_000,
    });

    expect(trimmed).toHaveLength(2);
    expect(trimmed.map((anchor: SnippetAnchor) => anchor.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("kept anchors remain sorted by relevance", () => {
    const trimmed = trimSnippetAnchorsToBudget({
      anchors,
      maxItems: 3,
      maxChars: 10_000,
    });

    expect(trimmed.map((anchor: SnippetAnchor) => anchor.distance)).toEqual([0.1, 0.2, 0.7]);
  });

  test("equivalent input order produces deterministic output", () => {
    const a = trimSnippetAnchorsToBudget({
      anchors,
      maxItems: 3,
      maxChars: 120,
    });
    const b = trimSnippetAnchorsToBudget({
      anchors: [anchors[2]!, anchors[0]!, anchors[3]!, anchors[1]!],
      maxItems: 3,
      maxChars: 120,
    });

    expect(a).toEqual(b);
  });
});
