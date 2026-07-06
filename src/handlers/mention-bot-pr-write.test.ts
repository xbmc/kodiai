import { describe, expect, test } from "bun:test";
import { publishMentionBotWritePullRequest } from "./mention-bot-pr-write.ts";

function createLogger() {
  const infoCalls: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  const warnCalls: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  return {
    logger: {
      info: (bindings: Record<string, unknown>, message: string) => {
        infoCalls.push({ bindings, message });
      },
      warn: (bindings: Record<string, unknown>, message: string) => {
        warnCalls.push({ bindings, message });
      },
    },
    infoCalls,
    warnCalls,
  };
}

function baseParams(overrides: Partial<Parameters<typeof publishMentionBotWritePullRequest>[0]> = {}) {
  const { logger } = createLogger();
  return {
    workspaceDir: "/tmp/kodiai-test-workspace",
    workspaceToken: "workspace-token",
    octokit: {
      rest: {
        pulls: {
          list: async () => ({ data: [] }),
        },
      },
    },
    mention: {
      owner: "acme",
      repo: "widgets",
      issueNumber: 5,
      prNumber: undefined,
      baseRef: undefined,
      issueTitle: "Fix widgets",
      commentId: 42,
    },
    cloneRef: "main",
    writeBranchName: "kodiai/write/acme-widgets-5",
    writeOutputKey: "delivery:acme/widgets#5:42",
    writeRequest: "fix the widget",
    triggerCommentUrl: "https://github.com/acme/widgets/issues/5#issuecomment-42",
    deliveryId: "delivery-1",
    installationId: 123,
    allowPaths: [],
    denyPaths: [],
    secretScanEnabled: true,
    retryCommand: "apply:",
    isIssueWritePublishFlow: true,
    botHandles: ["kodiai", "claude", "kodai"],
    logger: logger as never,
    postMentionReply: async () => undefined,
    postIssueWriteFailure: async () => undefined,
    maybeReplyWritePermissionFailure: async () => false,
    createBranchCommitAndPush: async () => ({ branchName: "kodiai/write/acme-widgets-5", headSha: "abc123" }),
    buildMentionWritePullRequestDraft: async () => ({
      title: "Fix widgets",
      body: "PR body",
      sourceUrl: "https://github.com/acme/widgets/issues/5",
      diffStat: "",
      warnings: [],
    }),
    publishMentionWritePullRequest: async () => ({ data: { html_url: "https://github.com/acme/widgets/pull/9" } }),
    recordWriteRateLimitSuccess: () => undefined,
    ...overrides,
  } satisfies Parameters<typeof publishMentionBotWritePullRequest>[0];
}

describe("publishMentionBotWritePullRequest", () => {
  test("creates a bot branch PR, posts the success reply, and records rate-limit success", async () => {
    const { logger, infoCalls } = createLogger();
    const replies: string[] = [];
    const recorded: string[] = [];

    const result = await publishMentionBotWritePullRequest(baseParams({
      logger: logger as never,
      postMentionReply: async (body) => {
        replies.push(body);
      },
      recordWriteRateLimitSuccess: (owner, repo) => {
        recorded.push(`${owner}/${repo}`);
      },
    }));

    expect(result.status).toBe("handled");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("status: success");
    expect(replies[0]).toContain("pr_url: https://github.com/acme/widgets/pull/9");
    expect(recorded).toEqual(["acme/widgets"]);
    expect(
      infoCalls.some((entry) => entry.message === "Evidence bundle" && entry.bindings.outcome === "created-pr"),
    ).toBeTrue();
  });

  test("replies with an existing PR when branch push reports replay-style failure", async () => {
    const replies: string[] = [];
    const failures: string[] = [];

    const result = await publishMentionBotWritePullRequest(baseParams({
      postMentionReply: async (body) => {
        replies.push(body);
      },
      postIssueWriteFailure: async (step) => {
        failures.push(step);
      },
      octokit: {
        rest: {
          pulls: {
            list: async () => ({ data: [{ html_url: "https://github.com/acme/widgets/pull/8" }] }),
          },
        },
      },
      createBranchCommitAndPush: async () => {
        throw new Error("non-fast-forward");
      },
    }));

    expect(result.status).toBe("handled");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Existing PR: https://github.com/acme/widgets/pull/8");
    expect(failures).toEqual([]);
  });

  test("retries issue PR creation once before succeeding", async () => {
    const replies: string[] = [];
    let publishAttempts = 0;

    const result = await publishMentionBotWritePullRequest(baseParams({
      postMentionReply: async (body) => {
        replies.push(body);
      },
      publishMentionWritePullRequest: async () => {
        publishAttempts += 1;
        if (publishAttempts === 1) {
          throw new Error("transient create-pr failure");
        }
        return { data: { html_url: "https://github.com/acme/widgets/pull/10" } };
      },
    }));

    expect(result.status).toBe("handled");
    expect(publishAttempts).toBe(2);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("https://github.com/acme/widgets/pull/10");
  });

  test("reports issue-linkback failure without recording success", async () => {
    const failures: string[] = [];
    let recorded = false;

    const result = await publishMentionBotWritePullRequest(baseParams({
      postMentionReply: async () => {
        throw new Error("linkback failed");
      },
      postIssueWriteFailure: async (step) => {
        failures.push(step);
      },
      recordWriteRateLimitSuccess: () => {
        recorded = true;
      },
    }));

    expect(result.status).toBe("handled");
    expect(failures).toEqual(["issue-linkback"]);
    expect(recorded).toBeFalse();
  });
});
