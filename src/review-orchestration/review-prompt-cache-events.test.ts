import { describe, expect, test } from "bun:test";
import {
  buildPromptReviewCacheEvent,
  buildRetrievalReviewCacheEvent,
  normalizeReviewCacheSignalNames,
} from "./review-prompt-cache-events.ts";

describe("normalizeReviewCacheSignalNames", () => {
  test("deduplicates, lowercases, and filters invalid signal names", () => {
    expect(normalizeReviewCacheSignalNames([" Prompt-Scope ", "prompt-scope", "INVALID SIGNAL!"])).toEqual([
      "prompt-scope",
    ]);
  });
});

describe("buildPromptReviewCacheEvent", () => {
  test("maps prompt cache hit state to safe-reuse telemetry", () => {
    expect(buildPromptReviewCacheEvent({
      deliveryId: "delivery-1",
      repo: "xbmc/xbmc",
      prNumber: 28172,
      state: {
        status: "hit",
        reason: null,
        fingerprintVersion: "review-prompt-v1",
        safetySignalNames: ["prompt-fingerprint"],
      },
    })).toMatchObject({
      cacheSurface: "review-derived-prompt",
      status: "hit",
      reason: "safe-reuse",
    });
  });
});

describe("buildRetrievalReviewCacheEvent", () => {
  test("returns degraded event when retrieval provenance is missing", () => {
    expect(buildRetrievalReviewCacheEvent({
      deliveryId: "delivery-1",
      repo: "xbmc/xbmc",
      prNumber: 28172,
      result: null,
    })).toMatchObject({
      cacheSurface: "retrieval-query-embedding",
      status: "degraded",
      reason: "unavailable-retrieval",
    });
  });

  test("returns hit event when embedding cache hits are present", () => {
    expect(buildRetrievalReviewCacheEvent({
      deliveryId: "delivery-1",
      repo: "xbmc/xbmc",
      prNumber: 28172,
      result: {
        provenance: {
          embeddingRequests: 2,
          embeddingCacheHits: 1,
        },
      } as never,
    })).toMatchObject({
      status: "hit",
      reason: "safe-reuse",
    });
  });
});
