import { describe, expect, test } from "bun:test";
import {
  buildAutomaticLaneLogEvidence,
  buildExplicitLaneEvidenceFromLogs,
  classifyReviewArtifactEvidence,
  loadAutomaticLaneEvidence,
  type AutomaticLaneEvidence,
  type AutomaticLaneLogEvidence,
  type ExplicitLaneEvidence,
} from "./evidence-correlation.ts";
import type { RecentReviewArtifact } from "./recent-review-sample.ts";
import { buildReviewOutputKey } from "../handlers/review-idempotency.ts";

function makeArtifact(overrides: Partial<RecentReviewArtifact> & Pick<RecentReviewArtifact, "prNumber" | "lane" | "source">): RecentReviewArtifact {
  const reviewOutputKey = overrides.reviewOutputKey ?? buildReviewOutputKey({
    installationId: 42,
    owner: "xbmc",
    repo: "xbmc",
    prNumber: overrides.prNumber,
    action: overrides.lane === "explicit" ? "mention-review" : "review_requested",
    deliveryId: `delivery-${overrides.prNumber}`,
    headSha: `head-${overrides.prNumber}`,
  });

  return {
    prNumber: overrides.prNumber,
    prUrl: overrides.prUrl ?? `https://github.com/xbmc/xbmc/pull/${overrides.prNumber}`,
    source: overrides.source,
    sourceUrl: overrides.sourceUrl ?? `https://github.com/xbmc/xbmc/pull/${overrides.prNumber}#artifact`,
    updatedAt: overrides.updatedAt ?? "2026-04-08T12:00:00.000Z",
    reviewOutputKey,
    lane: overrides.lane,
    action: overrides.action ?? (overrides.lane === "explicit" ? "mention-review" : "review_requested"),
  };
}

function createSqlStub() {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");

    if (query.includes("FROM reviews")) {
      expect(values).toContain("xbmc/xbmc");
      expect(values).toContain(101);
      expect(values).toContain("delivery-101-retry-1");
      return Promise.resolve([
        { id: 77, delivery_id: "delivery-101-retry-1", findings_total: 2, conclusion: "success" },
      ]);
    }

    if (query.includes("FROM findings")) {
      expect(values).toContain(77);
      return Promise.resolve([
        { matching_finding_count: 2, published_finding_count: 2 },
      ]);
    }

    if (query.includes("FROM review_checkpoints")) {
      return Promise.resolve([
        { partial_comment_id: 555 },
      ]);
    }

    if (query.includes("FROM telemetry_events")) {
      expect(values).toContain("delivery-101-retry-1");
      return Promise.resolve([
        { conclusion: "success", event_type: "pull_request.review_requested" },
      ]);
    }

    throw new Error(`Unexpected query: ${query}`);
  }) as never;
}

describe("review audit evidence correlation", () => {
  test("loadAutomaticLaneEvidence correlates review, finding, checkpoint, and telemetry rows by effective delivery id", async () => {
    const artifact = makeArtifact({
      prNumber: 101,
      lane: "automatic",
      source: "review-comment",
      reviewOutputKey: `${buildReviewOutputKey({
        installationId: 42,
        owner: "xbmc",
        repo: "xbmc",
        prNumber: 101,
        action: "review_requested",
        deliveryId: "delivery-101",
        headSha: "head-101",
      })}-retry-1`,
    });

    const result = await loadAutomaticLaneEvidence({
      sql: createSqlStub(),
      artifact,
    });

    expect(result.sourceAvailability.reviewRecord).toBe("present");
    expect(result.reviewRecord?.deliveryId).toBe("delivery-101-retry-1");
    expect(result.reviewRecord?.findingsTotal).toBe(2);
    expect(result.matchingFindingCount).toBe(2);
    expect(result.publishedFindingCount).toBe(2);
    expect(result.checkpoint?.partialCommentId).toBe(555);
    expect(result.telemetry?.eventType).toBe("pull_request.review_requested");
  });

  test("buildAutomaticLaneLogEvidence extracts automatic evidence-bundle outcomes from Azure rows", () => {
    const result = buildAutomaticLaneLogEvidence([
      {
        timeGenerated: "2026-04-09T00:00:00.000Z",
        rawLog: JSON.stringify({
          evidenceType: "review",
          outcome: "published-output",
          reviewOutputPublicationState: "publish",
          idempotencyDecision: "publish",
        }),
        malformed: false,
        deliveryId: "delivery-123",
        reviewOutputKey: "rok-123",
        message: "Evidence bundle",
        revisionName: "ca-kodiai--0000076",
        containerAppName: "ca-kodiai",
        parsedLog: {
          evidenceType: "review",
          outcome: "published-output",
          reviewOutputPublicationState: "publish",
          idempotencyDecision: "publish",
        },
      },
    ]);

    expect(result.sourceAvailability.azureLogs).toBe("present");
    expect(result.evidenceBundleOutcome).toBe("published-output");
    expect(result.reviewOutputPublicationState).toBe("publish");
    expect(result.idempotencyDecision).toBe("publish");
  });

  test("buildExplicitLaneEvidenceFromLogs extracts publishResolution from Azure rows", () => {
    const result = buildExplicitLaneEvidenceFromLogs([
      {
        timeGenerated: "2026-04-09T00:00:00.000Z",
        rawLog: JSON.stringify({
          conclusion: "success",
          publishResolution: "approval-bridge",
        }),
        malformed: false,
        deliveryId: "delivery-123",
        reviewOutputKey: "rok-123",
        message: "Mention execution completed",
        revisionName: "ca-kodiai--0000076",
        containerAppName: "ca-kodiai",
        parsedLog: {
          conclusion: "success",
          publishResolution: "approval-bridge",
        },
      },
    ]);

    expect(result.sourceAvailability.publishResolution).toBe("present");
    expect(result.publishResolution).toBe("approval-bridge");
  });

  test("classifyReviewArtifactEvidence uses automatic Azure evidence-bundle outcomes before DB fallbacks", () => {
    const artifact = makeArtifact({ prNumber: 106, lane: "automatic", source: "issue-comment" });
    const automaticLogEvidence: AutomaticLaneLogEvidence = {
      sourceAvailability: { azureLogs: "present" },
      evidenceBundleOutcome: "submitted-approval",
      reviewOutputPublicationState: "publish",
      idempotencyDecision: "publish",
    };

    const result = classifyReviewArtifactEvidence({
      artifact,
      automaticEvidence: {
        sourceAvailability: {
          reviewRecord: "unavailable",
          findings: "unavailable",
          checkpoint: "unavailable",
          telemetry: "unavailable",
        },
        reviewRecord: null,
        matchingFindingCount: null,
        publishedFindingCount: null,
        checkpoint: null,
        telemetry: null,
      },
      automaticLogEvidence,
    });

    expect(result.verdict).toBe("clean-valid");
  });

  test("classifyReviewArtifactEvidence returns findings-published for automatic findings with published rows", () => {
    const artifact = makeArtifact({ prNumber: 101, lane: "automatic", source: "review-comment" });
    const automaticEvidence: AutomaticLaneEvidence = {
      sourceAvailability: {
        reviewRecord: "present",
        findings: "present",
        checkpoint: "missing",
        telemetry: "present",
      },
      reviewRecord: { deliveryId: "delivery-101", findingsTotal: 2, conclusion: "success" },
      matchingFindingCount: 2,
      publishedFindingCount: 2,
      checkpoint: null,
      telemetry: { conclusion: "success", eventType: "pull_request.review_requested" },
    };

    const result = classifyReviewArtifactEvidence({ artifact, automaticEvidence });

    expect(result.verdict).toBe("findings-published");
  });

  test("classifyReviewArtifactEvidence returns clean-valid for automatic clean review details", () => {
    const artifact = makeArtifact({ prNumber: 102, lane: "automatic", source: "issue-comment" });
    const automaticEvidence: AutomaticLaneEvidence = {
      sourceAvailability: {
        reviewRecord: "present",
        findings: "present",
        checkpoint: "missing",
        telemetry: "present",
      },
      reviewRecord: { deliveryId: "delivery-102", findingsTotal: 0, conclusion: "success" },
      matchingFindingCount: 0,
      publishedFindingCount: 0,
      checkpoint: null,
      telemetry: { conclusion: "success", eventType: "pull_request.review_requested" },
    };

    const result = classifyReviewArtifactEvidence({ artifact, automaticEvidence });

    expect(result.verdict).toBe("clean-valid");
  });

  test("classifyReviewArtifactEvidence returns suspicious-approval when automatic review found issues without published finding rows", () => {
    const artifact = makeArtifact({ prNumber: 103, lane: "automatic", source: "review" });
    const automaticEvidence: AutomaticLaneEvidence = {
      sourceAvailability: {
        reviewRecord: "present",
        findings: "present",
        checkpoint: "missing",
        telemetry: "present",
      },
      reviewRecord: { deliveryId: "delivery-103", findingsTotal: 2, conclusion: "success" },
      matchingFindingCount: 0,
      publishedFindingCount: 0,
      checkpoint: null,
      telemetry: { conclusion: "success", eventType: "pull_request.review_requested" },
    };

    const result = classifyReviewArtifactEvidence({ artifact, automaticEvidence });

    expect(result.verdict).toBe("suspicious-approval");
  });

  test("classifyReviewArtifactEvidence returns indeterminate for explicit reviews without publish-resolution evidence", () => {
    const artifact = makeArtifact({ prNumber: 104, lane: "explicit", source: "review" });
    const explicitEvidence: ExplicitLaneEvidence = {
      sourceAvailability: {
        telemetry: "present",
        publishResolution: "unavailable",
      },
      telemetry: { conclusion: "success", eventType: "issue_comment.created" },
      publishResolution: null,
    };

    const result = classifyReviewArtifactEvidence({ artifact, explicitEvidence });

    expect(result.verdict).toBe("indeterminate");
  });

  test("classifyReviewArtifactEvidence returns publish-failure for explicit publish failure resolutions", () => {
    const artifact = makeArtifact({ prNumber: 105, lane: "explicit", source: "issue-comment" });
    const explicitEvidence: ExplicitLaneEvidence = {
      sourceAvailability: {
        telemetry: "present",
        publishResolution: "present",
      },
      telemetry: { conclusion: "failure", eventType: "issue_comment.created" },
      publishResolution: "publish-failure-fallback",
    };

    const result = classifyReviewArtifactEvidence({ artifact, explicitEvidence });

    expect(result.verdict).toBe("publish-failure");
  });
});
