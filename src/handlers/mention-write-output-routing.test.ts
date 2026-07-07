import { describe, expect, test } from "bun:test";
import { err, ok } from "../lib/result.ts";
import { routeMentionWriteOutput, routeMentionWriteOutputIfEnabled } from "./mention-write-output-routing.ts";
import type { MentionEvent } from "./mention-types.ts";

type RouteMentionWriteOutputParams = Parameters<typeof routeMentionWriteOutput>[0];

function createMention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "acme",
    repo: "widget",
    issueNumber: 42,
    prNumber: 42,
    commentId: 1001,
    commentBody: "@kodiai apply the fix",
    commentAuthor: "mona",
    commentCreatedAt: "2026-01-01T00:00:00Z",
    headRef: "feature",
    baseRef: "main",
    headRepoOwner: "acme",
    headRepoName: "widget",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Fix the widget",
    ...overrides,
  };
}

function createBaseParams(
  overrides: Partial<RouteMentionWriteOutputParams> = {},
): RouteMentionWriteOutputParams {
  const replies: string[] = [];

  const params: RouteMentionWriteOutputParams = {
    workspaceDir: "/tmp/kodiai-workspace",
    workspaceToken: "workspace-token",
    octokit: {
      rest: {
        pulls: {
          list: async () => ({ data: [] }),
        },
      },
    },
    mention: createMention(),
    forkContext: undefined,
    gistPublisher: undefined,
    writeKeyword: "apply",
    writeBranchName: "kodiai/write-42",
    writeOutputKey: "write-key",
    writeRequest: "apply the fix",
    triggerCommentUrl: "https://github.com/acme/widget/pull/42#issuecomment-1001",
    deliveryId: "delivery-1",
    installationId: 123,
    cloneRef: "main",
    allowPaths: [],
    denyPaths: [],
    secretScanEnabled: true,
    retryCommand: "@kodiai apply the fix",
    isIssueThreadComment: false,
    botHandles: ["kodiai", "claude"],
    logger: {
      warn: () => undefined,
      info: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as never,
    postMentionReply: async (body) => {
      replies.push(body);
    },
    maybeReplyWritePermissionFailure: async () => ok({ status: "not-applicable" }),
    recordWriteRateLimitSuccess: () => undefined,
    getGitStatusPorcelain: async () => " M src/file.ts\n",
    publishMentionForkWriteOutput: async () => ok({ status: "fall-through" }),
    attemptSameRepoPrWrite: async () => ok({ status: "fall-through" }),
    publishMentionBotWritePullRequest: async () => ok({ status: "handled" }),
  };

  return { ...params, ...overrides };
}

describe("routeMentionWriteOutput", () => {
  test("posts no-file-changes reply without attempting publication when workspace is clean", async () => {
    let forkCalls = 0;
    let sameRepoCalls = 0;
    let botPrCalls = 0;
    const replies: string[] = [];

    const result = await routeMentionWriteOutput(createBaseParams({
      postMentionReply: async (body) => {
        replies.push(body);
      },
      getGitStatusPorcelain: async () => "  \n",
      publishMentionForkWriteOutput: async () => {
        forkCalls += 1;
        return ok({ status: "fall-through" });
      },
      attemptSameRepoPrWrite: async () => {
        sameRepoCalls += 1;
        return ok({ status: "fall-through" });
      },
      publishMentionBotWritePullRequest: async () => {
        botPrCalls += 1;
        return ok({ status: "handled" });
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("I didn't end up making any file changes.");
    expect(forkCalls).toBe(0);
    expect(sameRepoCalls).toBe(0);
    expect(botPrCalls).toBe(0);
  });

  test("stops after fork write output handles publication", async () => {
    let sameRepoCalls = 0;
    let botPrCalls = 0;

    const result = await routeMentionWriteOutput(createBaseParams({
      publishMentionForkWriteOutput: async (params) => {
        expect(params.writeOutputKey).toBe("write-key");
        return ok({ status: "handled" });
      },
      attemptSameRepoPrWrite: async () => {
        sameRepoCalls += 1;
        return ok({ status: "fall-through" });
      },
      publishMentionBotWritePullRequest: async () => {
        botPrCalls += 1;
        return ok({ status: "handled" });
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(sameRepoCalls).toBe(0);
    expect(botPrCalls).toBe(0);
  });

  test("stops after same-repo PR write handles publication", async () => {
    let botPrCalls = 0;

    const result = await routeMentionWriteOutput(createBaseParams({
      publishMentionForkWriteOutput: async () => ok({ status: "fall-through" }),
      attemptSameRepoPrWrite: async (params) => {
        expect(params.sameRepoHead).toBe(true);
        expect(params.sourcePrUrl).toBe("https://github.com/acme/widget/pull/42");
        return ok({ status: "handled" });
      },
      publishMentionBotWritePullRequest: async () => {
        botPrCalls += 1;
        return ok({ status: "handled" });
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(botPrCalls).toBe(0);
  });

  test("falls through to bot PR publication when fork and same-repo paths do not handle", async () => {
    let botPrCalls = 0;

    const result = await routeMentionWriteOutput(createBaseParams({
      publishMentionForkWriteOutput: async () => ok({ status: "fall-through" }),
      attemptSameRepoPrWrite: async () => ok({ status: "not-applicable" }),
      publishMentionBotWritePullRequest: async (params) => {
        botPrCalls += 1;
        expect(params.isIssueWritePublishFlow).toBe(false);
        expect(params.botHandles).toEqual(["kodiai", "claude"]);
        return ok({ status: "handled" });
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(botPrCalls).toBe(1);
  });

  test("propagates bot PR publication Result errors", async () => {
    const publicationError = new Error("bot PR publication failed");

    const result = await routeMentionWriteOutput(createBaseParams({
      publishMentionForkWriteOutput: async () => ok({ status: "fall-through" }),
      attemptSameRepoPrWrite: async () => ok({ status: "not-applicable" }),
      publishMentionBotWritePullRequest: async () => err(publicationError),
    }));

    expect(result).toEqual({ ok: false, err: publicationError });
  });
});

describe("routeMentionWriteOutputIfEnabled", () => {
  test("returns a skipped Result without routing when write output is not publishable", async () => {
    const routed = await routeMentionWriteOutputIfEnabled({
      workspace: {
        dir: "/tmp/kodiai-workspace",
        token: "workspace-token",
        cleanup: async () => undefined,
      },
      workspaceToken: "workspace-token",
      octokit: {
        rest: {
          pulls: {
            list: async () => ({ data: [] }),
          },
        },
      },
      mention: createMention(),
      forkContext: undefined,
      gistPublisher: undefined,
      writeContext: {
        writeEnabled: false,
        writeIntent: { writeIntent: false, keyword: undefined, request: "plan the fix" },
        writeBranchName: undefined,
        writeOutputKey: undefined,
        triggerCommentUrl: "https://github.com/acme/widget/pull/42#issuecomment-1001",
        retryCommand: "@kodiai plan the fix",
        isIssueThreadComment: false,
      },
      cloneRef: "main",
      writeConfig: {
        allowPaths: [],
        denyPaths: [],
        secretScan: { enabled: true },
      },
      deliveryId: "delivery-1",
      installationId: 123,
      appSlug: "kodiai",
      logger: {
        warn: () => undefined,
        info: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      } as never,
      postMentionReply: async () => {
        throw new Error("should not post");
      },
      maybeReplyWritePermissionFailure: async () => ok({ status: "not-applicable" }),
      writeRateLimit: {
        check: () => ({ allowed: true }),
        recordSuccess: () => {
          throw new Error("should not record");
        },
      },
    });

    expect(routed).toEqual({ ok: true, value: { routed: false } });
  });
});
