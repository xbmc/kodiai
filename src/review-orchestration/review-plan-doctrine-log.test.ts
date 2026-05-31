import { describe, expect, test } from "bun:test";
import {
  buildRepoDoctrineLogFields,
  serializeReviewPlanBuilderError,
  toRepoDoctrineReviewSurfaceProjection,
} from "./review-plan-doctrine-log.ts";

describe("review plan doctrine log helpers", () => {
  test("projects disabled repo doctrine status", () => {
    expect(toRepoDoctrineReviewSurfaceProjection({
      enabled: false,
      contractCount: 0,
      consumedContractCount: 0,
      matchedPathCandidateCount: 0,
      omittedContractCount: 0,
      omittedMatchedPathCandidateCount: 0,
      reasonCodes: [],
    })).toEqual({
      status: "disabled",
      contractCount: 0,
      matchedCount: 0,
      omittedCount: 0,
      reasonCodes: ["disabled"],
    });
  });

  test("builds bounded repo doctrine log fields", () => {
    const fields = buildRepoDoctrineLogFields({
      enabled: true,
      contractCount: 2,
      consumedContractCount: 1,
      matchedPathCandidateCount: 1,
      omittedContractCount: 0,
      omittedMatchedPathCandidateCount: 0,
      reasonCodes: [],
    });

    expect(fields.repoDoctrineStatus).toBe("applied");
    expect(fields.repoDoctrineContractCount).toBe(2);
  });

  test("serializes review plan builder failures without leaking raw errors", () => {
    expect(serializeReviewPlanBuilderError(new Error("secret details"))).toEqual({
      name: "Error",
      message: "ReviewPlan builder failed",
    });
  });
});
