import { describe, expect, test } from "bun:test";

import { DOCS_CONFIG_TRUTH_LANE_ID } from "./shadow-specialist.ts";
import {
  runShadowSpecialistSubflow,
  type ReadOnlyShadowSpecialistRunnerInput,
} from "./shadow-specialist-subflow.ts";

const operatorPath = "docs/operators/review-details.md";

function neverSettles(): Promise<never> {
  return new Promise(() => {});
}

describe("runShadowSpecialistSubflow", () => {
  test("skips source-only paths without calling the runner", async () => {
    let calls = 0;

    const result = await runShadowSpecialistSubflow({
      changedPaths: ["src/handlers/review.ts"],
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-1",
      correlationKey: "corr-1",
      runner: () => {
        calls++;
        return { status: "ok" };
      },
    });

    expect(calls).toBe(0);
    expect(result.triggerStatus).toBe("skipped");
    expect(result.laneId).toBeNull();
    expect(result.skipReason).toBe("no-operator-truth-paths");
    expect(result.timeoutReason).toBeNull();
    expect(result.errorReason).toBeNull();
    expect(result.output).toMatchObject({
      status: "skipped",
      skipReason: "not-applicable",
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-1",
      correlationKey: "corr-1",
      shadowOnly: true,
      publishesFindings: false,
    });
  });

  test("calls the read-only runner exactly once for operator-truth paths", async () => {
    const calls: ReadOnlyShadowSpecialistRunnerInput[] = [];

    const result = await runShadowSpecialistSubflow({
      changedPaths: [operatorPath, "src/index.ts", operatorPath],
      diffText: "diff --git a/docs/operators/review-details.md b/docs/operators/review-details.md",
      diffSnippet: "bounded snippet",
      workspaceDir: "/workspace/repo",
      deliveryId: "delivery-2",
      reviewOutputKey: "review-output-2",
      correlationKey: "corr-2",
      runner: (input) => {
        calls.push(input);
        return {
          status: "ok",
          candidates: [{ fingerprint: "candidate-a", decision: "candidate" }],
          metrics: { tokenCount: 12, costUsd: 0.01, latencyMs: 20 },
        };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      laneId: DOCS_CONFIG_TRUTH_LANE_ID,
      matchedPaths: [operatorPath],
      changedPaths: [operatorPath, "src/index.ts", operatorPath],
      diffText: "diff --git a/docs/operators/review-details.md b/docs/operators/review-details.md",
      diffSnippet: "bounded snippet",
      workspaceDir: "/workspace/repo",
      deliveryId: "delivery-2",
      reviewOutputKey: "review-output-2",
      correlationKey: "corr-2",
      readOnly: true,
    });
    expect(Object.keys(calls[0]!).sort()).toEqual([
      "changedPaths",
      "correlationKey",
      "deliveryId",
      "diffSnippet",
      "diffText",
      "laneId",
      "matchedPaths",
      "readOnly",
      "reviewOutputKey",
      "workspaceDir",
    ]);
    expect(result).toMatchObject({
      triggerStatus: "triggered",
      laneId: DOCS_CONFIG_TRUTH_LANE_ID,
      timeoutReason: null,
      errorReason: null,
      unclassifiableReason: null,
      deliveryId: "delivery-2",
      reviewOutputKey: "review-output-2",
      correlationKey: "corr-2",
      candidateCount: 1,
      decisionCount: 1,
      duplicateCount: 0,
      disagreementCount: 0,
      shadowOnly: true,
      publishesFindings: false,
    });
    expect(result.metricAvailability).toEqual({
      tokenCount: "available",
      costUsd: "available",
      latencyMs: "available",
    });
  });

  test("default runner is production-safe and publishes no visible findings", async () => {
    const result = await runShadowSpecialistSubflow({
      changedPaths: ["runbooks/live-review.md"],
      deliveryId: "delivery-default",
      reviewOutputKey: "review-output-default",
      correlationKey: "corr-default",
    });

    expect(result.triggerStatus).toBe("triggered");
    expect(result.output).toMatchObject({
      status: "skipped",
      skipReason: "no-candidates",
      candidateCount: 0,
      deliveryId: "delivery-default",
      reviewOutputKey: "review-output-default",
      correlationKey: "corr-default",
      shadowOnly: true,
      publishesFindings: false,
    });
    expect(result.redactionFlags).toEqual({
      unsafeFieldCount: 0,
      discardedRawPayload: false,
      discardedPublicationFields: false,
      discardedApprovalFields: false,
    });
  });

  test("runner errors become bounded fail-open private results", async () => {
    const result = await runShadowSpecialistSubflow({
      changedPaths: [operatorPath],
      deliveryId: "delivery-error",
      reviewOutputKey: "review-output-error",
      correlationKey: "corr-error",
      runner: () => {
        throw new Error("boom with sensitive details that must not escape");
      },
    });

    expect(result.errorReason).toBe("runner-error");
    expect(result.timeoutReason).toBeNull();
    expect(result.unclassifiableReason).toBeNull();
    expect(result.errorKind).toBe("runner-error");
    expect(result.output).toMatchObject({
      status: "error",
      skipReason: "missing-output",
      deliveryId: "delivery-error",
      reviewOutputKey: "review-output-error",
      correlationKey: "corr-error",
      shadowOnly: true,
      publishesFindings: false,
    });
    expect(JSON.stringify(result)).not.toContain("boom");
  });

  test("runner timeouts become bounded degraded results", async () => {
    const startedAt = Date.now();
    const result = await runShadowSpecialistSubflow({
      changedPaths: [operatorPath],
      timeoutMs: 5,
      deliveryId: "delivery-timeout",
      reviewOutputKey: "review-output-timeout",
      correlationKey: "corr-timeout",
      runner: () => neverSettles(),
    });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result.timeoutReason).toBe("runner-timeout");
    expect(result.errorReason).toBeNull();
    expect(result.degradedReason).toBe("runner-timeout");
    expect(result.output).toMatchObject({
      status: "degraded",
      skipReason: "missing-output",
      deliveryId: "delivery-timeout",
      reviewOutputKey: "review-output-timeout",
      correlationKey: "corr-timeout",
    });
    expect(result.metricAvailability.latencyMs).toBe("available");
  });

  test("malformed output normalizes to unclassifiable without throwing", async () => {
    const result = await runShadowSpecialistSubflow({
      changedPaths: [operatorPath],
      deliveryId: "delivery-malformed",
      reviewOutputKey: "review-output-malformed",
      correlationKey: "corr-malformed",
      runner: () => null,
    });

    expect(result.unclassifiableReason).toBe("malformed-output");
    expect(result.degradedReason).toBe("malformed-output");
    expect(result.errorReason).toBeNull();
    expect(result.output).toMatchObject({
      status: "unclassifiable",
      errorKind: null,
      candidateCount: 0,
      deliveryId: "delivery-malformed",
      reviewOutputKey: "review-output-malformed",
      correlationKey: "corr-malformed",
    });
    expect(result.output.degradedReasons).toContain("invalid-status");
  });

  test("unsafe raw/publication/approval-shaped fields are discarded from the public result", async () => {
    const result = await runShadowSpecialistSubflow({
      changedPaths: [operatorPath],
      deliveryId: "delivery-redact",
      reviewOutputKey: "review-output-redact",
      correlationKey: "corr-redact",
      runner: () => ({
        status: "ok",
        prompt: "secret prompt",
        modelOutput: "raw model output",
        body: "github visible body",
        inlineComments: [{ path: "docs/operators/review-details.md", line: 10, body: "publish me" }],
        approval: true,
        candidates: [{ fingerprint: "candidate-redacted", decision: "candidate", suggestion: "unsafe" }],
      }),
    });

    expect(result.output.status).toBe("degraded");
    expect(result.output.degradedReasons).toContain("unsafe-fields-discarded");
    expect(result.output.errorKind).toBe("unsafe-publication-field");
    expect(result.redactionFlags).toMatchObject({
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedApprovalFields: true,
    });
    expect(result.candidateCount).toBe(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret prompt");
    expect(serialized).not.toContain("github visible body");
    expect(serialized).not.toContain("publish me");
    expect(serialized).not.toContain("\"suggestion\"");
  });

  test("malformed changed paths produce bounded trigger diagnostics and do not block selected paths", async () => {
    let calls = 0;
    const result = await runShadowSpecialistSubflow({
      changedPaths: ["", "/etc/passwd", "../docs/runbook.md", operatorPath],
      runner: () => {
        calls++;
        return { status: "skipped", skipReason: "no-candidates" };
      },
    });

    expect(calls).toBe(1);
    expect(result.trigger).toMatchObject({
      status: "triggered",
      degradedReason: "invalid-paths-ignored",
      errorKind: "invalid-path-input",
      matchedPaths: [operatorPath],
      selectedLaneCount: 1,
    });
    expect(result.degradedReason).toBe("invalid-paths-ignored");
    expect(result.errorKind).toBe("invalid-path-input");
  });
});
