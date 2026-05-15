import { describe, expect, test } from "bun:test";
import {
  buildReviewPlan,
  summarizeReviewPlanForDiagnostics,
  summarizeReviewPlanForReviewDetails,
  type ReviewPlanInput,
} from "./review-plan.ts";

function minimalInput(overrides: Partial<ReviewPlanInput> = {}): ReviewPlanInput {
  return {
    route: {
      kind: "pull_request",
      owner: "xbmc",
      repo: "xbmc",
      pullNumber: 28172,
      eventName: "pull_request.opened",
      taskType: "review.full",
      routingReason: "standard",
    },
    scope: {
      changedFileCount: 2,
      reviewedFileCount: 2,
      totalLinesChanged: 44,
      paths: ["src/handlers/review.ts", "src/execution/config.ts"],
    },
    contextSources: [
      { name: "retrieval", status: "applied", itemCount: 3, representativePaths: ["src/lib/review-utils.ts"] },
      { name: "graph", status: "enabled", itemCount: 0 },
    ],
    gates: [
      { name: "boundedness", status: "applied", reason: "standard-scope" },
      { name: "candidate-publication", status: "skipped", reason: "not-candidate-route" },
    ],
    budgets: {
      maxComments: 7,
      maxTurns: 25,
      timeoutSeconds: 900,
      tokenBudget: 120000,
    },
    publishPolicy: {
      autoApprove: false,
      publishReviewDetails: true,
      inlineComments: true,
      candidateVerificationRequired: false,
      mode: "review-comment",
    },
    ...overrides,
  };
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [key, ...allKeys(child)]);
  }
  return [];
}

describe("ReviewPlan", () => {
  test("builds a complete minimal typed plan with route, scope, context, gates, budgets, publish policy, and hash", () => {
    const plan = buildReviewPlan(minimalInput());

    expect(plan.version).toBe(1);
    expect(plan.route.kind).toBe("pull_request");
    expect(plan.route.pullNumber).toBe(28172);
    expect(plan.scope.changedFileCount).toBe(2);
    expect(plan.scope.representativePaths).toEqual(["src/handlers/review.ts", "src/execution/config.ts"]);
    expect(plan.contextSources.map((source) => source.status)).toEqual(["enabled", "applied"]);
    expect(plan.gates.map((gate) => gate.status)).toEqual(["applied", "skipped"]);
    expect(plan.budgets.maxComments).toBe(7);
    expect(plan.publishPolicy.mode).toBe("review-comment");
    expect(plan.stableHash).toMatch(/^review-plan:v1:[a-f0-9]{64}$/);
  });

  test("stable hash is deterministic and independent of object-key insertion order and timestamps", () => {
    const first = buildReviewPlan({
      ...minimalInput(),
      createdAt: "2026-05-10T00:00:00.000Z",
      route: {
        owner: "xbmc",
        repo: "xbmc",
        kind: "pull_request",
        pullNumber: 28172,
        eventName: "pull_request.opened",
        taskType: "review.full",
        routingReason: "standard",
      },
    });
    const second = buildReviewPlan({
      createdAt: "2026-05-11T00:00:00.000Z",
      route: {
        routingReason: "standard",
        taskType: "review.full",
        eventName: "pull_request.opened",
        pullNumber: 28172,
        kind: "pull_request",
        repo: "xbmc",
        owner: "xbmc",
      },
      publishPolicy: minimalInput().publishPolicy,
      budgets: minimalInput().budgets,
      gates: minimalInput().gates,
      contextSources: minimalInput().contextSources,
      scope: minimalInput().scope,
    });

    expect(second.stableHash).toBe(first.stableHash);
  });

  test("stable hash changes when meaningful fields change", () => {
    const base = buildReviewPlan(minimalInput());
    const changedScope = buildReviewPlan(minimalInput({
      scope: { ...minimalInput().scope, reviewedFileCount: 1 },
    }));
    const changedPolicy = buildReviewPlan(minimalInput({
      publishPolicy: { ...minimalInput().publishPolicy, autoApprove: true },
    }));

    expect(changedScope.stableHash).not.toBe(base.stableHash);
    expect(changedPolicy.stableHash).not.toBe(base.stableHash);
  });

  test("diagnostic projection is bounded and safe for structured logs/verifiers", () => {
    const plan = buildReviewPlan(minimalInput({
      scope: {
        changedFileCount: 20,
        reviewedFileCount: 12,
        totalLinesChanged: 500,
        paths: Array.from({ length: 20 }, (_, index) => `src/file-${index}.ts`),
      },
      contextSources: [
        {
          name: "retrieval",
          status: "applied",
          itemCount: 100,
          representativePaths: Array.from({ length: 20 }, (_, index) => `docs/context-${index}.md`),
        },
      ],
    }));

    const summary = summarizeReviewPlanForDiagnostics(plan);

    expect(summary.gate).toBe("review-plan");
    expect(summary.planHash).toBe(plan.stableHash);
    expect(summary.route).toEqual({ kind: "pull_request", taskType: "review.full", routingReason: "standard" });
    expect(summary.scope.representativePaths.length).toBeLessThanOrEqual(10);
    expect(summary.scope.omittedPathCount).toBe(10);
    expect(summary.contextSources[0]).toEqual({ name: "retrieval", status: "applied", itemCount: 100, representativePaths: ["docs/context-0.md", "docs/context-1.md", "docs/context-2.md", "docs/context-3.md", "docs/context-4.md"], omittedPathCount: 15 });
    expect(allKeys(summary)).not.toContain("prompt");
    expect(allKeys(summary)).not.toContain("rawDiff");
    expect(allKeys(summary)).not.toContain("commentBody");
    expect(JSON.stringify(summary)).not.toContain("SECRET");
  });


  test("public Review Details projection is deterministic and more compact than diagnostics", () => {
    const plan = buildReviewPlan(minimalInput({
      scope: {
        changedFileCount: 12,
        reviewedFileCount: 9,
        totalLinesChanged: 321,
        paths: Array.from({ length: 12 }, (_, index) => `src/public-path-${index}.ts`),
      },
      contextSources: Array.from({ length: 6 }, (_, index) => ({
        name: `source-${index}`,
        status: index % 2 === 0 ? "applied" : "skipped",
        itemCount: index + 1,
        representativePaths: Array.from({ length: 3 }, (_, pathIndex) => `docs/source-${index}-${pathIndex}.md`),
      })),
      gates: Array.from({ length: 8 }, (_, index) => ({
        name: `gate-${index}`,
        status: index % 3 === 0 ? "unavailable" : "enabled",
        findingCount: index,
      })),
    }));

    const first = summarizeReviewPlanForReviewDetails(plan);
    const second = summarizeReviewPlanForReviewDetails(plan);

    expect(second).toEqual(first);
    expect(first.gate).toBe("review-plan-review-details");
    expect(first.planHash).toBe(plan.stableHash);
    expect(first.route).toEqual({ kind: "pull_request", taskType: "review.full", routingReason: "standard" });
    expect(first.scope.representativePaths).toEqual(["src/public-path-0.ts", "src/public-path-1.ts", "src/public-path-2.ts"]);
    expect(first.scope.omittedPathCount).toBe(9);
    expect(first.contextSources.representatives).toHaveLength(4);
    expect(first.contextSources.omittedSourceCount).toBe(2);
    expect(first.contextSources.representatives[0]).toEqual({ name: "source-0", status: "applied", itemCount: 1, omittedPathCount: 3 });
    expect(first.gates.representatives).toHaveLength(6);
    expect(first.gates.omittedGateCount).toBe(2);
  });

  test("public Review Details projection aggregates meaningful context and gate statuses/counts", () => {
    const plan = buildReviewPlan(minimalInput({
      contextSources: [
        { name: "alpha", status: "applied", itemCount: 2 },
        { name: "beta", status: "enabled", itemCount: 3 },
        { name: "gamma", status: "skipped", itemCount: 5 },
        { name: "delta", status: "unavailable", itemCount: 7 },
      ],
      gates: [
        { name: "bounds", status: "applied", findingCount: 4 },
        { name: "graph", status: "unavailable", findingCount: 6 },
        { name: "publish", status: "skipped" },
      ],
    }));

    const summary = summarizeReviewPlanForReviewDetails(plan);

    expect(summary.contextSources.totalCount).toBe(4);
    expect(summary.contextSources.totalItemCount).toBe(17);
    expect(summary.contextSources.statusCounts).toEqual({ enabled: 1, applied: 1, skipped: 1, unavailable: 1 });
    expect(summary.gates.totalCount).toBe(3);
    expect(summary.gates.totalFindingCount).toBe(10);
    expect(summary.gates.statusCounts).toEqual({ enabled: 0, applied: 1, skipped: 1, unavailable: 1 });
    expect(summary.budgets).toEqual(plan.budgets);
    expect(summary.publishPolicy).toEqual(plan.publishPolicy);
  });

  test("public Review Details projection strips unsafe formatting and omits forbidden raw canary values", () => {
    const plan = buildReviewPlan(minimalInput({
      route: {
        ...minimalInput().route,
        taskType: "review.full|with pipe",
        routingReason: "standard\nwith newline",
      },
      scope: {
        changedFileCount: 4,
        reviewedFileCount: 4,
        totalLinesChanged: 99,
        paths: [
          "src/safe.ts",
          "SECRET raw prompt payload",
          "src/with|pipe.ts",
          "src/with\nnewline.ts",
        ],
      },
      contextSources: [
        { name: "retrieval|source", status: "applied", itemCount: 1 },
        { name: "model output source", status: "enabled", itemCount: 2 },
      ],
      gates: [
        { name: "boundedness\ncheck", status: "applied" },
        { name: "candidate comment diff", status: "skipped" },
      ],
    }));

    const summary = summarizeReviewPlanForReviewDetails(plan);
    const json = JSON.stringify(summary);

    expect(summary.route.taskType).toBe("review.full with pipe");
    expect(summary.route.routingReason).toBe("standard with newline");
    expect(summary.scope.representativePaths).toEqual(["src/safe.ts", "[redacted]", "src/with pipe.ts"]);
    expect(summary.contextSources.representatives.map((source) => source.name)).toEqual(["[redacted]", "retrieval source"]);
    expect(summary.gates.representatives.map((gate) => gate.name)).toEqual(["boundedness check", "[redacted]"]);
    expect(json).not.toContain("SECRET raw prompt payload");
    expect(json).not.toContain("model output source");
    expect(json).not.toContain("candidate comment diff");
    expect(json).not.toContain("|");
    expect(json).not.toContain("\n");
    expect(allKeys(summary)).not.toContain("prompt");
    expect(allKeys(summary)).not.toContain("rawDiff");
    expect(allKeys(summary)).not.toContain("commentBody");
    expect(allKeys(summary)).not.toContain("candidatePayload");
  });

  test("normalizes empty path lists, disabled/unavailable context sources, and skipped gates", () => {
    const plan = buildReviewPlan(minimalInput({
      scope: {
        changedFileCount: 0,
        reviewedFileCount: 0,
        totalLinesChanged: 0,
        paths: [],
      },
      contextSources: [
        { name: "retrieval", enabled: false, itemCount: 0 },
        { name: "graph", status: "unexpected-status" as never, reason: "backend missing", itemCount: -10 },
      ],
      gates: [
        { name: "graph-validation", enabled: false },
        { name: "publication", status: "unexpected-status" as never, reason: "not configured" },
      ],
    }));

    expect(plan.scope).toMatchObject({ changedFileCount: 0, reviewedFileCount: 0, totalLinesChanged: 0, representativePaths: [], omittedPathCount: 0 });
    expect(plan.contextSources).toEqual([
      { name: "graph", status: "unavailable", itemCount: 0, reason: "backend missing", representativePaths: [], omittedPathCount: 0 },
      { name: "retrieval", status: "skipped", itemCount: 0, representativePaths: [], omittedPathCount: 0 },
    ]);
    expect(plan.gates).toEqual([
      { name: "graph-validation", status: "skipped" },
      { name: "publication", status: "unavailable", reason: "not configured" },
    ]);
  });

  test("rejects forbidden raw-field keys before hashing or diagnostic projection", () => {
    expect(() => buildReviewPlan({
      ...minimalInput(),
      rawDiff: "SECRET raw diff payload",
    } as unknown as ReviewPlanInput)).toThrow(/Forbidden raw review-plan field: rawDiff/);

    expect(() => buildReviewPlan({
      ...minimalInput(),
      contextSources: [{ name: "retrieval", status: "applied", itemCount: 1, commentBody: "SECRET comment" } as never],
    })).toThrow(/Forbidden raw review-plan field: contextSources\.0\.commentBody/);
  });
});
