import { describe, expect, test } from "bun:test";
import { buildReviewDetailsAttemptLogFields } from "./review-details-attempt-log-fields.ts";

describe("buildReviewDetailsAttemptLogFields", () => {
  test("projects delta counts and retrieval provenance count", () => {
    expect(buildReviewDetailsAttemptLogFields({
      deltaCounts: {
        new: 2,
        resolved: 1,
        stillOpen: 3,
      },
      retrievalFindingCount: 4,
    })).toEqual({
      deltaNew: 2,
      deltaResolved: 1,
      deltaStillOpen: 3,
      provenanceCount: 4,
    });
  });

  test("uses nulls when delta classification or retrieval context is unavailable", () => {
    expect(buildReviewDetailsAttemptLogFields({
      deltaCounts: null,
      retrievalFindingCount: null,
    })).toEqual({
      deltaNew: null,
      deltaResolved: null,
      deltaStillOpen: null,
      provenanceCount: null,
    });
  });
});
