import { describe, expect, test } from "bun:test";
import { buildReviewRuntimePlan } from "./review-runtime-plan.ts";
import type { TieredFiles } from "../lib/file-risk-scorer.ts";

function makeLogger() {
  const entries: Array<{ level: "info" | "warn"; obj: any; msg: string }> = [];
  return {
    entries,
    logger: {
      info: (obj: any, msg: string) => entries.push({ level: "info", obj, msg }),
      warn: (obj: any, msg: string) => entries.push({ level: "warn", obj, msg }),
    },
  };
}

function makeTieredFiles(paths: string[], isLargePR = false): TieredFiles {
  const scores = paths.map((filePath, index) => ({
    filePath,
    score: 100 - index,
    breakdown: {
      linesChanged: 0,
      pathRisk: 0,
      fileCategory: 0,
      languageRisk: 0,
      fileExtension: 0,
    },
  }));

  return {
    full: isLargePR ? scores.slice(0, 3) : scores,
    abbreviated: isLargePR ? scores.slice(3, 6) : [],
    mentionOnly: isLargePR ? scores.slice(6) : [],
    totalFiles: paths.length,
    threshold: 3,
    isLargePR,
  };
}

describe("buildReviewRuntimePlan", () => {
  test("keyword profile override applies the selected preset exactly", () => {
    const { logger, entries } = makeLogger();

    const plan = buildReviewRuntimePlan({
      parsedIntent: {
        profileOverride: "minimal",
      },
      reviewConfig: {
        profile: null,
        severityMinLevel: "minor",
        maxComments: 7,
        focusAreas: [],
        ignoredAreas: [],
      },
      timeoutConfig: {
        timeoutSeconds: 600,
        dynamicScaling: true,
        autoReduceScope: true,
      },
      baseMaxTurns: 25,
      prLinesChanged: 40,
      changedFiles: ["src/app.ts"],
      diffMetrics: {
        totalLinesAdded: 20,
        totalLinesRemoved: 20,
        filesByLanguage: { TypeScript: ["src/app.ts"] },
        isLargePR: false,
      },
      tieredFiles: makeTieredFiles(["src/app.ts"]),
      promptFiles: ["src/app.ts"],
      logger: logger as any,
      baseLog: { deliveryId: "delivery-1" },
    });

    expect(plan.profileSelection.selectedProfile).toBe("minimal");
    expect(plan.resolvedSeverityMinLevel).toBe("major");
    expect(plan.resolvedMaxComments).toBe(3);
    expect(plan.resolvedFocusAreas).toEqual(["security", "correctness"]);
    expect(plan.resolvedIgnoredAreas).toEqual(["style", "documentation"]);
    expect(plan.reviewRouting.routingReason).toBe("standard");
    expect(entries.some((entry) => entry.msg === "Keyword profile override applied")).toBe(true);
    expect(entries.some((entry) => entry.msg === "Review profile resolved")).toBe(true);
  });

  test("high timeout risk auto-reduces to minimal profile and caps prompt files", () => {
    const { logger, entries } = makeLogger();
    const paths = Array.from({ length: 80 }, (_, index) => `src/file-${index}.cpp`);

    const plan = buildReviewRuntimePlan({
      parsedIntent: {
        profileOverride: null,
      },
      reviewConfig: {
        profile: "strict",
        severityMinLevel: "minor",
        maxComments: 15,
        focusAreas: [],
        ignoredAreas: [],
      },
      timeoutConfig: {
        timeoutSeconds: 600,
        dynamicScaling: true,
        autoReduceScope: true,
      },
      baseMaxTurns: 25,
      prLinesChanged: 6000,
      changedFiles: paths,
      diffMetrics: {
        totalLinesAdded: 4000,
        totalLinesRemoved: 2000,
        filesByLanguage: { "C++": paths },
        isLargePR: true,
      },
      tieredFiles: makeTieredFiles(paths, true),
      promptFiles: paths.slice(0, 6),
      logger: logger as any,
      baseLog: { deliveryId: "delivery-2" },
    });

    expect(plan.requestedProfileSelection.selectedProfile).toBe("strict");
    expect(plan.profileSelection.selectedProfile).toBe("minimal");
    expect(plan.timeoutReductionApplied).toBe(true);
    expect(plan.timeoutReductionSkippedReason).toBeNull();
    expect(plan.promptFiles.length).toBeLessThanOrEqual(25);
    expect(plan.resolvedSeverityMinLevel).toBe("major");
    expect(plan.resolvedMaxComments).toBe(3);
    expect(plan.reviewBoundedness?.reasonCodes).toContain("timeout-auto-reduced");
    expect(plan.checkpointEnabled).toBe(true);
    expect(plan.reviewMaxTurnsOverride).toBeGreaterThan(25);
    expect(entries.some((entry) => entry.msg === "Auto-reduced review scope for high budget risk")).toBe(true);
  });
});
