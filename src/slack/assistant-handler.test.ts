import { describe, expect, test } from "bun:test";
import {
  createSlackAssistantHandler,
  type SlackAssistantAddressedPayload,
  type SlackAssistantExecutorInput,
} from "./assistant-handler.ts";

function createAddressedPayload(text: string): SlackAssistantAddressedPayload {
  return {
    channel: "C123KODIAI",
    threadTs: "1700000000.000777",
    user: "U123USER",
    text,
    replyTarget: "thread-only",
  };
}

describe("createSlackAssistantHandler", () => {
  test("routes to default xbmc/xbmc and enforces read-only executor contract", async () => {
    const executionInputs: SlackAssistantExecutorInput[] = [];
    const published: string[] = [];

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
    });

    const result = await handler.handle(createAddressedPayload("Explain the retry behavior."));

    expect(result).toEqual({
      outcome: "answered",
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
    expect(executionInputs[0]?.prompt).toContain("Do not create branches, commits, pull requests");
    expect(executionInputs[0]?.prompt).toContain("Do not run CI/build commands");
    expect(published).toEqual(["Here is the read-only answer."]);
  });

  test("prepends explicit override acknowledgement before assistant answer", async () => {
    const published: string[] = [];
    const executionInputs: SlackAssistantExecutorInput[] = [];

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
    });

    const result = await handler.handle(
      createAddressedPayload("Use Kodiai/xbmc-test and summarize open reliability work."),
    );

    expect(result).toEqual({
      outcome: "answered",
      repo: "kodiai/xbmc-test",
      publishedText: "Using repo context kodiai/xbmc-test.\n\nI checked that repository context.",
    });
    expect(executionInputs).toHaveLength(1);
    expect(executionInputs[0]).toMatchObject({ owner: "kodiai", repo: "xbmc-test" });
    expect(published).toEqual([
      "Using repo context kodiai/xbmc-test.\n\nI checked that repository context.",
    ]);
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
