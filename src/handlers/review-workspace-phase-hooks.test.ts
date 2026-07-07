import { describe, expect, test } from "bun:test";
import { createReviewWorkspacePhaseHooks } from "./review-workspace-phase-hooks.ts";

describe("createReviewWorkspacePhaseHooks", () => {
  test("starts workspace phase timing and exposes load-config hook", () => {
    const phases: string[] = [];

    const hooks = createReviewWorkspacePhaseHooks({
      now: () => 12345,
      setReviewWorkPhase: (phase) => phases.push(phase),
    });

    expect(hooks.workspacePhaseStartedAt).toBe(12345);
    expect(phases).toEqual(["workspace-create"]);

    hooks.onBeforeFinalizeConfig();

    expect(phases).toEqual(["workspace-create", "load-config"]);
  });
});
