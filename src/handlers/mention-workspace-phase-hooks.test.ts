import { describe, expect, test } from "bun:test";
import { createMentionWorkspacePhaseHooks } from "./mention-workspace-phase-hooks.ts";

describe("createMentionWorkspacePhaseHooks", () => {
  test("starts explicit review workspace tracking and exposes a load-config hook", () => {
    const phases: string[] = [];

    const hooks = createMentionWorkspacePhaseHooks({
      explicitReviewUsesCanonicalHandle: true,
      setReviewWorkPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["workspace-create"]);
    expect(hooks.beforeLoadConfig).toBeDefined();

    hooks.beforeLoadConfig?.();

    expect(phases).toEqual(["workspace-create", "load-config"]);
  });

  test("does not expose phase hooks for non-canonical mention work", () => {
    const phases: string[] = [];

    const hooks = createMentionWorkspacePhaseHooks({
      explicitReviewUsesCanonicalHandle: false,
      setReviewWorkPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual([]);
    expect(hooks.beforeLoadConfig).toBeUndefined();
  });
});
