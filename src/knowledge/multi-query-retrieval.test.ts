import { describe, expect, test } from "bun:test";
import type { RetrievalResult } from "./types.ts";
import {
  buildRetrievalVariants,
  executeRetrievalVariants,
  mergeVariantResults,
  type BuildRetrievalVariantsInput,
  type MultiQueryVariant,
  type VariantRetrievalResult,
} from "./multi-query-retrieval.ts";

function makeInput(overrides: Partial<BuildRetrievalVariantsInput> = {}): BuildRetrievalVariantsInput {
  return {
    title: "  Fix auth token   rotation  ",
    body: "   Implements stricter refresh validation and replay defenses.   ",
    conventionalType: "Feat",
    prLanguages: ["TypeScript", "Go"],
    riskSignals: ["Auth", "Token Replay"],
    filePaths: [
      "src/auth/token.ts",
      "src/auth/refresh.ts",
      "src/http/middleware.ts",
      "README.md",
    ],
    authorTier: "first-time",
    ...overrides,
  };
}

function makeResult(memoryId: number, distance: number, filePath: string): RetrievalResult {
  return {
    memoryId,
    distance,
    sourceRepo: "acme/service",
    record: {
      id: memoryId,
      repo: "service",
      owner: "acme",
      findingId: memoryId,
      reviewId: 10 + memoryId,
      sourceRepo: "acme/service",
      findingText: `Finding ${memoryId}`,
      severity: "major",
      category: "correctness",
      filePath,
      outcome: "accepted",
      embeddingModel: "test",
      embeddingDim: 1024,
      stale: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("buildRetrievalVariants", () => {
  test("always returns bounded fixed-order variants", () => {
    const variants = buildRetrievalVariants(makeInput());

    expect(variants).toHaveLength(3);
    expect(variants.map((v) => v.type)).toEqual(["intent", "file-path", "code-shape"]);
    for (const variant of variants) {
      expect(variant.query.length).toBeGreaterThan(0);
      expect(variant.query.length).toBeLessThanOrEqual(800);
    }
  });

  test("normalizes semantically equal whitespace/casing inputs", () => {
    const a = buildRetrievalVariants(makeInput());
    const b = buildRetrievalVariants(
      makeInput({
        title: "fix AUTH token rotation",
        body: "implements   stricter refresh validation and replay defenses.",
        conventionalType: "feat",
        prLanguages: ["typescript", "go"],
        riskSignals: ["auth", "token replay"],
      }),
    );

    expect(a).toEqual(b);
  });

  test("file-path variant emphasizes changed paths and trims count", () => {
    const variants = buildRetrievalVariants(
      makeInput({ filePaths: Array.from({ length: 20 }, (_, i) => `src/module-${i}/index.ts`) }),
    );

    const filePathVariant = variants.find((variant) => variant.type === "file-path") as MultiQueryVariant;
    expect(filePathVariant.query).toContain("src/module-0/index.ts");
    expect(filePathVariant.query).toContain("src/module-7/index.ts");
    expect(filePathVariant.query).not.toContain("src/module-8/index.ts");
  });

  test("code-shape variant includes language and risk tokens with bounds", () => {
    const variants = buildRetrievalVariants(makeInput());

    const codeShapeVariant = variants.find((variant) => variant.type === "code-shape") as MultiQueryVariant;
    expect(codeShapeVariant.query).toContain("typescript");
    expect(codeShapeVariant.query).toContain("go");
    expect(codeShapeVariant.query).toContain("auth");
    expect(codeShapeVariant.query.length).toBeLessThanOrEqual(800);
  });
});

describe("mergeVariantResults", () => {
  test("deduplicates overlapping variant hits and returns deterministic topK", () => {
    const variants = buildRetrievalVariants(makeInput());
    const intent = variants[0]!;
    const filePath = variants[1]!;
    const codeShape = variants[2]!;
    const shared = makeResult(1, 0.31, "src/auth/token.ts");
    const otherA = makeResult(2, 0.4, "src/auth/refresh.ts");
    const otherB = makeResult(3, 0.2, "src/http/middleware.ts");

    const mergeA = mergeVariantResults({
      topK: 3,
      resultsByVariant: [
        { variant: intent, results: [shared, otherA] },
        { variant: filePath, results: [shared] },
        { variant: codeShape, results: [otherB] },
      ],
    });

    const mergeB = mergeVariantResults({
      topK: 3,
      resultsByVariant: [
        { variant: codeShape, results: [otherB] },
        { variant: filePath, results: [shared] },
        { variant: intent, results: [otherA, shared] },
      ],
    });

    expect(mergeA.map((result) => result.memoryId)).toEqual(mergeB.map((result) => result.memoryId));
    expect(mergeA.map((result) => result.memoryId)).toEqual([1, 3, 2]);
  });

  test("empty and single-variant successes return valid merged output", () => {
    const intent = buildRetrievalVariants(makeInput())[0]!;
    const only = makeResult(11, 0.6, "src/solo.ts");

    expect(mergeVariantResults({ resultsByVariant: [], topK: 5 })).toEqual([]);

    const merged = mergeVariantResults({
      topK: 5,
      resultsByVariant: [{ variant: intent, results: [only] }],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.memoryId).toBe(11);
  });

  test("variant failure is isolated and merge remains fail-open", () => {
    const variants = buildRetrievalVariants(makeInput());
    const intent = variants[0]!;
    const filePath = variants[1]!;
    const codeShape = variants[2]!;
    const good = makeResult(21, 0.42, "src/recovery.ts");

    const merged = mergeVariantResults({
      topK: 5,
      resultsByVariant: [
        { variant: intent, results: [good] },
        { variant: filePath, error: new Error("timeout") },
        { variant: codeShape, results: [] },
      ] as VariantRetrievalResult[],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.memoryId).toBe(21);
  });
});

describe("executeRetrievalVariants", () => {
  test("captures per-variant failures while preserving order", async () => {
    const variants = buildRetrievalVariants(makeInput());
    const seen: string[] = [];

    const results = await executeRetrievalVariants({
      variants,
      maxConcurrency: 3,
      execute: async (variant) => {
        seen.push(variant.type);
        if (variant.type === "file-path") {
          throw new Error("variant timeout");
        }
        return [makeResult(variant.priority + 1, 0.2 + variant.priority * 0.1, `${variant.type}.ts`)];
      },
    });

    expect(seen.sort()).toEqual(["code-shape", "file-path", "intent"]);
    expect(results).toHaveLength(3);
    expect(results[0]?.variant.type).toBe("intent");
    expect(results[0]?.results).toHaveLength(1);
    expect(results[1]?.variant.type).toBe("file-path");
    expect(results[1]?.error).toBeTruthy();
    expect(results[2]?.variant.type).toBe("code-shape");
  });
});
