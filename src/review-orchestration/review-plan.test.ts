import { describe, expect, test } from "bun:test";
import {
  buildReviewPlan,
  createDegradedReviewPlan,
  resolveGraphValidationPlanStatus,
  toReviewPlanDetailsSummary,
  type CandidateFindingMode,
  type GraphValidationPlanStatus,
  type ReviewPlanInput,
} from "./review-plan.ts";

const baseInput = (): ReviewPlanInput => ({
  task: {
    taskType: "review-full",
    routingReason: "standard",
  },
  change: {
    changedFileCount: 3,
    linesChanged: 42,
    linesChangedSource: "diff-numstat",
  },
  budget: {
    timeoutSeconds: 900,
    maxTurns: 50,
    maxTurnsSource: "timeout-risk",
  },
  context: {
    sources: ["pr-metadata", "diff-summary"],
    summary: "PR metadata and bounded diff summary",
  },
  gates: {
    enabled: ["quality", "security"],
    current: ["quality"],
  },
  policy: {
    publish: "draft-review",
    tools: "inline-comments-enabled",
    retry: "retry-on-transient-failure",
  },
  graphValidation: {
    status: "enabled",
    reason: "graph-blast-radius-available",
  },
  candidateFinding: {
    mode: "unavailable",
    reason: "candidate-finding-not-wired",
  },
});

describe("resolveGraphValidationPlanStatus", () => {
  test("projects config-disabled graph validation as skipped", () => {
    expect(resolveGraphValidationPlanStatus({ configEnabled: false })).toEqual({
      status: "skipped",
      reason: "config-disabled",
    });
  });

  test("projects missing graph query capability as unavailable", () => {
    expect(resolveGraphValidationPlanStatus({
      configEnabled: true,
      graphQueryAvailable: false,
      graphBlastRadiusAvailable: true,
    })).toEqual({
      status: "unavailable",
      reason: "review-graph-query-not-configured",
    });
  });

  test("projects trivial bypass and missing blast radius as skipped states", () => {
    expect(resolveGraphValidationPlanStatus({
      configEnabled: true,
      graphQueryAvailable: true,
      graphBlastRadiusAvailable: true,
      trivialChangeBypass: true,
    })).toEqual({
      status: "skipped",
      reason: "trivial-change-bypass",
    });

    expect(resolveGraphValidationPlanStatus({
      configEnabled: true,
      graphQueryAvailable: true,
      graphBlastRadiusAvailable: false,
    })).toEqual({
      status: "skipped",
      reason: "no-graph-blast-radius",
    });
  });

  test("projects available prerequisites as enabled before validation and applied after successful validation", () => {
    expect(resolveGraphValidationPlanStatus({
      configEnabled: true,
      graphQueryAvailable: true,
      graphBlastRadiusAvailable: true,
    })).toEqual({
      status: "enabled",
      reason: "graph-blast-radius-available",
    });

    expect(resolveGraphValidationPlanStatus({
      configEnabled: true,
      graphQueryAvailable: true,
      graphBlastRadiusAvailable: true,
      finalValidationApplied: true,
    })).toEqual({
      status: "applied",
      reason: "validated-findings",
    });
  });

  test("does not leak malformed raw reason text into Review Details", () => {
    const projected = resolveGraphValidationPlanStatus({
      configEnabled: true,
      graphQueryAvailable: true,
      graphBlastRadiusAvailable: true,
      finalValidationApplied: true,
    });
    const plan = buildReviewPlan({
      ...baseInput(),
      graphValidation: {
        status: projected.status,
        reason: JSON.stringify({ raw: "diff --git PROMPT_SECRET TOKEN=abc123" }),
      },
    }).plan;

    const summary = toReviewPlanDetailsSummary(plan);

    expect(projected).toEqual({ status: "applied", reason: "validated-findings" });
    expect(plan.graphValidation.reason).toBe("-raw-:-diff---git-PROMPT_SECRET-TOKEN-abc123-");
    expect(summary.text).toContain("graph=applied");
    expect(summary.text).not.toContain("diff --git");
    expect(summary.text).not.toContain("PROMPT_SECRET");
    expect(summary.text).not.toContain("TOKEN");
    expect(summary.text).not.toContain("{\"");
  });
});


describe("buildReviewPlan", () => {
  test("builds a ready typed plan with required routing, budget, context, policy, and placeholder fields", () => {
    const result = buildReviewPlan(baseInput());

    expect(result.status).toBe("ready");
    expect(result.plan.status).toBe("ready");
    expect(result.plan.task.taskType).toBe("review-full");
    expect(result.plan.task.routingReason).toBe("standard");
    expect(result.plan.change).toEqual({
      changedFileCount: 3,
      linesChanged: 42,
      linesChangedSource: "diff-numstat",
    });
    expect(result.plan.budget).toEqual({
      timeoutSeconds: 900,
      maxTurns: 50,
      maxTurnsSource: "timeout-risk",
    });
    expect(result.plan.context.sources).toEqual(["pr-metadata", "diff-summary"]);
    expect(result.plan.gates.enabled).toEqual(["quality", "security"]);
    expect(result.plan.gates.current).toEqual(["quality"]);
    expect(result.plan.policy).toEqual({
      publish: "draft-review",
      tools: "inline-comments-enabled",
      retry: "retry-on-transient-failure",
    });
    expect(result.plan.graphValidation.status).toBe("enabled");
    expect(result.plan.candidateFinding.mode).toBe("unavailable");
    expect(result.plan.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("uses canonical JSON hashing independent of object key insertion order", () => {
    const ordered = buildReviewPlan(baseInput()).plan;
    const reorderedInput: ReviewPlanInput = {
      policy: {
        retry: "retry-on-transient-failure",
        tools: "inline-comments-enabled",
        publish: "draft-review",
      },
      gates: {
        current: ["quality"],
        enabled: ["quality", "security"],
      },
      context: {
        summary: "PR metadata and bounded diff summary",
        sources: ["pr-metadata", "diff-summary"],
      },
      budget: {
        maxTurnsSource: "timeout-risk",
        maxTurns: 50,
        timeoutSeconds: 900,
      },
      change: {
        linesChangedSource: "diff-numstat",
        linesChanged: 42,
        changedFileCount: 3,
      },
      task: {
        routingReason: "standard",
        taskType: "review-full",
      },
      candidateFinding: {
        reason: "candidate-finding-not-wired",
        mode: "unavailable",
      },
      graphValidation: {
        reason: "graph-blast-radius-available",
        status: "enabled",
      },
    };

    expect(buildReviewPlan(reorderedInput).plan.hash).toBe(ordered.hash);
  });

  test("changes the stable hash when meaningful routing or policy inputs change", () => {
    const standard = buildReviewPlan(baseInput()).plan.hash;
    const tinyDiff = buildReviewPlan({
      ...baseInput(),
      task: {
        taskType: "review-small-diff",
        routingReason: "tiny-diff",
      },
    }).plan.hash;
    const publishPolicyChanged = buildReviewPlan({
      ...baseInput(),
      policy: {
        publish: "comment-only",
        tools: "inline-comments-enabled",
        retry: "retry-on-transient-failure",
      },
    }).plan.hash;

    expect(tinyDiff).not.toBe(standard);
    expect(publishPolicyChanged).not.toBe(standard);
  });

  test("supports the graph-validation and candidate-finding R094 vocabularies", () => {
    const graphStatuses: GraphValidationPlanStatus[] = ["enabled", "unavailable", "skipped", "applied"];
    const candidateModes: CandidateFindingMode[] = ["unavailable", "shadow", "preferred"];

    for (const graphStatus of graphStatuses) {
      for (const candidateMode of candidateModes) {
        const result = buildReviewPlan({
          ...baseInput(),
          graphValidation: { status: graphStatus, reason: `${graphStatus}-reason` },
          candidateFinding: { mode: candidateMode, reason: `${candidateMode}-reason` },
        });

        expect(result.plan.graphValidation.status).toBe(graphStatus);
        expect(result.plan.candidateFinding.mode).toBe(candidateMode);
      }
    }
  });

  test("normalizes unknown or null candidate-finding mode to unavailable", () => {
    const unknown = buildReviewPlan({
      ...baseInput(),
      candidateFinding: { mode: "surprise-mode", reason: "bad mode" },
    } as unknown as ReviewPlanInput & Record<string, unknown>).plan;
    const nullMode = buildReviewPlan({
      ...baseInput(),
      candidateFinding: { mode: null, reason: "null mode" },
    } as unknown as ReviewPlanInput & Record<string, unknown>).plan;

    expect(unknown.candidateFinding).toEqual({ mode: "unavailable", reason: "bad mode" });
    expect(nullMode.candidateFinding).toEqual({ mode: "unavailable", reason: "null mode" });
  });

  test("defaults missing graph-validation input to a safe skipped config-disabled projection", () => {
    const result = buildReviewPlan({
      ...baseInput(),
      graphValidation: undefined,
    });

    expect(result.plan.graphValidation).toEqual({
      status: "skipped",
      reason: "config-disabled",
    });
  });

  test("handles missing optional budget/context fields, empty context sources, and count boundaries", () => {
    const zero = buildReviewPlan({
      ...baseInput(),
      change: {
        changedFileCount: 0,
        linesChanged: 0,
        linesChangedSource: "diff-numstat",
      },
      budget: {},
      context: {
        sources: [],
      },
    }).plan;
    const large = buildReviewPlan({
      ...baseInput(),
      change: {
        changedFileCount: 10_000,
        linesChanged: 1_000_000,
        linesChangedSource: "github-api",
      },
    }).plan;

    expect(zero.change.changedFileCount).toBe(0);
    expect(zero.change.linesChanged).toBe(0);
    expect(zero.budget).toEqual({});
    expect(zero.context.sources).toEqual([]);
    expect(large.change.changedFileCount).toBe(10_000);
    expect(large.change.linesChanged).toBe(1_000_000);
    expect(large.hash).not.toBe(zero.hash);
  });

  test("rejects unsupported canonicalization values in direct builder tests", () => {
    expect(() => buildReviewPlan({
      ...baseInput(),
      context: {
        sources: ["pr-metadata"],
        summary: undefined,
      },
    })).toThrow("Unsupported undefined value at context.summary");
  });
});

describe("createDegradedReviewPlan", () => {
  test("creates stable degraded metadata that can be projected without throwing", () => {
    const first = createDegradedReviewPlan({
      reason: "canonicalization-error",
      message: "Unsupported undefined value at context.summary",
      taskType: "review-full",
      routingReason: "standard",
    });
    const second = createDegradedReviewPlan({
      routingReason: "standard",
      taskType: "review-full",
      message: "Unsupported undefined value at context.summary",
      reason: "canonicalization-error",
    });

    expect(first.status).toBe("degraded");
    expect(first.degraded.reason).toBe("canonicalization-error");
    expect(first.hash).toMatch(/^degraded-[a-f0-9]{16}$/);
    expect(second.hash).toBe(first.hash);
    expect(() => toReviewPlanDetailsSummary(first)).not.toThrow();
  });
});

describe("toReviewPlanDetailsSummary", () => {
  test("projects a compact Review Details line without raw prompts, diffs, files, or secrets", () => {
    const plan = buildReviewPlan({
      ...baseInput(),
      rawPrompt: "PROMPT_SECRET should not be serialized",
      rawDiff: "diff --git a/secret b/secret\n+TOKEN=abc123",
      files: [{ path: "src/secret.ts", content: "export const token = 'abc123';" }],
      secretToken: "abc123",
    } as ReviewPlanInput & Record<string, unknown>).plan;

    const summary = toReviewPlanDetailsSummary(plan);

    expect(summary.label).toBe("Review plan");
    expect(summary.text).toStartWith("Review plan: ready hash=");
    expect(summary.text.length).toBeLessThanOrEqual(240);
    expect(summary.text).toContain("route=standard");
    expect(summary.text).toContain("files=3");
    expect(summary.text).toContain("lines=42(diff-numstat)");
    expect(summary.text).toContain("graph=enabled");
    expect(summary.text).toContain("candidates=unavailable");
    expect(summary.text).not.toContain("PROMPT_SECRET");
    expect(summary.text).not.toContain("diff --git");
    expect(summary.text).not.toContain("TOKEN");
    expect(summary.text).not.toContain("src/secret.ts");
    expect(summary.text).not.toContain("abc123");
  });
});
