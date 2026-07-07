import { describe, expect, test } from "bun:test";
import { ok } from "../lib/result.ts";
import { publishMentionForkWriteOutput } from "./mention-fork-write-output.ts";

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

function baseParams(overrides: Partial<Parameters<typeof publishMentionForkWriteOutput>[0]> = {}) {
  const { logger } = createLogger();
  return {
    workspaceDir: "/tmp/kodiai-test-workspace",
    octokit: {},
    mention: {
      owner: "acme",
      repo: "widgets",
      issueNumber: 5,
      prNumber: undefined,
      baseRef: undefined,
      issueTitle: "Fix widgets",
    },
    forkContext: { forkOwner: "acme-bot", forkRepo: "widgets", botPat: "bot-pat" },
    gistPublisher: {
      enabled: true,
      createPatchGist: async () => ({ htmlUrl: "https://gist.github.com/acme/patch", id: "gist-1" }),
    },
    writeKeyword: "apply",
    writeBranchName: "kodiai/write/acme-widgets-5",
    writeOutputKey: "delivery:acme/widgets#5:42",
    writeRequest: "fix the widget",
    triggerCommentUrl: "https://github.com/acme/widgets/issues/5#issuecomment-42",
    deliveryId: "delivery-1",
    installationId: 123,
    cloneRef: "main",
    allowPaths: [],
    denyPaths: [],
    secretScanEnabled: true,
    botHandles: ["kodiai", "claude", "kodai"],
    logger: logger as never,
    postMentionReply: async () => undefined,
    collectWorkspaceChangedFiles: async () => ["README.md"],
    shouldUseGist: () => true,
    buildStagedPatchForGist: async () => ({ stdout: "diff --git a/README.md b/README.md\n", stdoutTruncated: false }),
    assertOriginIsFork: async () => undefined,
    createBranchCommitAndPush: async () => ({ branchName: "kodiai/write/acme-widgets-5", headSha: "abc123" }),
    buildMentionWritePullRequestDraft: async () => ({
      title: "Fix widgets",
      body: "PR body",
      sourceUrl: "https://github.com/acme/widgets/issues/5",
      diffStat: "",
      warnings: [],
    }),
    publishMentionWritePullRequest: async () => ok({ data: { html_url: "https://github.com/acme/widgets/pull/9" } }),
    recordWriteRateLimitSuccess: () => undefined,
    ...overrides,
  } satisfies Parameters<typeof publishMentionForkWriteOutput>[0];
}

describe("publishMentionForkWriteOutput", () => {
  test("publishes a gist when gist routing wins", async () => {
    const { logger, infoCalls } = createLogger();
    const replies: string[] = [];
    const recorded: string[] = [];

    const result = await publishMentionForkWriteOutput(baseParams({
      logger: logger as never,
      postMentionReply: async (body) => {
        replies.push(body);
      },
      recordWriteRateLimitSuccess: (owner, repo) => {
        recorded.push(`${owner}/${repo}`);
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Patch gist: https://gist.github.com/acme/patch");
    expect(replies[0]).toContain("Files changed: README.md");
    expect(recorded).toEqual(["acme/widgets"]);
    expect(
      infoCalls.some((entry) => entry.message === "Evidence bundle" && entry.bindings.outcome === "created-gist"),
    ).toBeTrue();
  });

  test("creates a cross-fork PR when gist routing does not win", async () => {
    const { logger, infoCalls } = createLogger();
    const replies: string[] = [];
    let assertedForkOwner: string | undefined;
    let publishedHead: string | undefined;

    const result = await publishMentionForkWriteOutput(baseParams({
      logger: logger as never,
      shouldUseGist: () => false,
      assertOriginIsFork: async (_workspaceDir, forkOwner) => {
        assertedForkOwner = forkOwner;
      },
      publishMentionWritePullRequest: async ({ head }) => {
        publishedHead = head;
        return ok({ data: { html_url: "https://github.com/acme/widgets/pull/11" } });
      },
      postMentionReply: async (body) => {
        replies.push(body);
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(assertedForkOwner).toBe("acme-bot");
    expect(publishedHead).toBe("acme-bot:kodiai/write/acme-widgets-5");
    expect(replies[0]).toContain("Opened PR: https://github.com/acme/widgets/pull/11");
    expect(
      infoCalls.some((entry) => entry.message === "Evidence bundle" && entry.bindings.outcome === "created-cross-fork-pr"),
    ).toBeTrue();
  });

  test("falls back to a gist when fork PR creation fails", async () => {
    const replies: string[] = [];
    const result = await publishMentionForkWriteOutput(baseParams({
      shouldUseGist: () => false,
      assertOriginIsFork: async () => {
        throw new Error("origin is not fork");
      },
      postMentionReply: async (body) => {
        replies.push(body);
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "handled" } });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Could not create a PR from the fork");
    expect(replies[0]).toContain("https://gist.github.com/acme/patch");
  });

  test("falls through when fork PR and fallback gist both fail", async () => {
    const { logger, warnCalls } = createLogger();
    const result = await publishMentionForkWriteOutput(baseParams({
      logger: logger as never,
      shouldUseGist: () => false,
      assertOriginIsFork: async () => {
        throw new Error("origin is not fork");
      },
      buildStagedPatchForGist: async () => {
        throw new Error("patch unavailable");
      },
    }));

    expect(result).toEqual({ ok: true, value: { status: "fall-through" } });
    expect(
      warnCalls.some((entry) => entry.message === "Fork-based write mode failed completely; falling through to legacy direct-push path"),
    ).toBeTrue();
  });
});
