import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { Octokit } from "@octokit/rest";
import type {
  InlineReviewPublicationResult,
  InlineReviewPublisherOptions,
  PublishInlineReviewCommentInput,
} from "../execution/mcp/inline-review-publisher.ts";
import type { createReviewOutputPublicationGate } from "../execution/mcp/review-output-publication-gate.ts";
import type { PublishableReviewCandidateInlinePayload } from "../review-orchestration/review-candidate-publication-adapter.ts";
import { publishReviewCandidateInlineComments } from "./review-candidate-inline-publication.ts";

function payload(fingerprint: string): PublishableReviewCandidateInlinePayload {
  return {
    candidateFingerprint: fingerprint,
    candidatePublicationLifecycle: "approved",
    source: "candidate",
    publication: {
      location: { path: "src/app.ts", line: 12 },
      body: `body ${fingerprint}`,
    },
    finding: {
      filePath: "src/app.ts",
      title: `Finding ${fingerprint}`,
      severity: "medium",
      category: "correctness",
    },
  };
}

function baseParams(overrides: Partial<Parameters<typeof publishReviewCandidateInlineComments>[0]> = {}) {
  return {
    payloads: [payload("fp-a"), payload("fp-b")],
    canPublishVisibleOutput: () => true,
    getOctokit: async () => ({}) as Octokit,
    owner: "acme",
    repo: "widget",
    prNumber: 42,
    botHandles: ["kodiai", "claude"],
    reviewOutputKey: "review-key",
    deliveryId: "delivery-1",
    logger: undefined as Logger | undefined,
    candidateVerificationContext: {
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      correlationKey: "corr-1",
      docsConfigTruth: null,
    },
    prDiffCommentabilityIndex: undefined,
    ...overrides,
  };
}

describe("publishReviewCandidateInlineComments", () => {
  test("publishes each payload with a candidate-specific review output key", async () => {
    const publisherOptions: InlineReviewPublisherOptions[] = [];
    const publishedInputs: PublishInlineReviewCommentInput[] = [];
    const gateKeys: string[] = [];

    const result = await publishReviewCandidateInlineComments(baseParams({
      createPublicationGate: ((params) => {
        gateKeys.push(params.reviewOutputKey);
        return {} as ReturnType<typeof createReviewOutputPublicationGate>;
      }) as typeof createReviewOutputPublicationGate,
      createPublisher: (options) => {
        publisherOptions.push(options);
        return {
          async publish(input) {
            publishedInputs.push(input);
            return {
              status: "published",
              commentId: publishedInputs.length,
              content: [{ type: "text", text: "published" }],
            } satisfies InlineReviewPublicationResult;
          },
        };
      },
    }));

    expect([...result.results.entries()]).toEqual([
      ["fp-a", expect.objectContaining({ status: "published", commentId: 1 })],
      ["fp-b", expect.objectContaining({ status: "published", commentId: 2 })],
    ]);
    expect(publishedInputs.map((input) => input.body)).toEqual(["body fp-a", "body fp-b"]);
    expect(publisherOptions.map((options) => options.reviewOutputKey)).toEqual([
      "review-key:candidate:fp-a",
      "review-key:candidate:fp-b",
    ]);
    expect(gateKeys).toEqual([
      "review-key:candidate:fp-a",
      "review-key:candidate:fp-b",
    ]);
  });

  test("returns blocked results without creating publishers when visible output is superseded", async () => {
    let publisherCreated = false;

    const result = await publishReviewCandidateInlineComments(baseParams({
      canPublishVisibleOutput: (label) => {
        expect(label).toBe("candidate-approved inline review comments");
        return false;
      },
      createPublisher: () => {
        publisherCreated = true;
        return {
          async publish() {
            throw new Error("publish should not run");
          },
        };
      },
    }));

    expect(publisherCreated).toBe(false);
    expect([...result.results.entries()]).toEqual([
      ["fp-a", expect.objectContaining({
        status: "blocked",
        reason: "publication-failed",
        isError: true,
      })],
      ["fp-b", expect.objectContaining({
        status: "blocked",
        reason: "publication-failed",
        isError: true,
      })],
    ]);
  });
});
