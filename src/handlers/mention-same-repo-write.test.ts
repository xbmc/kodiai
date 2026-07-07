import { describe, expect, test } from "bun:test";
import { ok } from "../lib/result.ts";
import { attemptSameRepoPrWrite } from "./mention-same-repo-write.ts";

function createLogger() {
  const infoCalls: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  const warnCalls: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  const errorCalls: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  return {
    logger: {
      info: (bindings: Record<string, unknown>, message: string) => {
        infoCalls.push({ bindings, message });
      },
      warn: (bindings: Record<string, unknown>, message: string) => {
        warnCalls.push({ bindings, message });
      },
      error: (bindings: Record<string, unknown>, message: string) => {
        errorCalls.push({ bindings, message });
      },
    },
    infoCalls,
    warnCalls,
    errorCalls,
  };
}

function baseParams(overrides: Partial<Parameters<typeof attemptSameRepoPrWrite>[0]> = {}) {
  const { logger } = createLogger();
  return {
    workspaceDir: "/tmp/kodiai-test-workspace",
    workspaceToken: "workspace-token",
    mention: {
      owner: "acme",
      repo: "widgets",
      issueNumber: 5,
      prNumber: 7,
      issueTitle: "Fix widgets",
      commentId: 42,
      headRef: "feature/widgets",
    },
    sameRepoHead: true,
    sourcePrUrl: "https://github.com/acme/widgets/pull/7",
    writeOutputKey: "delivery:acme/widgets#7:42",
    writeBranchName: "kodiai/write/acme-widgets-7",
    writeRequest: "fix the widget",
    deliveryId: "delivery-1",
    installationId: 123,
    triggerCommentUrl: "https://github.com/acme/widgets/pull/7#issuecomment-42",
    allowPaths: [],
    denyPaths: [],
    secretScanEnabled: true,
    retryCommand: "apply:",
    logger: logger as never,
    postMentionReply: async () => undefined,
    maybeReplyWritePermissionFailure: async () => ok({ status: "not-applicable" }),
    checkoutPrHead: async () => undefined,
    remoteHeadContainsMarker: async () => false,
    commitAndPushToRemoteRef: async () => ({ headSha: "abc123" }),
    pushHeadToRemoteRef: async () => undefined,
    ...overrides,
  } satisfies Parameters<typeof attemptSameRepoPrWrite>[0];
}

describe("attemptSameRepoPrWrite", () => {
  test("posts already-applied reply when the PR head already has the write marker", async () => {
    const replies: string[] = [];
    let commitCalls = 0;
    const result = await attemptSameRepoPrWrite(baseParams({
      postMentionReply: async (body) => {
        replies.push(body);
      },
      remoteHeadContainsMarker: async () => true,
      commitAndPushToRemoteRef: async () => {
        commitCalls += 1;
        return { headSha: "should-not-push" };
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(commitCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Already applied");
    expect(replies[0]).toContain("https://github.com/acme/widgets/pull/7");
  });

  test("updates the PR head branch and posts a confirmation reply", async () => {
    const { logger, infoCalls } = createLogger();
    const replies: string[] = [];
    const operations: string[] = [];

    const result = await attemptSameRepoPrWrite(baseParams({
      logger: logger as never,
      postMentionReply: async (body) => {
        replies.push(body);
      },
      checkoutPrHead: async ({ branch }) => {
        operations.push(`checkout:${branch}`);
      },
      commitAndPushToRemoteRef: async ({ remoteRef, commitMessage }) => {
        operations.push(`push:${remoteRef}`);
        expect(commitMessage).toContain("kodiai-write-output-key: delivery:acme/widgets#7:42");
        return { headSha: "updated-sha" };
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(operations).toEqual(["checkout:feature/widgets", "push:feature/widgets"]);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Updated PR: https://github.com/acme/widgets/pull/7");
    expect(
      infoCalls.some((entry) => entry.message === "Evidence bundle" && entry.bindings.outcome === "updated-pr-branch"),
    ).toBeTrue();
  });

  test("treats a failed push as handled when a later marker lookup sees the write commit", async () => {
    const replies: string[] = [];
    let markerLookups = 0;
    let fallbackPushCalls = 0;

    const result = await attemptSameRepoPrWrite(baseParams({
      postMentionReply: async (body) => {
        replies.push(body);
      },
      remoteHeadContainsMarker: async () => {
        markerLookups += 1;
        return markerLookups > 1;
      },
      commitAndPushToRemoteRef: async () => {
        throw new Error("non-fast-forward");
      },
      pushHeadToRemoteRef: async () => {
        fallbackPushCalls += 1;
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(markerLookups).toBe(2);
    expect(fallbackPushCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Already applied");
  });

  test("falls through to bot PR creation after pushing fallback branch", async () => {
    const operations: string[] = [];

    const result = await attemptSameRepoPrWrite(baseParams({
      commitAndPushToRemoteRef: async () => {
        throw new Error("push failed");
      },
      pushHeadToRemoteRef: async ({ remoteRef }) => {
        operations.push(`fallback:${remoteRef}`);
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "fall-through" } });
    expect(operations).toEqual(["fallback:kodiai/write/acme-widgets-7"]);
  });
});
