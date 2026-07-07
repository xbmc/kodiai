import type { Octokit } from "@octokit/rest";
import { describe, expect, test } from "bun:test";
import { resolveReviewIdempotencyContext } from "./review-idempotency-context.ts";

describe("resolveReviewIdempotencyContext", () => {
  test("builds installation octokit and evaluates the review output idempotency gate", async () => {
    const octokit = { marker: "octokit" } as unknown as Octokit;
    const calls: Array<{ installationId?: number; owner?: string; repo?: string; prNumber?: number }> = [];

    const result = await resolveReviewIdempotencyContext({
      installationId: 42,
      getInstallationOctokit: async (installationId) => {
        calls.push({ installationId });
        return octokit;
      },
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 195,
      reviewOutputKey: "review-key",
      baseLog: { deliveryId: "delivery-1" },
      logger: { info: () => undefined },
      evaluateIdempotencyGate: async (params) => {
        calls.push({
          owner: params.owner,
          repo: params.repo,
          prNumber: params.prNumber,
        });
        expect(params.octokit).toBe(octokit);
        expect(params.reviewOutputKey).toBe("review-key");
        expect(params.baseLog).toEqual({ deliveryId: "delivery-1" });
        return { action: "continue", acceptedCanonicalSurface: null };
      },
    });

    expect(result).toEqual({
      octokit,
      idempotencyGate: { action: "continue", acceptedCanonicalSurface: null },
      acceptedCanonicalSurface: null,
    });
    expect(calls).toEqual([
      { installationId: 42 },
      { owner: "xbmc", repo: "kodiai", prNumber: 195 },
    ]);
  });
});
