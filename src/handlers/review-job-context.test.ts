import { describe, expect, test } from "bun:test";
import {
  buildReviewJobQueueContext,
  buildReviewRetryJobQueueContext,
} from "./review-job-context.ts";

describe("review job queue context", () => {
  test("builds the first-pass review queue context", () => {
    expect(buildReviewJobQueueContext({
      deliveryId: "delivery-1",
      eventName: "pull_request",
      action: "opened",
      reviewFamilyKey: "acme/repo#42",
      prNumber: 42,
    })).toEqual({
      deliveryId: "delivery-1",
      eventName: "pull_request",
      action: "opened",
      lane: "review",
      key: "acme/repo#42",
      jobType: "pull-request-review",
      prNumber: 42,
    });
  });

  test("builds the retry review queue context", () => {
    expect(buildReviewRetryJobQueueContext({
      retryDeliveryId: "delivery-1-retry-1",
      eventName: "pull_request",
      reviewFamilyKey: "acme/repo#42",
      prNumber: 42,
    })).toEqual({
      deliveryId: "delivery-1-retry-1",
      eventName: "pull_request",
      action: "review-retry",
      lane: "review",
      key: "acme/repo#42",
      jobType: "pull-request-review-retry",
      prNumber: 42,
    });
  });
});
