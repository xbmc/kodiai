import type { Workspace } from "../jobs/types.ts";
import { resolveSlackRepoContext } from "./repo-context.ts";
import {
  resolveSlackWriteIntent,
  SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
  type SlackWriteKeyword,
} from "./write-intent.ts";
import type { SlackWriteRunnerResult } from "./write-runner.ts";
import {
  createInMemoryWriteConfirmationStore,
  type SlackWriteConfirmationStore,
} from "./write-confirmation-store.ts";

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
  runWrite?: (input: {
    owner: string;
    repo: string;
    channel: string;
    threadTs: string;
    messageTs: string;
    request: string;
    keyword: "apply" | "change";
    prompt: string;
  }) => Promise<SlackWriteRunnerResult>;
  publishInThread: (input: { channel: string; threadTs: string; text: string }) => Promise<void> | void;
  addWorkingReaction?: (input: { channel: string; messageTs: string }) => Promise<void> | void;
  removeWorkingReaction?: (input: { channel: string; messageTs: string }) => Promise<void> | void;
  confirmationStore?: SlackWriteConfirmationStore;
  defaultRepo: string;
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
    "Response opening:",
    "- Jump straight to the answer. No greeting, preamble, or lead-in.",
    '- Never open with phrases like "Here\'s what I found", "Based on the codebase", "Great question!", "Certainly!", "Let me explain", "Happy to help!"',
    '- No closing or sign-off. End when the answer is done. Never "Let me know if..." or "Hope that helps!"',
    "",
    "Trailing sections:",
    "- Never append Sources, References, Related Files, Next Steps, or any trailing section after the answer.",
    "",
    "Length calibration:",
    "- Simple factual questions: 1 sentence max.",
    "- Explain/how-does-X-work questions: ~5 sentences / short paragraph, even for complex topics.",
    '- If a response would exceed ~5 sentences, truncate to a concise version and offer "want the full breakdown?" — only expand if asked.',
    "- Only volunteer unsolicited info for critical gotchas or footguns.",
    "",
    "Tone and formatting:",
    "- Casual tone, like a friend who knows the codebase. Contractions OK, informal phrasing OK.",
    '- Avoid first person — "that file doesn\'t exist" not "I don\'t see that file."',
    '- Never hedge — state things definitively or say "not sure." No "I think..." or "it looks like..."',
    "- Simple questions: plain text with inline backticks for file paths/function names. No headers, no bullet lists.",
    "- Complex questions: bullets OK for lists, but never section headers (##). Keep it flat.",
    "- Code snippets: inline backticks for names, triple-backtick blocks OK for 1-5 line snippets.",
    "- Emoji sparingly for warnings but not decorative.",
    '- Never use AI-isms ("As an AI...", "Based on my analysis...") or filler ("Absolutely!", "Of course!").',
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

function extractConfirmCommand(text: string): string | undefined {
  const normalized = text.replace(/<@[^>]+>/g, " ").trim();
  if (!/^confirm\s*:/i.test(normalized)) {
    return undefined;
  }

  const command = normalized.replace(/^confirm\s*:/i, "").trim();
  return command.length > 0 ? command : undefined;
}

function buildInstantReply(messageText: string, repoContext: string): string | undefined {
  const normalized = messageText
    .toLowerCase()
    .replace(/<@[^>]+>/g, "")
    .trim();

  if (normalized === "ping" || normalized === "hi" || normalized === "hello" || normalized === "hey" || normalized === "hey there") {
    return `Pong! I am here. Ask me anything about ${repoContext} and I will answer in read-only mode.`;
  }

  return undefined;
}

function summarizeWriteRequest(request: string): string {
  const normalized = request.replace(/\s+/g, " ").trim();
  if (normalized.length <= 72) {
    return normalized.length > 0 ? normalized : "requested update";
  }
  return `${normalized.slice(0, 69).trimEnd()}...`;
}

function formatSlackWriteReply(input: {
  writeResult: SlackWriteRunnerResult;
  request: string;
  repo: string;
}): string {
  const { writeResult, request, repo } = input;

  if (writeResult.outcome === "refusal") {
    const reasonMatch = writeResult.responseText.match(/Reason:\s*(.+)/i);
    const reason = reasonMatch?.[1]?.trim() || writeResult.reason;

    return [
      "Write request refused.",
      `Reason: ${reason}`,
      `Retry command: ${writeResult.retryCommand}`,
    ].join("\n");
  }

  if (writeResult.outcome === "failure") {
    const reasonMatch = writeResult.responseText.match(/Reason:\s*(.+)/i);
    const reason = reasonMatch?.[1]?.trim() || "write-execution-failure";

    return [
      "Write request failed.",
      `Reason: ${reason}`,
      `Retry command: ${writeResult.retryCommand}`,
    ].join("\n");
  }

  const summary = summarizeWriteRequest(request);

  if (writeResult.mirrors.length === 0) {
    return [
      "Write run complete.",
      `- Changed: ${summary}`,
      `- Where: ${repo}`,
      `PR: ${writeResult.prUrl}`,
    ].join("\n");
  }

  const mirrorLines = writeResult.mirrors.flatMap((mirror) => [
    `- ${mirror.url}`,
    `  ${mirror.excerpt}`,
  ]);

  return [
    "Write run complete.",
    `- Changed: ${summary}`,
    `- Where: ${repo}`,
    `PR: ${writeResult.prUrl}`,
    "",
    "Mirrored GitHub comments:",
    ...mirrorLines,
  ].join("\n");
}

export function createSlackAssistantHandler(deps: SlackAssistantHandlerDeps) {
  const {
    createWorkspace,
    execute,
    runWrite,
    publishInThread,
    addWorkingReaction,
    removeWorkingReaction,
    confirmationStore = createInMemoryWriteConfirmationStore(),
    defaultRepo,
  } = deps;

  async function runAndPublishWrite(input: {
    owner: string;
    repo: string;
    channel: string;
    threadTs: string;
    messageTs: string;
    request: string;
    keyword: "apply" | "change";
    prompt: string;
    acknowledgementText?: string;
  }): Promise<SlackAssistantHandleResult> {
    if (!runWrite) {
      throw new Error("Slack write runner is not configured");
    }

    await publishInThread({
      channel: input.channel,
      threadTs: input.threadTs,
      text: `Write run started for ${input.owner}/${input.repo}.`,
    });
    await publishInThread({
      channel: input.channel,
      threadTs: input.threadTs,
      text: "Milestone: running write execution and preparing PR output.",
    });

    let replyText: string;
    try {
      const writeResult = await runWrite({
        owner: input.owner,
        repo: input.repo,
        channel: input.channel,
        threadTs: input.threadTs,
        messageTs: input.messageTs,
        request: input.request,
        keyword: input.keyword,
        prompt: input.prompt,
      });

      const finalText = formatSlackWriteReply({
        writeResult,
        request: input.request,
        repo: `${input.owner}/${input.repo}`,
      });
      replyText = input.acknowledgementText ? `${input.acknowledgementText}\n\n${finalText}` : finalText;
    } catch (error) {
      const retryCommand = `${input.keyword}: ${input.request.length > 0 ? input.request : "<same request>"}`;
      const reason = error instanceof Error ? error.message : String(error);
      const finalText = [
        "Write request failed.",
        `Reason: ${reason}`,
        `Retry command: ${retryCommand}`,
      ].join("\n");
      replyText = input.acknowledgementText ? `${input.acknowledgementText}\n\n${finalText}` : finalText;
    }

    await publishInThread({
      channel: input.channel,
      threadTs: input.threadTs,
      text: replyText,
    });

    return {
      outcome: "answered",
      route: "write",
      repo: `${input.owner}/${input.repo}`,
      publishedText: replyText,
    };
  }

  return {
    async handle(payload: SlackAssistantAddressedPayload): Promise<SlackAssistantHandleResult> {
      const hasReactionHandlers = Boolean(addWorkingReaction && removeWorkingReaction);
      if (hasReactionHandlers) {
        await addWorkingReaction?.({ channel: payload.channel, messageTs: payload.messageTs });
      }

      try {
        const instantReply = buildInstantReply(payload.text, defaultRepo);
        if (instantReply) {
          await publishInThread({
            channel: payload.channel,
            threadTs: payload.threadTs,
            text: instantReply,
          });

          return {
            outcome: "answered",
            route: "read_only",
            repo: defaultRepo,
            publishedText: instantReply,
          };
        }

        const resolution = resolveSlackRepoContext(payload.text, defaultRepo);

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

        const pendingConfirmation = confirmationStore.getPending(payload.channel, payload.threadTs);
        if (pendingConfirmation) {
          const confirmCommand = extractConfirmCommand(payload.text);

          if (!confirmCommand) {
            const reminderText = [
              "This write request is still pending confirmation.",
              "Reply with this exact command to continue:",
              `- confirm: ${pendingConfirmation.command}`,
            ].join("\n");

            await publishInThread({
              channel: payload.channel,
              threadTs: payload.threadTs,
              text: reminderText,
            });

            return {
              outcome: "confirmation_required",
              question: reminderText,
              confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
            };
          }

          const confirmationResult = confirmationStore.confirm(payload.channel, payload.threadTs, confirmCommand);
          if (confirmationResult.outcome === "mismatch") {
            const mismatchText = [
              "Confirmation command did not match the pending request.",
              "Reply with this exact command to continue:",
              `- confirm: ${confirmationResult.pending.command}`,
            ].join("\n");

            await publishInThread({
              channel: payload.channel,
              threadTs: payload.threadTs,
              text: mismatchText,
            });

            return {
              outcome: "confirmation_required",
              question: mismatchText,
              confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
            };
          }

          if (confirmationResult.outcome === "confirmed") {
            const pending = confirmationResult.pending;

            if (runWrite && (pending.keyword === "apply" || pending.keyword === "change")) {
              return runAndPublishWrite({
                owner: pending.owner,
                repo: pending.repo,
                channel: payload.channel,
                threadTs: payload.threadTs,
                messageTs: payload.messageTs,
                request: pending.request,
                keyword: pending.keyword,
                prompt: pending.prompt,
              });
            }

            const workspace = await createWorkspace({ owner: pending.owner, repo: pending.repo });
            try {
              const executionResult = await execute({
                workspace,
                owner: pending.owner,
                repo: pending.repo,
                writeMode: true,
                enableInlineTools: true,
                enableCommentTools: true,
                eventType: "slack.message",
                triggerBody: pending.request,
                prompt: pending.prompt,
              });

              await publishInThread({
                channel: payload.channel,
                threadTs: payload.threadTs,
                text: executionResult.answerText,
              });

              return {
                outcome: "answered",
                route: "write",
                repo: `${pending.owner}/${pending.repo}`,
                publishedText: executionResult.answerText,
              };
            } finally {
              await workspace.cleanup();
            }
          }
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
          const prompt = buildSlackAssistantPrompt({
            repoContext: resolution.repo,
            messageText: writeIntent.request,
            writeMode: true,
          });
          confirmationStore.openPending({
            channel: payload.channel,
            threadTs: payload.threadTs,
            owner,
            repo,
            keyword: writeIntent.keyword,
            request: writeIntent.request,
            prompt,
            timeoutMs: writeIntent.confirmationTimeoutMs,
          });

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

        const writeMode = writeIntent.outcome === "write";
        const messageText = writeIntent.outcome === "read_only" ? payload.text : writeIntent.request;
        const prompt = buildSlackAssistantPrompt({
          repoContext: resolution.repo,
          messageText,
          writeMode,
        });

        if (
          writeMode
          && runWrite
          && (writeIntent.keyword === "apply" || writeIntent.keyword === "change")
        ) {
          return runAndPublishWrite({
            owner,
            repo,
            channel: payload.channel,
            threadTs: payload.threadTs,
            messageTs: payload.messageTs,
            request: writeIntent.request,
            keyword: writeIntent.keyword,
            prompt,
            acknowledgementText: resolution.outcome === "override" ? resolution.acknowledgementText : undefined,
          });
        }

        const workspace = await createWorkspace({ owner, repo });

        try {
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
