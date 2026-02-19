import { describe, expect, test } from "bun:test";
import {
  createSlackAssistantHandler,
  type SlackAssistantAddressedPayload,
  type SlackAssistantExecutorInput,
} from "./assistant-handler.ts";
import { SLACK_WRITE_CONFIRMATION_TIMEOUT_MS } from "./write-intent.ts";

function createAddressedPayload(text: string): SlackAssistantAddressedPayload {
  return {
    channel: "C123KODIAI",
    threadTs: "1700000000.000777",
    messageTs: "1700000000.000777",
    user: "U123USER",
    text,
    replyTarget: "thread-only",
  };
}

describe("createSlackAssistantHandler", () => {
  test("responds instantly to ping-like messages without workspace or executor", async () => {
    const published: string[] = [];
    let workspaceCalls = 0;
    let executionCalls = 0;
    const reactions: string[] = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => {
        workspaceCalls += 1;
        return {
          dir: "/tmp/workspace",
          cleanup: async () => undefined,
        };
      },
      execute: async () => {
        executionCalls += 1;
        return { answerText: "should never run" };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
      addWorkingReaction: async ({ channel, messageTs }) => {
        reactions.push(`add:${channel}:${messageTs}`);
      },
      removeWorkingReaction: async ({ channel, messageTs }) => {
        reactions.push(`remove:${channel}:${messageTs}`);
      },
    });

    const result = await handler.handle(createAddressedPayload("<@U123BOT> ping"));

    expect(result).toEqual({
      outcome: "answered",
      route: "read_only",
      repo: "xbmc/xbmc",
      publishedText: "Pong! I am here. Ask me anything about xbmc/xbmc and I will answer in read-only mode.",
    });
    expect(workspaceCalls).toBe(0);
    expect(executionCalls).toBe(0);
    expect(reactions).toEqual([
      "add:C123KODIAI:1700000000.000777",
      "remove:C123KODIAI:1700000000.000777",
    ]);
    expect(published).toEqual([
      "Pong! I am here. Ask me anything about xbmc/xbmc and I will answer in read-only mode.",
    ]);
  });

  test("routes to default xbmc/xbmc and enforces read-only executor contract", async () => {
    const executionInputs: SlackAssistantExecutorInput[] = [];
    const published: string[] = [];
    const reactions: string[] = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async (input) => {
        executionInputs.push(input);
        return { answerText: "Here is the read-only answer." };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
      addWorkingReaction: async ({ channel, messageTs }) => {
        reactions.push(`add:${channel}:${messageTs}`);
      },
      removeWorkingReaction: async ({ channel, messageTs }) => {
        reactions.push(`remove:${channel}:${messageTs}`);
      },
    });

    const result = await handler.handle(createAddressedPayload("Explain the retry behavior."));

    expect(result).toEqual({
      outcome: "answered",
      route: "read_only",
      repo: "xbmc/xbmc",
      publishedText: "Here is the read-only answer.",
    });

    expect(executionInputs).toHaveLength(1);
    expect(executionInputs[0]).toMatchObject({
      owner: "xbmc",
      repo: "xbmc",
      writeMode: false,
      enableInlineTools: false,
      enableCommentTools: false,
      eventType: "slack.message",
      triggerBody: "Explain the retry behavior.",
    });
    expect(executionInputs[0]?.prompt).toContain("Repository context: xbmc/xbmc");
    expect(executionInputs[0]?.prompt).toContain("Slack response style:");
    expect(executionInputs[0]?.prompt).toContain("Lead with the direct answer in the first sentence.");
    expect(executionInputs[0]?.prompt).toContain("Do not create branches, commits, pull requests");
    expect(executionInputs[0]?.prompt).toContain("Do not run CI/build commands");
    expect(reactions).toEqual([
      "add:C123KODIAI:1700000000.000777",
      "remove:C123KODIAI:1700000000.000777",
    ]);
    expect(published).toEqual(["Here is the read-only answer."]);
  });

  test("prepends explicit override acknowledgement before assistant answer", async () => {
    const published: string[] = [];
    const executionInputs: SlackAssistantExecutorInput[] = [];
    const reactions: string[] = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async (input) => {
        executionInputs.push(input);
        return { answerText: "I checked that repository context." };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
      addWorkingReaction: async ({ channel, messageTs }) => {
        reactions.push(`add:${channel}:${messageTs}`);
      },
      removeWorkingReaction: async ({ channel, messageTs }) => {
        reactions.push(`remove:${channel}:${messageTs}`);
      },
    });

    const result = await handler.handle(
      createAddressedPayload("Use Kodiai/xbmc-test and summarize open reliability work."),
    );

    expect(result).toEqual({
      outcome: "answered",
      route: "read_only",
      repo: "kodiai/xbmc-test",
      publishedText: "Using repo context kodiai/xbmc-test.\n\nI checked that repository context.",
    });
    expect(executionInputs).toHaveLength(1);
    expect(executionInputs[0]).toMatchObject({ owner: "kodiai", repo: "xbmc-test" });
    expect(reactions).toEqual([
      "add:C123KODIAI:1700000000.000777",
      "remove:C123KODIAI:1700000000.000777",
    ]);
    expect(published).toEqual(["Using repo context kodiai/xbmc-test.\n\nI checked that repository context."]);
  });

  test("routes explicit apply: prefix to write-capable executor path", async () => {
    const executionInputs: SlackAssistantExecutorInput[] = [];
    const published: string[] = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async (input) => {
        executionInputs.push(input);
        return { answerText: "Applied the requested update." };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
    });

    const result = await handler.handle(createAddressedPayload("apply: update src/slack/assistant-handler.ts"));

    expect(result).toEqual({
      outcome: "answered",
      route: "write",
      repo: "xbmc/xbmc",
      publishedText: "Applied the requested update.",
    });
    expect(executionInputs).toHaveLength(1);
    expect(executionInputs[0]).toMatchObject({
      writeMode: true,
      enableInlineTools: true,
      enableCommentTools: true,
      triggerBody: "update src/slack/assistant-handler.ts",
    });
    expect(executionInputs[0]?.prompt).toContain("Write-capable execution requirements:");
    expect(executionInputs[0]?.prompt).not.toContain("Read-only execution requirements:");
    expect(published).toEqual(["Applied the requested update."]);
  });

  test("routes medium-confidence conversational write ask to write-capable execution", async () => {
    const executionInputs: SlackAssistantExecutorInput[] = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async (input) => {
        executionInputs.push(input);
        return { answerText: "Done." };
      },
      publishInThread: async () => undefined,
    });

    const result = await handler.handle(
      createAddressedPayload("Can you update src/slack/assistant-handler.ts and open a PR?"),
    );

    expect(result).toEqual({
      outcome: "answered",
      route: "write",
      repo: "xbmc/xbmc",
      publishedText: "Done.",
    });
    expect(executionInputs).toHaveLength(1);
    expect(executionInputs[0]).toMatchObject({
      writeMode: true,
      triggerBody: "Can you update src/slack/assistant-handler.ts and open a PR?",
    });
  });

  test("uses write runner output and publishes primary PR link on success", async () => {
    const published: string[] = [];
    const runWriteCalls: Array<Record<string, unknown>> = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async () => ({ answerText: "should not run" }),
      runWrite: async (input) => {
        runWriteCalls.push(input as unknown as Record<string, unknown>);
        return {
          outcome: "success",
          prUrl: "https://github.com/xbmc/xbmc/pull/123",
          responseText: "Opened PR: https://github.com/xbmc/xbmc/pull/123",
          retryCommand: "apply: update src/slack/assistant-handler.ts",
          mirrors: [],
        };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
    });

    const result = await handler.handle(createAddressedPayload("apply: update src/slack/assistant-handler.ts"));

    expect(result).toEqual({
      outcome: "answered",
      route: "write",
      repo: "xbmc/xbmc",
      publishedText:
        "Write run complete.\n"
        + "- Changed: update src/slack/assistant-handler.ts\n"
        + "- Where: xbmc/xbmc\n"
        + "PR: https://github.com/xbmc/xbmc/pull/123",
    });
    expect(runWriteCalls).toHaveLength(1);
    expect(runWriteCalls[0]).toMatchObject({
      owner: "xbmc",
      repo: "xbmc",
      request: "update src/slack/assistant-handler.ts",
      keyword: "apply",
    });
    expect(published).toEqual([
      "Write run started for xbmc/xbmc.",
      "Milestone: running write execution and preparing PR output.",
      "Write run complete.\n"
        + "- Changed: update src/slack/assistant-handler.ts\n"
        + "- Where: xbmc/xbmc\n"
        + "PR: https://github.com/xbmc/xbmc/pull/123",
    ]);
  });

  test("mirrors comment link and excerpt when write runner reports comment publish", async () => {
    const published: string[] = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async () => ({ answerText: "should not run" }),
      runWrite: async () => ({
        outcome: "success",
        prUrl: "https://github.com/xbmc/xbmc/pull/124",
        responseText: "ignored by formatter",
        retryCommand: "apply: update issue note",
        mirrors: [
          {
            url: "https://github.com/xbmc/xbmc/issues/1#issuecomment-10",
            excerpt: "Updated issue comment excerpt",
          },
        ],
      }),
      publishInThread: async ({ text }) => {
        published.push(text);
      },
    });

    const result = await handler.handle(createAddressedPayload("apply: update issue note"));

    expect(result.outcome).toBe("answered");
    if (result.outcome !== "answered") {
      throw new Error("expected answered result");
    }
    expect(result.publishedText).toContain("PR: https://github.com/xbmc/xbmc/pull/124");
    expect(result.publishedText).toContain("https://github.com/xbmc/xbmc/issues/1#issuecomment-10");
    expect(result.publishedText).toContain("Updated issue comment excerpt");
    expect(published).toHaveLength(3);
  });

  test("publishes deterministic refusal with retry command from write runner", async () => {
    const published: string[] = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async () => ({ answerText: "should not run" }),
      runWrite: async () => ({
        outcome: "refusal",
        reason: "policy",
        responseText:
          "Write request refused.\nReason: write-policy-not-allowed\nRetry command: apply: update src/slack/assistant-handler.ts",
        retryCommand: "apply: update src/slack/assistant-handler.ts",
      }),
      publishInThread: async ({ text }) => {
        published.push(text);
      },
    });

    const result = await handler.handle(createAddressedPayload("apply: update src/slack/assistant-handler.ts"));

    expect(result).toEqual({
      outcome: "answered",
      route: "write",
      repo: "xbmc/xbmc",
      publishedText:
        "Write request refused.\nReason: write-policy-not-allowed\nRetry command: apply: update src/slack/assistant-handler.ts",
    });
    expect(published).toEqual([
      "Write run started for xbmc/xbmc.",
      "Milestone: running write execution and preparing PR output.",
      "Write request refused.\nReason: write-policy-not-allowed\nRetry command: apply: update src/slack/assistant-handler.ts",
    ]);
  });

  test("ambiguous conversational write intent stays read-only and publishes exact rerun command", async () => {
    let workspaceCalls = 0;
    let executionCalls = 0;
    const published: string[] = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => {
        workspaceCalls += 1;
        return {
          dir: "/tmp/workspace",
          cleanup: async () => undefined,
        };
      },
      execute: async () => {
        executionCalls += 1;
        return { answerText: "should never run" };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
    });

    const result = await handler.handle(createAddressedPayload("Could you maybe change this when you can?"));

    expect(result).toEqual({
      outcome: "clarification_required",
      question:
        "I kept this run read-only because your request may involve repository changes, but write intent is ambiguous.\n" +
        "If you want write mode, rerun with exactly one of:\n" +
        "- apply: Could you maybe change this when you can?\n" +
        "- change: Could you maybe change this when you can?",
    });
    expect(workspaceCalls).toBe(0);
    expect(executionCalls).toBe(0);
    expect(published).toEqual([
      "I kept this run read-only because your request may involve repository changes, but write intent is ambiguous.\n" +
        "If you want write mode, rerun with exactly one of:\n" +
        "- apply: Could you maybe change this when you can?\n" +
        "- change: Could you maybe change this when you can?",
    ]);
  });

  test("high-impact write asks are flagged as confirmation_required before execution", async () => {
    let executionCalls = 0;
    const published: string[] = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async () => {
        executionCalls += 1;
        return { answerText: "should never run" };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
    });

    const result = await handler.handle(
      createAddressedPayload("Please delete old auth files across the entire repo and migrate secrets"),
    );

    expect(result).toEqual({
      outcome: "confirmation_required",
      question:
        "This looks like a high-impact write request, so I did not execute it yet.\n" +
        "Reply in this thread with the command below prefixed by `confirm:` to proceed:\n" +
        "- apply: Please delete old auth files across the entire repo and migrate secrets\n\n" +
        "Confirmation timeout: 15 minutes (request stays pending if not confirmed).",
      confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
    });
    expect(executionCalls).toBe(0);
    expect(published).toEqual([
      "This looks like a high-impact write request, so I did not execute it yet.\n" +
        "Reply in this thread with the command below prefixed by `confirm:` to proceed:\n" +
        "- apply: Please delete old auth files across the entire repo and migrate secrets\n\n" +
        "Confirmation timeout: 15 minutes (request stays pending if not confirmed).",
    ]);
  });

  test("keeps high-impact request pending until exact in-thread confirmation", async () => {
    const published: string[] = [];
    let runWriteCalls = 0;

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async () => ({ answerText: "should not run" }),
      runWrite: async () => {
        runWriteCalls += 1;
        return {
          outcome: "success",
          prUrl: "https://github.com/xbmc/xbmc/pull/400",
          responseText: "Opened PR: https://github.com/xbmc/xbmc/pull/400",
          retryCommand: "apply: update src/slack/assistant-handler.ts",
          mirrors: [],
        };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
    });

    await handler.handle(
      createAddressedPayload("Please delete old auth files across the entire repo and migrate secrets"),
    );

    const result = await handler.handle(createAddressedPayload("status?"));

    expect(result).toEqual({
      outcome: "confirmation_required",
      question:
        "This write request is still pending confirmation.\n" +
        "Reply with this exact command to continue:\n" +
        "- confirm: apply: Please delete old auth files across the entire repo and migrate secrets",
      confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
    });
    expect(runWriteCalls).toBe(0);
    expect(published[published.length - 1]).toBe(
      "This write request is still pending confirmation.\n"
        + "Reply with this exact command to continue:\n"
        + "- confirm: apply: Please delete old auth files across the entire repo and migrate secrets",
    );
  });

  test("resumes deterministic high-impact run after exact confirmation command", async () => {
    const published: string[] = [];
    const runWriteCalls: Array<Record<string, unknown>> = [];

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => ({
        dir: "/tmp/workspace",
        cleanup: async () => undefined,
      }),
      execute: async () => ({ answerText: "should not run" }),
      runWrite: async (input) => {
        runWriteCalls.push(input as unknown as Record<string, unknown>);
        return {
          outcome: "success",
          prUrl: "https://github.com/xbmc/xbmc/pull/401",
          responseText: "Opened PR: https://github.com/xbmc/xbmc/pull/401",
          retryCommand: "apply: Please delete old auth files across the entire repo and migrate secrets",
          mirrors: [],
        };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
    });

    await handler.handle(
      createAddressedPayload("Please delete old auth files across the entire repo and migrate secrets"),
    );

    const result = await handler.handle(
      createAddressedPayload("confirm: apply: Please delete old auth files across the entire repo and migrate secrets"),
    );

    expect(result).toEqual({
      outcome: "answered",
      route: "write",
      repo: "xbmc/xbmc",
      publishedText:
        "Write run complete.\n"
        + "- Changed: Please delete old auth files across the entire repo and migrate secrets\n"
        + "- Where: xbmc/xbmc\n"
        + "PR: https://github.com/xbmc/xbmc/pull/401",
    });
    expect(runWriteCalls).toHaveLength(1);
    expect(runWriteCalls[0]).toMatchObject({
      owner: "xbmc",
      repo: "xbmc",
      request: "Please delete old auth files across the entire repo and migrate secrets",
      keyword: "apply",
    });
    expect(published[published.length - 1]).toBe(
      "Write run complete.\n"
        + "- Changed: Please delete old auth files across the entire repo and migrate secrets\n"
        + "- Where: xbmc/xbmc\n"
        + "PR: https://github.com/xbmc/xbmc/pull/401",
    );
  });

  test("publishes exactly one clarifying question for ambiguous context and skips execution", async () => {
    const published: string[] = [];
    let workspaceCalls = 0;
    let executionCalls = 0;

    const handler = createSlackAssistantHandler({
      createWorkspace: async () => {
        workspaceCalls += 1;
        return {
          dir: "/tmp/workspace",
          cleanup: async () => undefined,
        };
      },
      execute: async () => {
        executionCalls += 1;
        return { answerText: "should never run" };
      },
      publishInThread: async ({ text }) => {
        published.push(text);
      },
    });

    const result = await handler.handle(
      createAddressedPayload("Compare xbmc/xbmc and kodiai/xbmc-test please."),
    );

    expect(result).toEqual({
      outcome: "clarification_required",
      question:
        "I could not determine a single repo context. Which repo should I use? Please reply with owner/repo.",
    });
    expect(workspaceCalls).toBe(0);
    expect(executionCalls).toBe(0);
    expect(published).toEqual([
      "I could not determine a single repo context. Which repo should I use? Please reply with owner/repo.",
    ]);
  });
});
