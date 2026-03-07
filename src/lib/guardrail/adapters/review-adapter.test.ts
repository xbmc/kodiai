import { describe, expect, test } from "bun:test";
import {
  reviewAdapter,
  type ReviewInput,
  type ReviewOutput,
} from "./review-adapter.ts";
import type { DiffContext } from "../../claim-classifier.ts";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeDiffContext(added: string[] = [], removed: string[] = []): DiffContext {
  return {
    rawPatch: [...added.map((l) => `+${l}`), ...removed.map((l) => `-${l}`)].join("\n"),
    addedLines: added,
    removedLines: removed,
    contextLines: [],
  };
}

describe("reviewAdapter", () => {
  test("surface is 'review'", () => {
    expect(reviewAdapter.surface).toBe("review");
  });

  test("minContentThreshold is 10", () => {
    expect(reviewAdapter.minContentThreshold).toBe(10);
  });

  test("extractClaims extracts sentences from finding titles", () => {
    const output: ReviewOutput = {
      findings: [
        {
          commentId: 1,
          filePath: "src/foo.ts",
          title: "This removes the handler. It could cause issues.",
          severity: "medium",
          category: "bug",
        },
        {
          commentId: 2,
          filePath: "src/bar.ts",
          title: "Single claim finding.",
          severity: "minor",
          category: "style",
        },
      ],
    };

    const claims = reviewAdapter.extractClaims(output);
    expect(claims.length).toBe(3);
    expect(claims).toContain("This removes the handler.");
    expect(claims).toContain("It could cause issues.");
    expect(claims).toContain("Single claim finding.");
  });

  test("extractClaims returns empty array for empty findings", () => {
    const output: ReviewOutput = { findings: [] };
    const claims = reviewAdapter.extractClaims(output);
    expect(claims).toEqual([]);
  });

  test("buildGroundingContext builds from fileDiffs, prDescription, and commitMessages", () => {
    const fileDiffs = new Map<string, DiffContext>();
    fileDiffs.set("src/foo.ts", makeDiffContext(["const x = 1;"], ["const x = 0;"]));

    const input: ReviewInput = {
      findings: [],
      fileDiffs,
      prDescription: "Fix the connection pool handler",
      commitMessages: ["fix: remove deprecated pool"],
    };

    const ctx = reviewAdapter.buildGroundingContext(input);

    expect(ctx.contextSources).toContain("pr-description");
    expect(ctx.contextSources).toContain("commit-messages");
    expect(ctx.contextSources).toContain("diff");
    expect(ctx.providedContext).toContain("Fix the connection pool handler");
    expect(ctx.providedContext).toContain("fix: remove deprecated pool");
    // diffContext should be set (merged from fileDiffs)
    expect(ctx.diffContext).toBeDefined();
  });

  test("buildGroundingContext handles null prDescription", () => {
    const input: ReviewInput = {
      findings: [],
      fileDiffs: new Map(),
      prDescription: null,
      commitMessages: [],
    };

    const ctx = reviewAdapter.buildGroundingContext(input);
    expect(ctx.providedContext).toEqual([]);
    expect(ctx.contextSources).toEqual([]);
  });

  test("reconstructOutput delegates to filterExternalClaims, removing external-knowledge findings", () => {
    // Create findings where one has all external claims and another is grounded
    const output: ReviewOutput = {
      findings: [
        {
          commentId: 1,
          filePath: "src/foo.ts",
          title: "This removes the handler.",
          severity: "medium",
          category: "bug",
          claimClassification: {
            summaryLabel: "primarily-diff-grounded",
            claims: [
              { text: "This removes the handler.", label: "diff-grounded", confidence: 0.9 },
            ],
          },
        },
        {
          commentId: 2,
          filePath: "src/bar.ts",
          title: "This was released in March 2024.",
          severity: "minor",
          category: "info",
          claimClassification: {
            summaryLabel: "primarily-external",
            claims: [
              { text: "This was released in March 2024.", label: "external-knowledge", confidence: 0.9 },
            ],
          },
        },
      ],
    };

    // keptClaims contains only the grounded claim
    const keptClaims = ["This removes the handler."];

    const result = reviewAdapter.reconstructOutput(output, keptClaims);

    // The primarily-external finding should be removed
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].commentId).toBe(1);
  });

  test("reconstructOutput keeps findings with mixed claims when some claims are kept", () => {
    const output: ReviewOutput = {
      findings: [
        {
          commentId: 1,
          filePath: "src/foo.ts",
          title: "This removes the handler. CVE-2024-1234 is relevant.",
          severity: "medium",
          category: "bug",
          claimClassification: {
            summaryLabel: "mixed",
            claims: [
              { text: "This removes the handler.", label: "diff-grounded", confidence: 0.9 },
              { text: "CVE-2024-1234 is relevant.", label: "external-knowledge", confidence: 0.95 },
            ],
          },
        },
      ],
    };

    const keptClaims = ["This removes the handler."];
    const result = reviewAdapter.reconstructOutput(output, keptClaims);

    // Finding should be kept but with rewritten title (external claim removed)
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].title).not.toContain("CVE-2024-1234");
    expect(result.findings[0].title).toContain("This removes the handler.");
  });
});
