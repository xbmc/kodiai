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

      try {
        // Load repo config (.kodiai.yml) with defaults
        const config = await loadRepoConfig(context.workspace.dir);
        logger.info(
          { model: config.model, maxTurns: config.maxTurns },
          "Loaded repo config",
        );

        // Build MCP servers with fresh Octokit per API call (Pitfall 6)
        const getOctokit = () =>
          githubApp.getInstallationOctokit(context.installationId);
        const mcpServers = buildMcpServers({
          getOctokit,
          owner: context.owner,
          repo: context.repo,
          prNumber: context.prNumber,
          commentId: context.commentId,
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
        const mcpTools = buildAllowedMcpTools(Object.keys(mcpServers));
        const allowedTools = [...baseTools, ...mcpTools];

        // Build prompt (use pre-built prompt if provided, e.g., review handler)
        const prompt = context.prompt ?? buildPrompt(context);

        // Invoke Claude Code CLI via Agent SDK
        const sdkQuery = query({
          prompt,
          options: {
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
          errorMessage: undefined,
        };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        logger.error({ err, durationMs }, "Execution failed");

        return {
          conclusion: "error",
          costUsd: undefined,
          numTurns: undefined,
          durationMs,
          sessionId: undefined,
          errorMessage,
        };
      }
    },
  };
}
