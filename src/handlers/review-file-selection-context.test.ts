import { describe, expect, test } from "bun:test";
import { resolveReviewFileSelectionContext } from "./review-file-selection-context.ts";

function baseParams(overrides: Partial<Parameters<typeof resolveReviewFileSelectionContext>[0]> = {}) {
  return {
    prNumber: 42,
    allChangedFiles: ["src/app.ts", "docs/readme.md"],
    skipPaths: ["docs/**"],
    diffContentForValidation: "diff --git a/src/app.ts b/src/app.ts",
    diffContext: {
      numstatLines: ["1\t0\tsrc/app.ts"],
      diffContent: "full diff",
    },
    workspaceDir: "/tmp/workspace",
    deliveryId: "delivery-1",
    reviewOutputKey: "review-key",
    incrementalResult: null,
    baseLog: { deliveryId: "delivery-1" },
    logger: { info: () => undefined, warn: () => undefined } as never,
    shadowSpecialistSubflow: async () => ({ output: null }) as never,
    ...overrides,
  };
}

describe("resolveReviewFileSelectionContext", () => {
  test("returns skip when all files match skip paths", async () => {
    let shadowCalls = 0;

    const context = await resolveReviewFileSelectionContext(baseParams({
      evaluateSkipPathsGate: () => ({ action: "skip" }),
      resolveShadowSpecialistContext: async () => {
        shadowCalls += 1;
        throw new Error("should not run shadow specialist after skip");
      },
    }));

    expect(context).toEqual({ action: "skip" });
    expect(shadowCalls).toBe(0);
  });

  test("returns selected files, shadow context, review files, and bounded diff content", async () => {
    const calls: unknown[] = [];
    const shadowContext = {
      shadowSpecialistResult: undefined,
      shadowSpecialistReviewDetailsProjection: null,
      candidateVerificationContext: {
        docsConfigTruth: null,
        deliveryId: "delivery-1",
        reviewOutputKey: "review-key",
        correlationKey: "correlation",
      },
    };

    const context = await resolveReviewFileSelectionContext(baseParams({
      evaluateSkipPathsGate: (params) => {
        calls.push({ skipFiles: params.allChangedFiles, skipPaths: params.skipPaths });
        return { action: "continue", changedFiles: ["src/app.ts"] };
      },
      resolveShadowSpecialistContext: async (params) => {
        calls.push({ shadowChangedFiles: params.changedFiles, workspaceDir: params.workspaceDir });
        return shadowContext;
      },
      resolveReviewFilesForIncrementalReview: (params) => {
        calls.push({ reviewChangedFiles: params.changedFiles, incrementalResult: params.incrementalResult });
        return ["src/app.ts"];
      },
    }));

    expect(context).toEqual({
      action: "continue",
      changedFiles: ["src/app.ts"],
      reviewFiles: ["src/app.ts"],
      numstatLines: ["1\t0\tsrc/app.ts"],
      diffContent: "full diff",
      ...shadowContext,
    });
    expect(calls).toEqual([
      { skipFiles: ["src/app.ts", "docs/readme.md"], skipPaths: ["docs/**"] },
      { shadowChangedFiles: ["src/app.ts"], workspaceDir: "/tmp/workspace" },
      { reviewChangedFiles: ["src/app.ts"], incrementalResult: null },
    ]);
  });

  test("omits full diff content for very large file sets", async () => {
    const manyFiles = Array.from({ length: 201 }, (_, index) => `src/file-${index}.ts`);

    const context = await resolveReviewFileSelectionContext(baseParams({
      allChangedFiles: manyFiles,
      evaluateSkipPathsGate: () => ({ action: "continue", changedFiles: manyFiles }),
      resolveShadowSpecialistContext: async () => ({
        shadowSpecialistResult: undefined,
        shadowSpecialistReviewDetailsProjection: null,
        candidateVerificationContext: {
          docsConfigTruth: null,
          deliveryId: "delivery-1",
          reviewOutputKey: "review-key",
          correlationKey: "correlation",
        },
      }),
      resolveReviewFilesForIncrementalReview: () => manyFiles,
    }));

    expect(context.action).toBe("continue");
    if (context.action === "continue") {
      expect(context.diffContent).toBeUndefined();
    }
  });
});
