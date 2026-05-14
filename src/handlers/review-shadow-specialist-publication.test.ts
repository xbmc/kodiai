import { describe, expect, test } from "bun:test";

import {
  runReviewWithShadowMetrics,
  specialistCanary,
  specialistInlineCanary,
} from "./review-m070-integration-harness.ts";

describe("review handler shadow specialist publication boundary", () => {
  test("denies specialist-derived approval/comment fields while normal clean approval still publishes", async () => {
    const result = await runReviewWithShadowMetrics({ autoApprove: true });

    expect(result.executorInputs).toHaveLength(1);
    expect(result.executorInputs[0]?.prompt).toContain("normal review change");
    expect(result.executorInputs[0]?.prompt).not.toContain(specialistCanary);
    expect(result.executorInputs[0]?.triggerBody).not.toContain(specialistInlineCanary);

    expect(result.issueCreatePayloads).toHaveLength(0);
    expect(result.reviewCreatePayloads).toHaveLength(1);
    expect(result.reviewCreatePayloads[0]?.event).toBe("APPROVE");

    const publishedBodies = [
      ...result.issueCreatePayloads.map((payload) => String(payload.body ?? "")),
      ...result.issueUpdatePayloads.map((payload) => String(payload.body ?? "")),
      ...result.reviewCreatePayloads.map((payload) => String(payload.body ?? "")),
      ...result.reviewUpdatePayloads.map((payload) => String(payload.body ?? "")),
    ];
    const visibleBody = publishedBodies.join("\n");

    expect(visibleBody).toContain("Decision: APPROVE");
    expect(visibleBody).toContain("Issues: none");
    expect(visibleBody).toContain("Review prompt covered 1 changed file.");
    expect(visibleBody).toContain("<summary>Review Details</summary>");
    const shadowLog = result.entries.find((entry) => entry.data?.gate === "shadow-specialist");
    expect(visibleBody).toContain("- Shadow specialist: lane=docs-config-truth status=degraded");
    expect(visibleBody).toContain("candidateCount=4");
    expect(visibleBody).toContain("decisionCount=4");
    expect(visibleBody).toContain("duplicateCount=1");
    expect(visibleBody).toContain("disagreementCount=1");
    expect(visibleBody).toContain("metricAvailability=token:y,cost:y,latency:y");
    expect(visibleBody).toContain("visiblePublicationDenied=true");
    expect(visibleBody).toContain("approvalPublicationDenied=true");
    expect(visibleBody).toContain(`correlationKey=${shadowLog?.data?.correlationKey}`);
    expect(visibleBody).not.toContain(specialistCanary);
    expect(visibleBody).not.toContain(specialistInlineCanary);
    expect(visibleBody).not.toContain("candidate-a");
    expect(visibleBody).not.toContain("operator-runbook-gap");

    const log = result.entries.find((entry) => entry.data?.gate === "shadow-specialist");
    expect(log?.data).toMatchObject({
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
      publishesFindings: false,
      approvalFieldsIncluded: false,
      candidateBodiesIncluded: false,
      rawModelOutputIncluded: false,
    });
  });
});
