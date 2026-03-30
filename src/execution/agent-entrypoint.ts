/**
 * agent-entrypoint.ts — ACA Job container entry script.
 *
 * Reads config from WORKSPACE_DIR/agent-config.json, invokes Claude via the
 * Agent SDK, and writes the result to WORKSPACE_DIR/result.json.
 *
 * Expected env vars:
 *   WORKSPACE_DIR          — directory mounted into the job container
 *   MCP_BASE_URL           — base URL for MCP HTTP servers (e.g. https://api.example.com)
 *   MCP_BEARER_TOKEN       — bearer token for all MCP servers
 *   ANTHROPIC_API_KEY      — Anthropic API key (or CLAUDE_CODE_OAUTH_TOKEN as fallback)
 */

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage, McpHttpServerConfig, Query } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile as fsWriteFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSecurityClaudeMd } from "./executor.ts";
import type { ExecutionResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Agent config shape (read from WORKSPACE_DIR/agent-config.json)
// ---------------------------------------------------------------------------

interface AgentConfig {
  prompt: string;
  model: string;
  maxTurns: number;
  allowedTools: string[];
  taskType?: string;
  mcpServerNames?: string[]; // server names actually registered in orchestrator
}

// ---------------------------------------------------------------------------
// MCP server names the agent container connects to
// ---------------------------------------------------------------------------

export const MCP_SERVER_NAMES = [
  "github_comment",
  "reviewCommentThread",
  "github_inline_comment",
  "github_ci",
  "review_checkpoint",
  "github_issue_label",
  "github_issue_comment",
] as const;

// ---------------------------------------------------------------------------
// Injectable dependencies (for testing)
// ---------------------------------------------------------------------------

export interface EntrypointDeps {
  queryFn: (params: { prompt: string; options?: object }) => Query;
  writeFileFn: (path: string, content: string) => Promise<void>;
  readFileFn: (path: string, encoding: "utf-8") => Promise<string>;
  exitFn: (code: number) => never;
}

function defaultDeps(): EntrypointDeps {
  return {
    queryFn: sdkQuery,
    writeFileFn: (path, content) => fsWriteFile(path, content),
    readFileFn: readFile,
    exitFn: (code) => process.exit(code),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(deps?: Partial<EntrypointDeps>): Promise<void> {
  const {
    queryFn,
    writeFileFn,
    readFileFn,
    exitFn,
  }: EntrypointDeps = { ...defaultDeps(), ...deps };

  const startTime = Date.now();

  // 1. Read required env vars
  const workspaceDir = process.env.WORKSPACE_DIR;
  const mcpBaseUrl = process.env.MCP_BASE_URL;
  const mcpBearerToken = process.env.MCP_BEARER_TOKEN;
  const anthropicApiKey =
    process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;

  const missing: string[] = [];
  if (!workspaceDir) missing.push("WORKSPACE_DIR");
  if (!mcpBaseUrl) missing.push("MCP_BASE_URL");
  if (!mcpBearerToken) missing.push("MCP_BEARER_TOKEN");
  if (!anthropicApiKey) missing.push("ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)");

  if (missing.length > 0) {
    console.error(
      `agent-entrypoint: missing required environment variables: ${missing.join(", ")}`,
    );
    exitFn(1);
    return; // unreachable in production, but satisfies TypeScript in tests
  }

  // 2. Read agent-config.json
  const configPath = join(workspaceDir!, "agent-config.json");
  let agentConfig: AgentConfig;
  try {
    const raw = await readFileFn(configPath, "utf-8");
    agentConfig = JSON.parse(raw) as AgentConfig;
  } catch (err) {
    console.error(
      `agent-entrypoint: failed to read agent-config.json at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    exitFn(1);
    return; // unreachable in production
  }

  // 3. Write CLAUDE.md security policy
  await writeFileFn(join(workspaceDir!, "CLAUDE.md"), buildSecurityClaudeMd());

  // 4. Build mcpServers — use only names registered in orchestrator (from agent-config.json)
  // Fall back to MCP_SERVER_NAMES if not specified (for backward compat)
  const serverNamesToUse = agentConfig.mcpServerNames ?? [...MCP_SERVER_NAMES];
  const mcpServers: Record<string, McpHttpServerConfig> = {};
  for (const serverName of serverNamesToUse) {
    mcpServers[serverName] = {
      type: "http",
      url: `${mcpBaseUrl!}/internal/mcp/${serverName}`,
      headers: {
        Authorization: `Bearer ${mcpBearerToken!}`,
      },
    };
  }

  // 5–6. Call SDK, collect messages
  const resultJson = join(workspaceDir!, "result.json");

  try {
    const sdkQueryResult = queryFn({
      prompt: agentConfig.prompt,
      options: {
        cwd: workspaceDir!,
        model: agentConfig.model,
        maxTurns: agentConfig.maxTurns,
        allowedTools: agentConfig.allowedTools,
        mcpServers,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        settingSources: ["project"],
      },
    });

    let resultMessage: SDKResultMessage | undefined;

    for await (const message of sdkQueryResult) {
      if (message.type === "result") {
        resultMessage = message as SDKResultMessage;
      }
    }

    const durationMs = Date.now() - startTime;

    if (!resultMessage) {
      const errorResult: ExecutionResult = {
        conclusion: "error",
        costUsd: undefined,
        numTurns: undefined,
        durationMs,
        sessionId: undefined,
        errorMessage: "No result message received from Agent SDK",
        model: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        cacheReadTokens: undefined,
        cacheCreationTokens: undefined,
        stopReason: undefined,
      };
      await writeFileFn(resultJson, JSON.stringify(errorResult, null, 2));
      return;
    }

    // 7. Write result.json
    const modelEntries = Object.entries(resultMessage.modelUsage ?? {});
    const primaryModel = modelEntries[0]?.[0] ?? "unknown";
    const totalInput = modelEntries.reduce((sum, [, u]) => sum + u.inputTokens, 0);
    const totalOutput = modelEntries.reduce((sum, [, u]) => sum + u.outputTokens, 0);
    const totalCacheRead = modelEntries.reduce((sum, [, u]) => sum + u.cacheReadInputTokens, 0);
    const totalCacheCreation = modelEntries.reduce(
      (sum, [, u]) => sum + u.cacheCreationInputTokens,
      0,
    );

    const result: ExecutionResult = {
      conclusion: resultMessage.subtype === "success" ? "success" : "failure",
      costUsd: resultMessage.total_cost_usd,
      numTurns: resultMessage.num_turns,
      durationMs: resultMessage.duration_ms ?? durationMs,
      sessionId: resultMessage.session_id,
      errorMessage: undefined,
      model: primaryModel,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheCreationTokens: totalCacheCreation,
      stopReason: resultMessage.stop_reason ?? undefined,
      resultText:
        resultMessage.subtype === "success" ? resultMessage.result : undefined,
    };

    await writeFileFn(resultJson, JSON.stringify(result, null, 2));
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorResult: ExecutionResult = {
      conclusion: "error",
      costUsd: undefined,
      numTurns: undefined,
      durationMs,
      sessionId: undefined,
      errorMessage: err instanceof Error ? err.message : String(err),
      model: undefined,
      inputTokens: undefined,
      outputTokens: undefined,
      cacheReadTokens: undefined,
      cacheCreationTokens: undefined,
      stopReason: undefined,
    };
    await writeFileFn(resultJson, JSON.stringify(errorResult, null, 2));
  }
}

// Run when invoked directly (not imported by tests)
if (import.meta.main) {
  await main();
}
