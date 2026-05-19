import { describe, expect, test } from "bun:test";

import { createReviewCandidateFindingExecutionResult } from "../review-orchestration/review-candidate-finding.ts";
import {
  attachReviewFindingLifecycle,
  type AttachReviewFindingLifecycleInput,
  type BoundedReviewFindingSummary,
  type ReviewLifecycleHandlerCorrelation,
} from "./handler-lifecycle.ts";

const correlation: ReviewLifecycleHandlerCorrelation = {
  repo: "acme/widgets",
  pullNumber: 74,
  reviewOutputKey: "m074-s02-review-output",
  deliveryId: "delivery-m074-s02",
  commitSha: "abc123def456",
  headRef: "feature/m074-s02",
  baseRef: "main",
};

function boundedFinding(overrides: Partial<BoundedReviewFindingSummary> = {}): BoundedReviewFindingSummary {
  return {
    filePath: "src/review.ts",
    startLine: 12,
    endLine: 12,
    severity: "major",
    category: "correctness",
    title: "Review finding should preserve lifecycle evidence",
    confidence: 91,
    actionability: "actionable",
    validationNeeds: ["needs-tests"],
    revalidationState: "pending",
    reasonCodes: ["needs-lifecycle-evidence"],
    commentId: 1234,
    ...overrides,
  };
}

function attach(params: Partial<AttachReviewFindingLifecycleInput> = {}) {
  return attachReviewFindingLifecycle({
    source: "automatic",
    trigger: "pull_request",
    correlation,
    findings: [boundedFinding()],
    ...params,
  });
}

describe("attachReviewFindingLifecycle", () => {
  test("produces equivalent aggregate projections for automatic and mention review fixtures", () => {
    const automatic = attach({
      source: "automatic",
      trigger: "pull_request",
      findings: [boundedFinding()],
    });
    const mention = attach({
      source: "mention",
      trigger: "issue_comment",
      findings: [boundedFinding()],
    });

    expect(automatic.status).toBe("normalized");
    expect(mention.status).toBe("normalized");
    expect(automatic.projection.counts.recorded).toBe(mention.projection.counts.recorded);
    expect(automatic.projection.counts.status).toEqual(mention.projection.counts.status);
    expect(automatic.projection.counts.severity).toEqual(mention.projection.counts.severity);
    expect(automatic.projection.counts.actionability).toEqual(mention.projection.counts.actionability);
    expect(automatic.projection.counts.validationNeeds).toEqual(mention.projection.counts.validationNeeds);
    expect(automatic.projection.counts.revalidationState).toEqual(mention.projection.counts.revalidationState);
    expect(automatic.logEvidence).toMatchObject({
      gate: "review-finding-lifecycle",
      reviewOutputKey: "m074-s02-review-output",
      deliveryId: "delivery-m074-s02",
      source: "automatic",
      trigger: "pull_request",
      normalizedStatus: "normalized",
    });
    expect(mention.logEvidence).toMatchObject({
      gate: "review-finding-lifecycle",
      source: "mention",
      trigger: "issue_comment",
    });
  });

  test("uses deterministic lifecycle IDs across repeated runs", () => {
    const first = attach({ findings: [boundedFinding({ commentId: 1 })] });
    const second = attach({ findings: [boundedFinding({ commentId: 999 })] });

    expect(first.lifecycle.records[0]?.id).toEqual(expect.stringMatching(/^rfl-[a-f0-9]{16}$/));
    expect(first.lifecycle.records[0]?.id).toBe(second.lifecycle.records[0]?.id);
    expect(first.lifecycle.records[0]?.identityHash).toBe(second.lifecycle.records[0]?.identityHash);
  });

  test("derives bounded evidence references from files, comments, candidates, and trigger source", () => {
    const result = attach({
      findings: [boundedFinding({ commentId: "comment-123", candidateFingerprint: "rcf-fingerprint-123" })],
    });

    expect(result.lifecycle.records[0]?.evidenceRefs).toEqual([
      { kind: "file", ref: "src/review.ts:12" },
      { kind: "artifact", ref: "comment:comment-123" },
      { kind: "artifact", ref: "candidate:rcf-fingerprint-123" },
      { kind: "rule", ref: "trigger:automatic" },
    ]);
    expect(JSON.stringify(result.projection.references)).not.toContain("Private body");
  });

  test("adapts candidate finding execution results through the same lifecycle normalization path", () => {
    const candidateFinding = createReviewCandidateFindingExecutionResult({
      repo: correlation.repo!,
      pullNumber: correlation.pullNumber!,
      reviewOutputKey: correlation.reviewOutputKey!,
      deliveryId: correlation.deliveryId,
      artifactPresent: true,
      candidates: [
        {
          filePath: "src/candidate.ts",
          startLine: 9,
          severity: "critical",
          category: "security",
          title: "Candidate finding needs security validation",
          body: "Private candidate body omitted from lifecycle projection.",
          evidence: "Private candidate evidence omitted from lifecycle projection.",
        },
      ],
    });

    const result = attach({ findings: [], candidateFinding });

    expect(result.status).toBe("normalized");
    expect(result.lifecycle.records[0]).toMatchObject({
      filePath: "src/candidate.ts",
      severity: "critical",
      category: "security",
      title: "Candidate finding needs security validation",
      validationNeeds: ["needs-security-review"],
    });
    expect(result.lifecycle.records[0]?.evidenceRefs).toContainEqual({
      kind: "artifact",
      ref: expect.stringMatching(/^candidate:rcf-[a-f0-9]{16}$/),
    });
    const publicJson = JSON.stringify(result.projection);
    expect(publicJson).not.toContain("Private candidate body");
    expect(publicJson).not.toContain("Private candidate evidence");
  });

  test("omits raw/private fields and reports explicit redaction flags", () => {
    const result = attach({
      findings: [
        {
          ...boundedFinding({ title: "Safe public title" }),
          body: "Private body should not be retained",
          rawPrompt: "RAW_PROMPT_CANARY BEGIN PROMPT",
          rawModelOutput: "RAW_MODEL_OUTPUT_CANARY model output",
          toolPayload: { private: "TOOL_PAYLOAD_CANARY" },
          diffText: "DIFF_TEXT_CANARY diff --git a/file b/file",
        } as BoundedReviewFindingSummary,
        boundedFinding({ title: "Surviving safe finding" }),
      ],
    });

    const publicJson = JSON.stringify(result.projection);
    expect(result.status).toBe("degraded");
    expect(result.projection.redaction).toMatchObject({
      privateOnly: true,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      toolPayloadsIncluded: false,
      secretLikeStringsIncluded: false,
      diffsIncluded: false,
      unboundedArraysIncluded: false,
    });
    for (const forbidden of [
      "Private body should not be retained",
      "RAW_PROMPT_CANARY",
      "RAW_MODEL_OUTPUT_CANARY",
      "TOOL_PAYLOAD_CANARY",
      "DIFF_TEXT_CANARY",
      "diff --git",
    ]) {
      expect(publicJson).not.toContain(forbidden);
    }
  });

  test("fails closed as unavailable when correlation is missing instead of throwing", () => {
    const result = attach({
      correlation: { ...correlation, reviewOutputKey: "" },
      findings: [boundedFinding(), boundedFinding({ title: "Second finding" })],
    });

    expect(result.status).toBe("unavailable");
    expect(result.lifecycle.records).toHaveLength(0);
    expect(result.lifecycle.counts).toMatchObject({ input: 2, recorded: 0, rejected: 2 });
    expect(result.lifecycle.rejections).toEqual([
      { index: 0, reason: "missing-correlation" },
      { index: 1, reason: "missing-correlation" },
    ]);
    expect(result.projection.rejectedReasonCodes).toEqual(["missing-correlation"]);
    expect(result.logEvidence.normalizedStatus).toBe("unavailable");
  });
});
