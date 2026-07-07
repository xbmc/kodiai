import { describe, expect, test } from "bun:test";
import {
  buildReviewHandlerFailurePublicationAdapter,
  buildReviewHandlerFailurePublicationAdapterFromHandlerDependencies,
} from "./review-handler-failure-publication-adapter.ts";

describe("buildReviewHandlerFailurePublicationAdapter", () => {
  test("binds handler failure publication dependencies behind a zero-argument adapter", async () => {
    const calls: unknown[] = [];
    const error = new Error("handler failed");
    const octokit = { rest: {} };
    const adapter = buildReviewHandlerFailurePublicationAdapter({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      error,
      logger: {} as never,
      canPublishVisibleOutput: (reason) => reason === "handler failure error comment",
      setReviewWorkPhase: (phase) => calls.push({ phase }),
      publishReviewHandlerFailureError: async (params) => {
        calls.push(params);
        return { ok: true, value: { phaseDetail: "posted error comment after handler failure" } };
      },
    });

    await expect(adapter()).resolves.toEqual({
      ok: true,
      value: { phaseDetail: "posted error comment after handler failure" },
    });
    expect(calls).toEqual([
      {
        octokit,
        owner: "acme",
        repo: "repo",
        prNumber: 42,
        error,
        logger: {},
        canPublishVisibleOutput: expect.any(Function),
        setReviewWorkPhase: expect.any(Function),
      },
    ]);
  });

  test("builds handler failure publication adapter from handler dependencies", async () => {
    const calls: unknown[] = [];
    const error = new Error("handler failed");
    const octokit = { rest: {} };
    const adapter = buildReviewHandlerFailurePublicationAdapterFromHandlerDependencies({
      installationId: 123,
      getInstallationOctokit: async (installationId) => {
        expect(installationId).toBe(123);
        return octokit as never;
      },
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      error,
      logger: {} as never,
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: (phase) => calls.push({ phase }),
      publishReviewHandlerFailureError: async (params) => {
        calls.push(params);
        return { ok: true, value: { phaseDetail: "posted error comment after handler failure" } };
      },
    });

    await expect(adapter()).resolves.toEqual({
      ok: true,
      value: { phaseDetail: "posted error comment after handler failure" },
    });
    expect(calls).toEqual([
      {
        octokit,
        owner: "acme",
        repo: "repo",
        prNumber: 42,
        error,
        logger: {},
        canPublishVisibleOutput: expect.any(Function),
        setReviewWorkPhase: expect.any(Function),
      },
    ]);
  });
});
