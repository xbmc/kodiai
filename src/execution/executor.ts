import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { ExecutionContext, ExecutionResult, ExecutionPublishEvent } from "./types.ts";
import { loadRepoConfig } from "./config.ts";
import { buildMcpServers, buildAllowedMcpTools } from "./mcp/index.ts";
import { buildPrompt } from "./prompt.ts";
import type { CostTracker } from "../llm/cost-tracker.ts";
import type { ResolvedModel } from "../llm/task-router.ts";

export function createExecutor(deps: {
  githubApp: GitHubApp;
  logger: Logger;
  costTracker?: CostTracker;
  taskRouter?: { resolve(taskType: string): ResolvedModel };
}) {
  const { githubApp, logger } = deps;

  return {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
      const startTime = Date.now();

      // Declared outside try so catch block can access them for cleanup
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let controller: AbortController | undefined;
      let timeoutSeconds = 600; // default, updated from config
      let published = false;
      const publishEvents: ExecutionPublishEvent[] = [];

      try {
        // Load repo config (.kodiai.yml) with defaults
        const { config, warnings } = await loadRepoConfig(context.workspace.dir);
        for (const w of warnings) {
          logger.warn(
            { section: w.section, issues: w.issues },
            "Config section invalid, using defaults",
          );
        }
        // Resolve model via TaskRouter when available
        const taskType = context.taskType ?? "review.full";
        let model: string;
        if (deps.taskRouter) {
          const resolved = deps.taskRouter.resolve(taskType);
          model = context.modelOverride ?? resolved.modelId;
          logger.info(
            {
              taskType,
              resolvedModel: resolved.modelId,
              sdk: resolved.sdk,
              provider: resolved.provider,
              modelSource: context.modelOverride ? "override" : "router",
            },
            "Task router resolved model",
          );
        } else {
          model = context.modelOverride ?? config.model;
        }
        const maxTurns = context.maxTurnsOverride ?? config.maxTurns;
        logger.info(
          {
            model,
            modelSource: context.modelOverride ? "override" : deps.taskRouter ? "router" : "config",
            maxTurns,
            maxTurnsSource: context.maxTurnsOverride ? "override" : "config",
          },
          "Loaded repo config",
        );

        // Set up timeout enforcement via AbortController (not AbortSignal.timeout()
        // because we need to clearTimeout on success -- Pitfall 5 from research)
        timeoutSeconds = context.dynamicTimeoutSeconds ?? config.timeoutSeconds;
        const timeoutMs = timeoutSeconds * 1000;
        controller = new AbortController();
        timeoutId = setTimeout(
          () => controller!.abort(new Error("timeout")),
          timeoutMs,
        );
        logger.info(
          { timeoutMs, source: context.dynamicTimeoutSeconds ? "dynamic" : "config" },
          "Timeout enforcement configured",
        );

        // Build MCP servers with fresh Octokit per API call (Pitfall 6)
        const getOctokit = () =>
          githubApp.getInstallationOctokit(context.installationId);

        const isMentionEvent =
          context.eventType === "issue_comment.created" ||
          context.eventType === "pull_request_review_comment.created" ||
          context.eventType === "pull_request_review.submitted";

        const isWriteMode = context.writeMode === true;

        const enableInlineTools =
          isMentionEvent || isWriteMode
            ? false
            : (context.enableInlineTools ?? true);
        const enableCommentTools = context.enableCommentTools ?? !isWriteMode;

        // Enable issue triage tools for issue mentions when triage is configured
        const isIssueMention =
          context.eventType === "issue_comment.created" &&
          context.prNumber === undefined;
        const enableIssueTools = isIssueMention && config.triage.enabled;
        const triageConfig = enableIssueTools
          ? {
              enabled: config.triage.enabled,
              label: config.triage.label,
              comment: config.triage.comment,
            }
          : undefined;

        const mcpServers = buildMcpServers({
          getOctokit,
          owner: context.owner,
          repo: context.repo,
          prNumber: context.prNumber,
          commentId: context.commentId,
          botHandles: context.botHandles,
          reviewOutputKey: context.reviewOutputKey,
          deliveryId: context.deliveryId,
          logger,
          onPublish: () => {
            published = true;
          },
          onPublishEvent: (event) => {
            publishEvents.push(event);
          },
          // Mentions should not create new inline review comments; they should reply in-thread
          // (when available) or post a top-level PR/issue comment.
          enableInlineTools,
          // In write-mode, trusted code publishes results (PR link, etc.)
          enableCommentTools,
          knowledgeStore: context.knowledgeStore,
          totalFiles: context.totalFiles,
          enableCheckpointTool: context.enableCheckpointTool,
          enableIssueTools,
          triageConfig,
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
            model,
            maxTurns,
            systemPrompt: {
              type: "preset",
              preset: "claude_code",
              ...(config.systemPromptAppend && {
                append: config.systemPromptAppend,
              }),
            },
            mcpServers,
            allowedTools,
            disallowedTools: [],
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
            model: undefined,
            inputTokens: undefined,
            outputTokens: undefined,
            cacheReadTokens: undefined,
            cacheCreationTokens: undefined,
            stopReason: undefined,
          };
        }

        // Extract token usage from SDK result (TELEM-01)
        const modelEntries = Object.entries(resultMessage.modelUsage ?? {});
        const primaryModel = modelEntries[0]?.[0] ?? "unknown";
        const totalInput = modelEntries.reduce(
          (sum, [, u]) => sum + u.inputTokens,
          0,
        );
        const totalOutput = modelEntries.reduce(
          (sum, [, u]) => sum + u.outputTokens,
          0,
        );
        const totalCacheRead = modelEntries.reduce(
          (sum, [, u]) => sum + u.cacheReadInputTokens,
          0,
        );
        const totalCacheCreation = modelEntries.reduce(
          (sum, [, u]) => sum + u.cacheCreationInputTokens,
          0,
        );

        // Track Agent SDK cost (fire-and-forget, fail-open)
        if (deps.costTracker) {
          deps.costTracker.trackAgentSdkCall({
            repo: `${context.owner}/${context.repo}`,
            taskType,
            model: primaryModel,
            inputTokens: totalInput,
            outputTokens: totalOutput,
            cacheReadTokens: totalCacheRead,
            cacheWriteTokens: totalCacheCreation,
            durationMs: resultMessage.duration_ms ?? durationMs,
            costUsd: resultMessage.total_cost_usd,
            deliveryId: context.deliveryId,
          });
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
          model: primaryModel,
          inputTokens: totalInput,
          outputTokens: totalOutput,
          cacheReadTokens: totalCacheRead,
          cacheCreationTokens: totalCacheCreation,
          stopReason: resultMessage.stop_reason ?? undefined,
          resultText: resultMessage.subtype === "success" ? resultMessage.result : undefined,
          publishEvents: publishEvents.length > 0 ? publishEvents : undefined,
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
            published,
            errorMessage: `Job timed out after ${timeoutSeconds} seconds. The operation was taking too long and was automatically terminated.`,
            isTimeout: true,
            model: undefined,
            inputTokens: undefined,
            outputTokens: undefined,
            cacheReadTokens: undefined,
            cacheCreationTokens: undefined,
            stopReason: undefined,
            publishEvents: publishEvents.length > 0 ? publishEvents : undefined,
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
          published,
          errorMessage,
          model: undefined,
          inputTokens: undefined,
          outputTokens: undefined,
          cacheReadTokens: undefined,
          cacheCreationTokens: undefined,
          stopReason: undefined,
          publishEvents: publishEvents.length > 0 ? publishEvents : undefined,
        };
      }
    },
  };
}
