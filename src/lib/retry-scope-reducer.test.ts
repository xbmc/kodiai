import { describe, expect, test } from "bun:test";
import type { FileRiskScore } from "./file-risk-scorer.ts";
import { computeRetryScope } from "./retry-scope-reducer.ts";

function makeScores(paths: string[], scores: number[]): FileRiskScore[] {
  return paths.map((filePath, idx) => ({
    filePath,
    score: scores[idx] ?? 0,
    breakdown: {
      linesChanged: 0,
      pathRisk: 0,
      fileCategory: 0,
      languageRisk: 0,
      fileExtension: 0,
    },
  }));
}

describe("computeRetryScope", () => {
  test("excludes already-reviewed files", () => {
    const allFiles = makeScores(["a.ts", "b.ts", "c.ts"], [10, 20, 30]);
    const res = computeRetryScope({
      allFiles,
      filesAlreadyReviewed: ["b.ts"],
      totalFiles: 3,
    });
    expect(res.filesToReview.some((f) => f.filePath === "b.ts")).toBe(false);
  });

  test("sorts remaining by risk score descending", () => {
    const allFiles = makeScores(["a.ts", "b.ts", "c.ts"], [10, 50, 30]);
    const res = computeRetryScope({
      allFiles,
      filesAlreadyReviewed: [],
      totalFiles: 3,
    });
    expect(res.filesToReview[0]!.filePath).toBe("b.ts");
  });

  test("at 0% reviewed: scope = 50% of remaining", () => {
    const allFiles = makeScores(
      ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts", "i.ts", "j.ts"],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    const res = computeRetryScope({
      allFiles,
      filesAlreadyReviewed: [],
      totalFiles: 10,
    });
    expect(res.scopeRatio).toBe(0.5);
    expect(res.filesToReview.length).toBe(5);
  });

  test("at 50% reviewed: scope = 75% of remaining", () => {
    const allFiles = makeScores(
      [
        "a.ts",
        "b.ts",
        "c.ts",
        "d.ts",
        "e.ts",
        "f.ts",
        "g.ts",
        "h.ts",
        "i.ts",
        "j.ts",
        "k.ts",
        "l.ts",
        "m.ts",
        "n.ts",
        "o.ts",
        "p.ts",
        "q.ts",
        "r.ts",
        "s.ts",
        "t.ts",
      ],
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const res = computeRetryScope({
      allFiles,
      filesAlreadyReviewed: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts", "i.ts", "j.ts"],
      totalFiles: 20,
    });
    expect(res.scopeRatio).toBe(0.75);
    // remaining = 10 files, ceil(10 * 0.75) = 8
    expect(res.filesToReview.length).toBe(8);
  });

  test("at 80% reviewed: scope = 90% of remaining", () => {
    const allFiles = makeScores(
      [
        "a.ts",
        "b.ts",
        "c.ts",
        "d.ts",
        "e.ts",
        "f.ts",
        "g.ts",
        "h.ts",
        "i.ts",
        "j.ts",
      ],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    const res = computeRetryScope({
      allFiles,
      filesAlreadyReviewed: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts"],
      totalFiles: 10,
    });
    expect(res.scopeRatio).toBe(0.9);
    // remaining = 2 files, ceil(2 * 0.9) = 2
    expect(res.filesToReview.length).toBe(2);
  });

  test("empty remaining returns empty array with scopeRatio 0", () => {
    const allFiles = makeScores(["a.ts"], [10]);
    const res = computeRetryScope({
      allFiles,
      filesAlreadyReviewed: ["a.ts"],
      totalFiles: 1,
    });
    expect(res.scopeRatio).toBe(0);
    expect(res.filesToReview).toEqual([]);
  });

  test("single remaining file always included", () => {
    const allFiles = makeScores(["a.ts"], [10]);
    const res = computeRetryScope({
      allFiles,
      filesAlreadyReviewed: [],
      totalFiles: 100,
    });
    expect(res.filesToReview.length).toBe(1);
    expect(res.filesToReview[0]!.filePath).toBe("a.ts");
  });
});
