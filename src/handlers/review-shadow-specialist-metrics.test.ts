import { describe, expect, test } from "bun:test";

import { runReviewWithShadowMetrics, specialistCanary, specialistInlineCanary } from "./review-m070-integration-harness.ts";

describe("review handler shadow specialist reducer metrics", () => {
  test("logs reducer-backed private aggregate fields without exposing candidate content", async () => {
    const result = await runReviewWithShadowMetrics({ autoApprove: false });

    const log = result.entries.find((entry) => entry.data?.gate === "shadow-specialist");
    expect(log?.data).toMatchObject({
      laneId: "docs-config-truth",
      status: "triggered",
      outputStatus: "degraded",
      reason: "unsafe-publication-field",
      candidateCount: 4,
      decisionCount: 4,
      duplicateCount: 1,
      disagreementCount: 1,
      dismissedCount: 1,
      unclassifiableCount: 0,
      truncatedCandidateCount: 0,
      tokenCountAvailable: true,
      costAvailable: true,
      latencyMsAvailable: true,
      unsafeFieldCount: 6,
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedApprovalFields: true,
      privateOnly: true,
      shadowOnly: true,
      publishesFindings: false,
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
      rawContentFieldCount: 0,
      candidateBodyFieldCount: 0,
      githubPublicationFieldCount: 0,
      approvalFieldCount: 0,
      specialistContentIncluded: false,
      candidateFingerprintsIncluded: false,
      candidateBodiesIncluded: false,
      rawModelOutputIncluded: false,
      toolPayloadIncluded: false,
      approvalFieldsIncluded: false,
      tierModeIncluded: false,
      s04EvidenceAvailable: true,
      reviewDetailsProjectionAvailable: true,
      reviewDetailsProjectionStatus: "degraded",
      reviewDetailsLineAvailable: true,
      metricBoundedness: "bounded-aggregate-only",
      metricBoundednessAvailable: true,
      metricProjectionDegraded: false,
      compactReviewDetailsPrivateOnly: true,
      compactReviewDetailsShadowOnly: true,
      compactReviewDetailsVisiblePublicationDenied: true,
      compactReviewDetailsApprovalPublicationDenied: true,
    });
    expect(log?.data?.decisionCounts).toEqual({ candidate: 1, duplicate: 1, disagreement: 1, dismissed: 1, unclassifiable: 0 });
    expect(log?.data?.metricAvailability).toEqual({ tokenCount: "available", costUsd: "available", latencyMs: "available" });
    expect(log?.data).not.toHaveProperty("candidates");
    expect(log?.data).not.toHaveProperty("output");
    expect(JSON.stringify(log?.data)).not.toContain(specialistCanary);
    expect(JSON.stringify(log?.data)).not.toContain(specialistInlineCanary);
    expect(JSON.stringify(log?.data)).not.toContain("candidate-a");
  });

  test("keeps specialist candidate text out of executor prompt and clean issue-comment publication", async () => {
    const result = await runReviewWithShadowMetrics({ autoApprove: false });

    expect(result.executorInputs).toHaveLength(1);
    expect(result.executorInputs[0]?.prompt).toContain("normal review change");
    expect(result.executorInputs[0]?.prompt).not.toContain(specialistCanary);
    expect(result.executorInputs[0]?.triggerBody).not.toContain(specialistCanary);

    expect(result.issueCreatePayloads).toHaveLength(1);
    expect(result.reviewCreatePayloads).toHaveLength(0);
    const publishedBodies = [
      ...result.issueCreatePayloads.map((payload) => String(payload.body ?? "")),
      ...result.issueUpdatePayloads.map((payload) => String(payload.body ?? "")),
      ...result.reviewCreatePayloads.map((payload) => String(payload.body ?? "")),
      ...result.reviewUpdatePayloads.map((payload) => String(payload.body ?? "")),
    ];
    expect(publishedBodies.join("\n")).toContain("Decision: APPROVE");
    expect(publishedBodies.join("\n")).toContain("<summary>Review Details</summary>");
    const shadowLog = result.entries.find((entry) => entry.data?.gate === "shadow-specialist");
    const visibleBody = publishedBodies.join("\n");
    expect(visibleBody).toContain("- Shadow specialist: lane=docs-config-truth status=degraded");
    expect(visibleBody).toContain("candidateCount=4");
    expect(visibleBody).toContain("decisionCount=4");
    expect(visibleBody).toContain("duplicateCount=1");
    expect(visibleBody).toContain("disagreementCount=1");
    expect(visibleBody).toContain("metricAvailability=token:y,cost:y,latency:y");
    expect(visibleBody).toContain("visiblePublicationDenied=true");
    expect(visibleBody).toContain("approvalPublicationDenied=true");
    expect(visibleBody).toContain("privateOnly=true");
    expect(visibleBody).toContain("shadowOnly=true");
    expect(visibleBody).toContain(`correlationKey=${shadowLog?.data?.correlationKey}`);
    for (const body of publishedBodies) {
      expect(body).not.toContain(specialistCanary);
      expect(body).not.toContain(specialistInlineCanary);
      expect(body).not.toContain("operator-runbook-gap");
      expect(body).not.toContain("candidate-a");
    }
  });
});
