import { describe, expect, test } from "bun:test";
import {
  buildReviewNoFindingsBody,
  publishReviewNoFindingsNotice,
} from "./review-no-findings-publication.ts";

function createOctokitHarness() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    octokit: {
      rest: {
        issues: {
          createComment: async (params: Record<string, unknown>) => {
            calls.push(params);
            return { data: { id: 1 } };
          },
        },
      },
    } as never,
  };
}

function testLogger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined } as never;
}

describe("buildReviewNoFindingsBody", () => {
  test("states the review completed and found nothing, without error language", () => {
    const body = buildReviewNoFindingsBody({ afterRetry: false });

    expect(body).toContain("no findings");
    expect(body).toContain("ran to completion");
    // A clean result must never be described as a failure.
    expect(body.toLowerCase()).not.toContain("error");
    expect(body.toLowerCase()).not.toContain("failed");
  });

  test("says the review was re-run when a prior attempt did not finish", () => {
    expect(buildReviewNoFindingsBody({ afterRetry: true })).toContain("re-run");
  });
});

describe("publishReviewNoFindingsNotice", () => {
  test("posts the notice to the PR", async () => {
    const { octokit, calls } = createOctokitHarness();

    const result = await publishReviewNoFindingsNotice({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 213,
      botHandles: ["kodiai"],
      afterRetry: true,
      logger: testLogger(),
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: () => undefined,
    });

    expect(result.ok && result.value.published).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.issue_number).toBe(213);
  });

  test("respects the visible-output gate without posting", async () => {
    const { octokit, calls } = createOctokitHarness();

    const result = await publishReviewNoFindingsNotice({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 213,
      botHandles: ["kodiai"],
      afterRetry: false,
      logger: testLogger(),
      canPublishVisibleOutput: () => false,
      setReviewWorkPhase: () => undefined,
    });

    expect(result.ok && result.value.published).toBe(false);
    expect(result.ok && result.value.resolution).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  test("returns an error result rather than throwing when publication fails", async () => {
    const result = await publishReviewNoFindingsNotice({
      octokit: {
        rest: { issues: { createComment: async () => { throw new Error("boom"); } } },
      } as never,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 213,
      botHandles: ["kodiai"],
      afterRetry: false,
      logger: testLogger(),
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: () => undefined,
    });

    expect(result.ok).toBe(false);
  });
});
