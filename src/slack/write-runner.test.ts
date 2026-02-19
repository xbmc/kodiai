import { describe, expect, test } from "bun:test";
import { createSlackWriteRunner } from "./write-runner.ts";
import { WritePolicyError } from "../jobs/workspace.ts";

describe("createSlackWriteRunner", () => {
  test("returns success with PR URL and mirrored comment metadata", async () => {
    const executeCalls: Array<Record<string, unknown>> = [];
    const prCalls: Array<Record<string, unknown>> = [];
    const commitCalls: Array<Record<string, unknown>> = [];

    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => ({ installationId: 42, defaultBranch: "main" }),
      createWorkspace: async () => ({
        dir: "/tmp/slack-write-runner",
        cleanup: async () => undefined,
      }),
      loadRepoConfig: async () => ({
        config: {
          write: {
            enabled: true,
            allowPaths: ["src/**"],
            denyPaths: [],
            secretScan: { enabled: true },
          },
        } as never,
        warnings: [],
      }),
      execute: async (input) => {
        executeCalls.push(input as unknown as Record<string, unknown>);
        return {
          conclusion: "success",
          costUsd: 0,
          numTurns: 1,
          durationMs: 100,
          sessionId: "session-1",
          published: true,
          errorMessage: undefined,
          model: "test-model",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          resultText: "Applied changes",
          publishEvents: [
            {
              type: "comment",
              url: "https://github.com/xbmc/xbmc/issues/12#issuecomment-99",
              excerpt: "Posted follow-up comment",
            },
          ],
        };
      },
      commitBranchAndPush: async (input) => {
        commitCalls.push(input as unknown as Record<string, unknown>);
        return { branchName: "kodiai/slack/apply-abc123", headSha: "deadbeef" };
      },
      createPullRequest: async (input) => {
        prCalls.push(input as unknown as Record<string, unknown>);
        return { htmlUrl: "https://github.com/xbmc/xbmc/pull/321" };
      },
    });

    const result = await runner.run({
      owner: "xbmc",
      repo: "xbmc",
      channel: "C123",
      threadTs: "1700000000.000111",
      messageTs: "1700000000.000222",
      prompt: "apply update",
      request: "update src/file.ts",
      keyword: "apply",
    });

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") throw new Error("expected success");

    expect(result.prUrl).toBe("https://github.com/xbmc/xbmc/pull/321");
    expect(result.responseText).toContain("Opened PR: https://github.com/xbmc/xbmc/pull/321");
    expect(result.responseText).toContain("Mirrored GitHub comments:");
    expect(result.responseText).toContain("https://github.com/xbmc/xbmc/issues/12#issuecomment-99");
    expect(result.mirrors).toEqual([
      {
        url: "https://github.com/xbmc/xbmc/issues/12#issuecomment-99",
        excerpt: "Posted follow-up comment",
      },
    ]);

    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0]).toMatchObject({
      owner: "xbmc",
      repo: "xbmc",
      installationId: 42,
      triggerBody: "update src/file.ts",
    });
    expect(commitCalls).toHaveLength(1);
    expect(prCalls).toHaveLength(1);
    expect(prCalls[0]).toMatchObject({ base: "main", owner: "xbmc", repo: "xbmc" });
  });

  test("returns policy refusal with exact retry command", async () => {
    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => ({ installationId: 1, defaultBranch: "main" }),
      createWorkspace: async () => ({
        dir: "/tmp/slack-write-runner",
        cleanup: async () => undefined,
      }),
      loadRepoConfig: async () => ({
        config: {
          write: {
            enabled: true,
            allowPaths: ["src/**"],
            denyPaths: [],
            secretScan: { enabled: true },
          },
        } as never,
        warnings: [],
      }),
      execute: async () => ({
        conclusion: "success",
        costUsd: 0,
        numTurns: 1,
        durationMs: 1,
        sessionId: "session",
        published: false,
        errorMessage: undefined,
        model: "model",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        stopReason: "end_turn",
      }),
      commitBranchAndPush: async () => {
        throw new WritePolicyError("write-policy-not-allowed", "blocked", {
          path: "src/secret.ts",
          rule: "allowPaths",
        });
      },
      createPullRequest: async () => ({ htmlUrl: "https://github.com/xbmc/xbmc/pull/1" }),
    });

    const result = await runner.run({
      owner: "xbmc",
      repo: "xbmc",
      channel: "C1",
      threadTs: "170",
      messageTs: "170",
      prompt: "test",
      request: "change files",
      keyword: "change",
    });

    expect(result.outcome).toBe("refusal");
    if (result.outcome !== "refusal") throw new Error("expected refusal");

    expect(result.reason).toBe("policy");
    expect(result.responseText).toContain("Reason: write-policy-not-allowed");
    expect(result.responseText).toContain("Retry command: change: change files");
  });

  test("returns unsupported-repo refusal with retry command", async () => {
    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => null,
      createWorkspace: async () => ({
        dir: "/tmp/slack-write-runner",
        cleanup: async () => undefined,
      }),
      execute: async () => {
        throw new Error("should not execute");
      },
      createPullRequest: async () => ({ htmlUrl: "https://github.com/xbmc/xbmc/pull/1" }),
    });

    const result = await runner.run({
      owner: "kodiai",
      repo: "private-repo",
      channel: "C1",
      threadTs: "170",
      messageTs: "170",
      prompt: "test",
      request: "apply patch",
      keyword: "apply",
    });

    expect(result.outcome).toBe("refusal");
    if (result.outcome !== "refusal") throw new Error("expected refusal");

    expect(result.reason).toBe("unsupported_repo");
    expect(result.responseText).toContain("Repository kodiai/private-repo is not accessible");
    expect(result.responseText).toContain("Retry command: apply: apply patch");
  });
});
