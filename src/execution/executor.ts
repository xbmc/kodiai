import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { ExecutionContext, ExecutionResult } from "./types.ts";
import { loadRepoConfig } from "./config.ts";
import { buildMcpServers, buildAllowedMcpTools } from "./mcp/index.ts";
import { buildPrompt } from "./prompt.ts";

export function createExecutor(deps: {
  githubApp: GitHubApp;
  logger: Logger;
}) {
  const { githubApp, logger } = deps;

  return {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
      const startTime = Date.now();

      // Declared outside try so catch block can access them for cleanup
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let controller: AbortController | undefined;
      let timeoutSeconds = 300; // default, updated from config

      try {
        // Load repo config (.kodiai.yml) with defaults
        const config = await loadRepoConfig(context.workspace.dir);
        logger.info(
          { model: config.model, maxTurns: config.maxTurns },
          "Loaded repo config",
        );

        // Set up timeout enforcement via AbortController (not AbortSignal.timeout()
        // because we need to clearTimeout on success -- Pitfall 5 from research)
        timeoutSeconds = config.timeoutSeconds;
        const timeoutMs = timeoutSeconds * 1000;
        controller = new AbortController();
        timeoutId = setTimeout(
          () => controller!.abort(new Error("timeout")),
          timeoutMs,
        );
        logger.info({ timeoutMs }, "Timeout enforcement configured");

        // Build MCP servers with fresh Octokit per API call (Pitfall 6)
        const getOctokit = () =>
          githubApp.getInstallationOctokit(context.installationId);
        let published = false;

        const isMentionEvent =
          context.eventType === "issue_comment.created" ||
          context.eventType === "pull_request_review_comment.created" ||
          context.eventType === "pull_request_review.submitted";

        const isWriteMode = context.writeMode === true;

        const mcpServers = buildMcpServers({
          getOctokit,
          owner: context.owner,
          repo: context.repo,
          prNumber: context.prNumber,
          commentId: context.commentId,
          reviewOutputKey: context.reviewOutputKey,
          deliveryId: context.deliveryId,
          logger,
          onPublish: () => {
            published = true;
          },
          // Mentions should not create new inline review comments; they should reply in-thread
          // (when available) or post a top-level PR/issue comment.
          enableInlineTools: !isMentionEvent && !isWriteMode,
          // In write-mode, trusted code publishes results (PR link, etc.)
          enableCommentTools: !isWriteMode,
        });

        // Build allowed tools list
        const baseTools = [
          "Read",
          "Grep",
          "Glob",
          "Bash(git diff:*)",
          "Bash(git log:*)",
          "Bash(git show:*)",
          "Bash(git status:*)",
        ];

        const writeTools = isWriteMode ? ["Edit", "Write", "MultiEdit"] : [];
        const mcpTools = buildAllowedMcpTools(Object.keys(mcpServers));
        const allowedTools = [...baseTools, ...writeTools, ...mcpTools];

        // Build prompt (use pre-built prompt if provided, e.g., review handler)
        const prompt = context.prompt ?? buildPrompt(context);

        // Invoke Claude Code CLI via Agent SDK
        const sdkQuery = query({
          prompt,
          options: {
            abortController: controller,
            cwd: context.workspace.dir,
            model: config.model,
            maxTurns: config.maxTurns,
            systemPrompt: {
              type: "preset",
              preset: "claude_code",
              ...(config.systemPromptAppend && {
                append: config.systemPromptAppend,
              }),
            },
            mcpServers,
            allowedTools,
            disallowedTools: ["WebSearch", "WebFetch"],
            settingSources: ["project"],
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            env: {
              ...process.env,
              CLAUDE_CODE_ENTRYPOINT: "kodiai-github-app",
            },
          },
        });

        // Stream messages
        let resultMessage: SDKResultMessage | undefined;

        for await (const message of sdkQuery) {
          if (message.type === "system" && message.subtype === "init") {
            logger.info("Claude Code session started");
          }
          if (message.type === "result") {
            resultMessage = message as SDKResultMessage;
          }
          if (message.type === "assistant") {
            logger.debug(
              { messageType: "assistant" },
              "Claude Code assistant message",
            );
          }
        }

        // Clear timeout on successful completion (no orphaned timers)
        clearTimeout(timeoutId);

        // Build result
        const durationMs = Date.now() - startTime;

        if (!resultMessage) {
          return {
            conclusion: "error",
            costUsd: undefined,
            numTurns: undefined,
            durationMs,
            sessionId: undefined,
            errorMessage: "No result message received from Claude Code CLI",
          };
        }

        return {
          conclusion:
            resultMessage.subtype === "success" ? "success" : "failure",
          costUsd: resultMessage.total_cost_usd,
          numTurns: resultMessage.num_turns,
          durationMs: resultMessage.duration_ms ?? durationMs,
          sessionId: resultMessage.session_id,
          published,
          errorMessage: undefined,
        };
      } catch (err) {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        // Check if the abort signal fired (timeout)
        if (controller?.signal.aborted) {
          logger.warn(
            { timeoutSeconds, durationMs },
            "Execution timed out",
          );
          return {
            conclusion: "error",
            costUsd: undefined,
            numTurns: undefined,
            durationMs,
            sessionId: undefined,
            published: false,
            errorMessage: `Job timed out after ${timeoutSeconds} seconds. The operation was taking too long and was automatically terminated.`,
            isTimeout: true,
          };
        }

        const errorMessage =
          err instanceof Error ? err.message : String(err);
        logger.error({ err, durationMs }, "Execution failed");

        return {
          conclusion: "error",
          costUsd: undefined,
          numTurns: undefined,
          durationMs,
          sessionId: undefined,
          published: false,
          errorMessage,
        };
      }
    },
  };
}
