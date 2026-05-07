import { describe, expect, test } from "bun:test";
import { TASK_TYPES } from "../llm/task-types.ts";
import {
  countChangedLinesFromNumstat,
  isSmallDiffReviewEligible,
  resolveReviewRoutingLineCount,
  resolveReviewTaskRouting,
  resolveReviewMaxTurnsOverride,
  SEMANTIC_FANOUT_REVIEW_MAX_TURNS,
  HIGH_RISK_REVIEW_MAX_TURNS,
  MEDIUM_RISK_REVIEW_MAX_TURNS,
} from "./review-routing.ts";

describe("review-routing", () => {
  test("counts changed lines from numstat rows and ignores binary markers", () => {
    expect(countChangedLinesFromNumstat([
      "1\t1\tsrc/a.ts",
      "-\t-\tassets/logo.png",
      "3\t0\tsrc/b.ts",
    ])).toBe(5);
  });

  test("falls back to PR API line totals when local diff analysis has no line count", () => {
    expect(resolveReviewRoutingLineCount({ diffLinesChanged: 0, prApiLinesChanged: 42 })).toBe(42);
    expect(resolveReviewRoutingLineCount({ diffLinesChanged: 2, prApiLinesChanged: 42 })).toBe(2);
  });

  test("treats missing local and PR API line counts as zero", () => {
    expect(resolveReviewRoutingLineCount({ diffLinesChanged: 0 })).toBe(0);
  });

  test("treats a one-file two-line PR as small-diff eligible", () => {
    expect(isSmallDiffReviewEligible({ changedFileCount: 1, linesChanged: 2 })).toBe(true);
  });

  test("requires both file count and line count thresholds", () => {
    expect(isSmallDiffReviewEligible({ changedFileCount: 3, linesChanged: 2 })).toBe(false);
    expect(isSmallDiffReviewEligible({ changedFileCount: 1, linesChanged: 21 })).toBe(false);
  });

  test("does not use small-diff routing when boundedness already escalated", () => {
    expect(isSmallDiffReviewEligible({
      changedFileCount: 1,
      linesChanged: 2,
      hasBoundednessEscalation: true,
    })).toBe(false);
  });

  test("resolves tiny diffs to review.small-diff without lowering the repo turn budget", () => {
    expect(resolveReviewTaskRouting({ changedFileCount: 1, linesChanged: 2 })).toEqual({
      taskType: TASK_TYPES.REVIEW_SMALL_DIFF,
      routingReason: "tiny-diff",
    });
  });

  test("resolves non-tiny diffs to review.full without a turn override", () => {
    expect(resolveReviewTaskRouting({ changedFileCount: 4, linesChanged: 2 })).toEqual({
      taskType: TASK_TYPES.REVIEW_FULL,
      routingReason: "standard",
    });
  });

  test("does not apply risk scaling to small-diff reviews without an explicit routing override", () => {
    expect(resolveReviewMaxTurnsOverride({
      taskType: TASK_TYPES.REVIEW_SMALL_DIFF,
      timeoutRiskLevel: "high",
      baseMaxTurns: 25,
    })).toBeUndefined();
  });

  test("raises standard full-review turn budget for medium and high timeout risk", () => {
    expect(resolveReviewMaxTurnsOverride({
      taskType: TASK_TYPES.REVIEW_FULL,
      timeoutRiskLevel: "medium",
      baseMaxTurns: 25,
    })).toBe(MEDIUM_RISK_REVIEW_MAX_TURNS);

    expect(resolveReviewMaxTurnsOverride({
      taskType: TASK_TYPES.REVIEW_FULL,
      timeoutRiskLevel: "high",
      baseMaxTurns: 25,
    })).toBe(HIGH_RISK_REVIEW_MAX_TURNS);
  });

  test("raises low-risk full-review turn budget for GUI control-flow semantic fan-out", () => {
    expect(resolveReviewMaxTurnsOverride({
      taskType: TASK_TYPES.REVIEW_FULL,
      timeoutRiskLevel: "low",
      baseMaxTurns: 25,
      changedFiles: [
        "xbmc/guilib/GUIWindowManager.cpp",
        "xbmc/guilib/GUIButtonControl.cpp",
        "xbmc/guilib/GUIControl.cpp",
        "xbmc/guilib/GUIControl.h",
      ],
    })).toBe(SEMANTIC_FANOUT_REVIEW_MAX_TURNS);
  });

  test("does not raise turn budget for unrelated event or message paths", () => {
    expect(resolveReviewMaxTurnsOverride({
      taskType: TASK_TYPES.REVIEW_FULL,
      timeoutRiskLevel: "low",
      baseMaxTurns: 25,
      changedFiles: [
        "src/handlers/message-handler.ts",
        "src/lib/event-emitter.ts",
        "src/execution/dispatcher.ts",
      ],
    })).toBeUndefined();
  });

  test("does not lower an explicitly higher repo maxTurns setting", () => {
    expect(resolveReviewMaxTurnsOverride({
      taskType: TASK_TYPES.REVIEW_FULL,
      timeoutRiskLevel: "high",
      baseMaxTurns: 100,
    })).toBeUndefined();
  });
});
