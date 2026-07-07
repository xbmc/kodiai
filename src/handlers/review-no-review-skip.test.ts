import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import {
  buildNoReviewSkipAcknowledgmentBody,
  evaluateNoReviewSkipGate,
  postNoReviewSkipAcknowledgment,
} from "./review-no-review-skip.ts";

function makeLogger() {
  const entries: Array<{ level: string; data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      info(data: Record<string, unknown>, message: string) {
        entries.push({ level: "info", data, message });
      },
      warn(data: Record<string, unknown>, message: string) {
        entries.push({ level: "warn", data, message });
      },
    } as unknown as Pick<Logger, "info" | "warn">,
  };
}

describe("no-review skip acknowledgment", () => {
  test("formats the no-review acknowledgment body", () => {
    expect(buildNoReviewSkipAcknowledgmentBody()).toBe(
      "Review skipped per `[no-review]` in PR title.",
    );
  });

  test("publishes the acknowledgment through the GitHub publication pipeline", async () => {
    const createComment = mock(async (params: unknown) => ({ data: { id: 123, params } }));
    const octokit = {
      rest: {
        issues: {
          createComment,
        },
      },
    } as any;

    await postNoReviewSkipAcknowledgment({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      botHandles: ["kodiai", "claude"],
    });

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment.mock.calls[0]![0]).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      issue_number: 42,
      body: "Review skipped per `[no-review]` in PR title.",
    });
  });

  test("continues when the PR title does not request a no-review skip", async () => {
    const { logger, entries } = makeLogger();
    const getOctokit = mock(async () => {
      throw new Error("should not fetch octokit");
    });

    const decision = await evaluateNoReviewSkipGate({
      prTitle: "Regular feature",
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      baseLog: { prNumber: 42 },
      botHandles: ["kodiai", "claude"],
      getOctokit,
      logger,
    });

    expect(decision).toEqual({ action: "continue" });
    expect(getOctokit).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  });

  test("skips and publishes an acknowledgment when the PR title contains no-review", async () => {
    const { logger, entries } = makeLogger();
    const createComment = mock(async (params: unknown) => ({ data: { id: 123, params } }));
    const getOctokit = mock(async () => ({
      rest: { issues: { createComment } },
    } as any));

    const decision = await evaluateNoReviewSkipGate({
      prTitle: "Feature [no-review]",
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      baseLog: { prNumber: 42 },
      botHandles: ["kodiai", "claude"],
      getOctokit,
      logger,
    });

    expect(decision).toEqual({ action: "skip" });
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([
      {
        level: "info",
        data: { prNumber: 42, gate: "keyword-skip", gateResult: "skipped" },
        message: "Review skipped via [no-review] keyword in PR title",
      },
    ]);
  });

  test("skips and logs a warning when acknowledgment publication fails", async () => {
    const { logger, entries } = makeLogger();
    const err = new Error("comment failed");

    const decision = await evaluateNoReviewSkipGate({
      prTitle: "Feature [NO-REVIEW]",
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      baseLog: { prNumber: 42 },
      botHandles: ["kodiai", "claude"],
      getOctokit: async () => {
        throw err;
      },
      logger,
    });

    expect(decision).toEqual({ action: "skip" });
    expect(entries).toEqual([
      {
        level: "info",
        data: { prNumber: 42, gate: "keyword-skip", gateResult: "skipped" },
        message: "Review skipped via [no-review] keyword in PR title",
      },
      {
        level: "warn",
        data: { prNumber: 42, err },
        message: "Failed to publish no-review skip acknowledgment (non-fatal)",
      },
    ]);
  });
});
