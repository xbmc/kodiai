import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { runShadowSpecialistSubflow, type ShadowSpecialistSubflowInput } from "../specialists/shadow-specialist-subflow.ts";
import { resolveReviewShadowSpecialistContext } from "./review-shadow-specialist.ts";

function makeLogger() {
  const entries: Array<{ level: string; data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      info(data: Record<string, unknown>, message: string) {
        entries.push({ level: "info", data, message });
      },
      warn(data: Record<string, unknown>, message: string) {
        entries.push({ level: "warn", data, message });
      },
    } as unknown as Pick<Logger, "info" | "warn">,
  };
}

describe("resolveReviewShadowSpecialistContext", () => {
  test("runs the subflow with review correlation context and returns bounded projections", async () => {
    const { logger, entries } = makeLogger();
    let capturedInput: ShadowSpecialistSubflowInput | undefined;

    const result = await resolveReviewShadowSpecialistContext({
      changedFiles: ["docs/runbook.md"],
      diffContentForValidation: "diff --git a/docs/runbook.md b/docs/runbook.md\n+updated runbook",
      workspaceDir: "/workspace",
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-1",
      prNumber: 42,
      baseLog: { prNumber: 42 },
      logger,
      shadowSpecialistSubflow: async (input) => {
        capturedInput = input;
        return runShadowSpecialistSubflow({
          ...input,
          now: () => 100,
          runner: (runnerInput) => ({
            laneId: runnerInput.laneId,
            status: "ok",
            candidates: [{ fingerprint: "candidate-1", decision: "candidate" }],
            metrics: { latencyMs: 25 },
            deliveryId: runnerInput.deliveryId,
            reviewOutputKey: runnerInput.reviewOutputKey,
            correlationKey: runnerInput.correlationKey,
          }),
        });
      },
    });

    expect(capturedInput).toMatchObject({
      changedPaths: ["docs/runbook.md"],
      diffText: "diff --git a/docs/runbook.md b/docs/runbook.md\n+updated runbook",
      workspaceDir: "/workspace",
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-1",
    });
    expect(capturedInput?.diffSnippet).toContain("updated runbook");
    expect(typeof capturedInput?.correlationKey).toBe("string");
    expect(capturedInput?.correlationKey).toHaveLength(16);
    expect(result.candidateVerificationContext).toMatchObject({
      docsConfigTruth: { status: "ok", candidateCount: 1 },
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-1",
      correlationKey: capturedInput?.correlationKey,
    });
    expect(result.shadowSpecialistResult?.output.status).toBe("ok");
    expect(result.shadowSpecialistReviewDetailsProjection).toMatchObject({
      status: "ok",
      candidateCount: 1,
      shadowOnly: true,
      visiblePublicationDenied: true,
    });
    expect(entries[0]).toMatchObject({
      level: "info",
      data: {
        prNumber: 42,
        gate: "shadow-specialist",
        outputStatus: "ok",
        privateOnly: true,
        shadowOnly: true,
        visiblePublicationDenied: true,
      },
      message: "Shadow specialist subflow completed",
    });
  });

  test("fails open with null specialist evidence when the injected subflow throws", async () => {
    const { logger, entries } = makeLogger();
    const err = new Error("subflow boom");

    const result = await resolveReviewShadowSpecialistContext({
      changedFiles: ["docs/runbook.md"],
      diffContentForValidation: "diff",
      workspaceDir: "/workspace",
      deliveryId: "delivery-2",
      reviewOutputKey: "review-output-2",
      prNumber: 42,
      baseLog: { prNumber: 42 },
      logger,
      shadowSpecialistSubflow: async () => {
        throw err;
      },
    });

    expect(result.shadowSpecialistResult).toBeUndefined();
    expect(result.shadowSpecialistReviewDetailsProjection).toBeNull();
    expect(result.candidateVerificationContext).toMatchObject({
      docsConfigTruth: null,
      deliveryId: "delivery-2",
      reviewOutputKey: "review-output-2",
    });
    expect(result.candidateVerificationContext.correlationKey).toHaveLength(16);
    expect(entries).toEqual([
      {
        level: "warn",
        data: {
          prNumber: 42,
          gate: "shadow-specialist",
          laneId: "docs-config-truth",
          status: "error",
          reason: "handler-subflow-error",
          deliveryId: "delivery-2",
          reviewOutputKey: "review-output-2",
          correlationKey: result.candidateVerificationContext.correlationKey,
          err,
        },
        message: "Shadow specialist subflow failed before normal review; continuing fail-open",
      },
    ]);
  });
});
