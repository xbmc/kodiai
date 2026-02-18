import type { Workspace } from "../jobs/types.ts";
import { resolveSlackRepoContext } from "./repo-context.ts";

export interface SlackAssistantAddressedPayload {
  channel: string;
  threadTs: string;
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
  writeMode: false;
  enableInlineTools: false;
  enableCommentTools: false;
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
}

export type SlackAssistantHandleResult =
  | {
      outcome: "answered";
      repo: string;
      publishedText: string;
    }
  | {
      outcome: "clarification_required";
      question: string;
    };

function splitRepo(repoContext: string): { owner: string; repo: string } {
  const [owner, repo] = repoContext.split("/");
  return { owner: owner ?? "", repo: repo ?? "" };
}

function buildSlackAssistantPrompt(input: { repoContext: string; messageText: string }): string {
  const lines = [
    "You are Kodiai's Slack assistant.",
    `Repository context: ${input.repoContext}`,
    "",
    "Read-only execution requirements:",
    "- Do not edit files and do not propose file edits as completed.",
    "- Do not create branches, commits, pull requests, or run git write operations.",
    "- Do not run CI/build commands (for example: bun test, npm test, npm run build, make).",
    "- Focus on analysis, explanation, and concrete guidance only.",
    "",
    "Slack message:",
    input.messageText,
  ];

  return lines.join("\n");
}

export function createSlackAssistantHandler(deps: SlackAssistantHandlerDeps) {
  const { createWorkspace, execute, publishInThread } = deps;

  return {
    async handle(payload: SlackAssistantAddressedPayload): Promise<SlackAssistantHandleResult> {
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

      const { owner, repo } = splitRepo(resolution.repo);
      const workspace = await createWorkspace({ owner, repo });

      try {
        const prompt = buildSlackAssistantPrompt({
          repoContext: resolution.repo,
          messageText: payload.text,
        });

        const executionResult = await execute({
          workspace,
          owner,
          repo,
          writeMode: false,
          enableInlineTools: false,
          enableCommentTools: false,
          eventType: "slack.message",
          triggerBody: payload.text,
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
          repo: resolution.repo,
          publishedText: replyText,
        };
      } finally {
        await workspace.cleanup();
      }
    },
  };
}
