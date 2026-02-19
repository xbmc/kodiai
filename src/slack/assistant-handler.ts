import type { Workspace } from "../jobs/types.ts";
import { resolveSlackRepoContext } from "./repo-context.ts";
import {
  resolveSlackWriteIntent,
  SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
  type SlackWriteKeyword,
} from "./write-intent.ts";

export interface SlackAssistantAddressedPayload {
  channel: string;
  threadTs: string;
  messageTs: string;
  user: string;
  text: string;
  replyTarget: "thread-only";
}

export interface SlackAssistantWorkspaceInput {
  owner: string;
  repo: string;
}

export interface SlackAssistantExecutorInput {
  workspace: Workspace;
  owner: string;
  repo: string;
  writeMode: boolean;
  enableInlineTools: boolean;
  enableCommentTools: boolean;
  eventType: "slack.message";
  triggerBody: string;
  prompt: string;
}

export interface SlackAssistantExecutionResult {
  answerText: string;
}

interface SlackAssistantHandlerDeps {
  createWorkspace: (input: SlackAssistantWorkspaceInput) => Promise<Workspace>;
  execute: (input: SlackAssistantExecutorInput) => Promise<SlackAssistantExecutionResult>;
  publishInThread: (input: { channel: string; threadTs: string; text: string }) => Promise<void> | void;
  addWorkingReaction?: (input: { channel: string; messageTs: string }) => Promise<void> | void;
  removeWorkingReaction?: (input: { channel: string; messageTs: string }) => Promise<void> | void;
}

export type SlackAssistantHandleResult =
  | {
      outcome: "answered";
      route: "read_only" | "write";
      repo: string;
      publishedText: string;
    }
  | {
      outcome: "clarification_required";
      question: string;
    }
  | {
      outcome: "confirmation_required";
      question: string;
      confirmationTimeoutMs: number;
    };

function splitRepo(repoContext: string): { owner: string; repo: string } {
  const [owner, repo] = repoContext.split("/");
  return { owner: owner ?? "", repo: repo ?? "" };
}

function buildSlackAssistantPrompt(input: { repoContext: string; messageText: string; writeMode: boolean }): string {
  const modeInstructions = input.writeMode
    ? [
        "Write-capable execution requirements:",
        "- You may edit files, run tests/build commands, and prepare branch/PR outputs when needed.",
        "- Never push directly to protected/default branches; keep write delivery PR-only.",
        "",
      ]
    : [
        "Read-only execution requirements:",
        "- Do not edit files and do not propose file edits as completed.",
        "- Do not create branches, commits, pull requests, or run git write operations.",
        "- Do not run CI/build commands (for example: bun test, npm test, npm run build, make).",
        "- Focus on analysis, explanation, and concrete guidance only.",
        "",
      ];

  const lines = [
    "You are Kodiai's Slack assistant.",
    `Repository context: ${input.repoContext}`,
    "",
    "Slack response style:",
    "- Lead with the direct answer in the first sentence.",
    "- Keep replies concise by default (1-3 short lines, no long preamble).",
    "- Include extra detail only when the user explicitly asks for detail.",
    "- Do not narrate formatting choices (for example: 'To reply in Slack, I would...').",
    "",
    ...modeInstructions,
    "Slack message:",
    input.messageText,
  ];

  return lines.join("\n");
}

function buildConfirmationRequiredReply(keyword: SlackWriteKeyword, request: string): string {
  const command = `${keyword}: ${request.length > 0 ? request : "<same request>"}`;

  return [
    "This looks like a high-impact write request, so I did not execute it yet.",
    "Reply in this thread with the command below prefixed by `confirm:` to proceed:",
    `- ${command}`,
    "",
    `Confirmation timeout: ${Math.round(SLACK_WRITE_CONFIRMATION_TIMEOUT_MS / 60000)} minutes (request stays pending if not confirmed).`,
  ].join("\n");
}

function buildInstantReply(messageText: string): string | undefined {
  const normalized = messageText
    .toLowerCase()
    .replace(/<@[^>]+>/g, "")
    .trim();

  if (normalized === "ping" || normalized === "hi" || normalized === "hello" || normalized === "hey" || normalized === "hey there") {
    return "Pong! I am here. Ask me anything about xbmc/xbmc and I will answer in read-only mode.";
  }

  return undefined;
}

export function createSlackAssistantHandler(deps: SlackAssistantHandlerDeps) {
  const { createWorkspace, execute, publishInThread, addWorkingReaction, removeWorkingReaction } = deps;

  return {
    async handle(payload: SlackAssistantAddressedPayload): Promise<SlackAssistantHandleResult> {
      const hasReactionHandlers = Boolean(addWorkingReaction && removeWorkingReaction);
      if (hasReactionHandlers) {
        await addWorkingReaction?.({ channel: payload.channel, messageTs: payload.messageTs });
      }

      try {
        const instantReply = buildInstantReply(payload.text);
        if (instantReply) {
          await publishInThread({
            channel: payload.channel,
            threadTs: payload.threadTs,
            text: instantReply,
          });

          return {
            outcome: "answered",
            route: "read_only",
            repo: "xbmc/xbmc",
            publishedText: instantReply,
          };
        }

        const resolution = resolveSlackRepoContext(payload.text);

        if (resolution.outcome === "ambiguous") {
          await publishInThread({
            channel: payload.channel,
            threadTs: payload.threadTs,
            text: resolution.clarifyingQuestion,
          });

          return {
            outcome: "clarification_required",
            question: resolution.clarifyingQuestion,
          };
        }

        const writeIntent = resolveSlackWriteIntent(payload.text);
        if (writeIntent.outcome === "clarification_required") {
          await publishInThread({
            channel: payload.channel,
            threadTs: payload.threadTs,
            text: writeIntent.quickActionText,
          });

          return {
            outcome: "clarification_required",
            question: writeIntent.quickActionText,
          };
        }

        if (writeIntent.outcome === "write" && writeIntent.confirmationRequired) {
          const confirmationText = buildConfirmationRequiredReply(writeIntent.keyword, writeIntent.request);
          await publishInThread({
            channel: payload.channel,
            threadTs: payload.threadTs,
            text: confirmationText,
          });

          return {
            outcome: "confirmation_required",
            question: confirmationText,
            confirmationTimeoutMs: writeIntent.confirmationTimeoutMs,
          };
        }

        const { owner, repo } = splitRepo(resolution.repo);
        const workspace = await createWorkspace({ owner, repo });

        try {
          const writeMode = writeIntent.outcome === "write";
          const messageText = writeIntent.outcome === "read_only" ? payload.text : writeIntent.request;
          const prompt = buildSlackAssistantPrompt({
            repoContext: resolution.repo,
            messageText,
            writeMode,
          });

          const executionResult = await execute({
            workspace,
            owner,
            repo,
            writeMode,
            enableInlineTools: writeMode,
            enableCommentTools: writeMode,
            eventType: "slack.message",
            triggerBody: messageText,
            prompt,
          });

          const replyText =
            resolution.outcome === "override"
              ? `${resolution.acknowledgementText}\n\n${executionResult.answerText}`
              : executionResult.answerText;

          await publishInThread({
            channel: payload.channel,
            threadTs: payload.threadTs,
            text: replyText,
          });

          return {
            outcome: "answered",
            route: writeMode ? "write" : "read_only",
            repo: resolution.repo,
            publishedText: replyText,
          };
        } finally {
          await workspace.cleanup();
        }
      } finally {
        if (hasReactionHandlers) {
          await removeWorkingReaction?.({ channel: payload.channel, messageTs: payload.messageTs });
        }
      }
    },
  };
}
