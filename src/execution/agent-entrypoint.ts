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

import type { SDKResultMessage, McpHttpServerConfig, Query, SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile as fsWriteFile, appendFile as fsAppendFile, mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { buildSecurityClaudeMd } from "./executor.ts";
import { resolveRepoTransport } from "./repo-transport.ts";
import type { RepoTransport } from "./repo-transport.ts";
import type { ExecutionResult } from "./types.ts";
import { runCommandWithCappedOutput } from "../lib/capped-process.ts";
import { installMcpFetchRetry, normalizeMcpUrlKey } from "./mcp/mcp-fetch-retry.ts";
import { RETRY_SAFE_MCP_SERVER_NAMES } from "./mcp/index.ts";
import type { PromptSectionRecord } from "../telemetry/types.ts";

// ---------------------------------------------------------------------------
// Agent config shape (read from WORKSPACE_DIR/agent-config.json)
// ---------------------------------------------------------------------------

interface AgentConfig {
  prompt: string;
  model: string;
  maxTurns: number;
  allowedTools: string[];
  taskType?: string;
  repoCwd?: string;
  repoTransport?: RepoTransport;
  repoBundlePath?: string;
  repoOriginUrl?: string;
  promptSections?: PromptSectionRecord[];
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

// Retry-safety is a property of each MCP server's handler, so the allowlist
// (RETRY_SAFE_MCP_SERVER_NAMES) lives with the factory definitions in
// ./mcp/index.ts and is imported at the top of this file rather than duplicated.

// ---------------------------------------------------------------------------
// Injectable dependencies (for testing)
// ---------------------------------------------------------------------------

export interface EntrypointDeps {
  queryFn?: (params: { prompt: string; options?: object }) => Query;
  writeFileFn: (path: string, content: string) => Promise<void>;
  appendFileFn: (path: string, content: string) => Promise<void>;
  readFileFn: (path: string, encoding: "utf-8") => Promise<string>;
  exitFn: (code: number) => never;
}

function defaultDeps(): Omit<EntrypointDeps, "queryFn"> {
  return {
    writeFileFn: (path, content) => fsWriteFile(path, content),
    appendFileFn: (path, content) => fsAppendFile(path, content),
    readFileFn: readFile,
    exitFn: (code) => process.exit(code),
  };
}

export type AssistantContentPart = {
  type?: string;
  name?: string;
  input?: unknown;
};

type SystemInitMessage = {
  type: "system";
  subtype?: string;
  tools?: string[];
  mcp_servers?: Array<{
    name?: string;
    status?: string;
  }>;
};

function extractToolUseName(part: AssistantContentPart): string | undefined {
  return part.type === "tool_use" && typeof part.name === "string" && part.name.length > 0
    ? part.name
    : undefined;
}

function extractToolCommand(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input;
  }
  if (typeof input === "object" && input !== null) {
    const candidate = (input as { command?: unknown }).command;
    return typeof candidate === "string" ? candidate : undefined;
  }
  return undefined;
}

export function extractNormalizedToolTarget(part: AssistantContentPart): string | undefined {
  if (part.type !== "tool_use" || typeof part.input !== "object" || part.input === null) {
    return undefined;
  }

  const input = part.input as Record<string, unknown>;
  if (typeof input.command === "string") {
    const [program, ...rest] = input.command.trim().split(/\s+/);
    if (program === "git" && typeof rest[0] === "string") {
      return `git ${rest[0]}`;
    }
    return program || "bash";
  }
  if (typeof input.file_path === "string") {
    return input.file_path;
  }
  if (typeof input.pattern === "string") {
    return input.pattern.slice(0, 80);
  }
  if (typeof input.glob === "string") {
    return input.glob.slice(0, 80);
  }

  return undefined;
}

function isRepoInspectionToolUse(part: AssistantContentPart): boolean {
  const toolName = extractToolUseName(part);
  if (!toolName) {
    return false;
  }
  if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") {
    return true;
  }
  if (toolName !== "Bash") {
    return false;
  }

  const command = extractToolCommand(part.input)?.trim();
  if (!command) {
    return false;
  }

  return /^git(?:\s+-C\s+\S+)?\s+(diff|log|show)\b/.test(command);
}

async function cloneRepoBundle(args: string[]): Promise<void> {
  const result = await runCommandWithCappedOutput({
    command: "git",
    args: ["clone", ...args],
    timeoutMs: 120_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.exitCode !== 0) {
    const reason = result.timedOut
      ? "timed out after 120000ms"
      : result.stderr.trim() || `exited with code ${result.exitCode}`;
    throw new Error(`git clone failed: ${reason}`);
  }
}

async function materializeRepoTransport(transport: RepoTransport): Promise<string> {
  const cloneRoot = await mkdtemp(join(tmpdir(), "kodiai-agent-repo-"));
  const repoDir = join(cloneRoot, "repo");

  if (transport.kind === "review-bundle") {
    await cloneRepoBundle(["-b", transport.headRef, transport.bundlePath, repoDir]);
    if (transport.originUrl) {
      await $`git -C ${repoDir} remote set-url origin ${transport.originUrl}`.quiet();
    }
    return repoDir;
  }

  if (transport.kind === "working-tree-archive") {
    await mkdir(repoDir, { recursive: true });
    await $`tar -xf ${transport.archivePath} -C ${repoDir}`.quiet();
    return repoDir;
  }

  await cloneRepoBundle([transport.bundlePath, repoDir]);
  if (transport.originUrl) {
    await $`git -C ${repoDir} remote set-url origin ${transport.originUrl}`.quiet();
  }
  return repoDir;
}

function buildMcpServerUrl(baseUrl: string, serverName: string): string {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
  if (trimmedBaseUrl.endsWith("/internal/mcp")) {
    return `${trimmedBaseUrl}/${serverName}`;
  }
  return `${trimmedBaseUrl}/internal/mcp/${serverName}`;
}

function appendMcpTokenQuery(url: string, token: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}kodiai_mcp_token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(deps?: Partial<EntrypointDeps>): Promise<void> {
  const {
    queryFn,
    writeFileFn,
    appendFileFn,
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
  const retrySafeUrls = new Set<string>();
  for (const serverName of serverNamesToUse) {
    const url = appendMcpTokenQuery(
      buildMcpServerUrl(mcpBaseUrl!, serverName),
      mcpBearerToken!,
    );
    mcpServers[serverName] = {
      type: "http",
      url,
      headers: {
        Authorization: `Bearer ${mcpBearerToken!}`,
        "X-Kodiai-MCP-Authorization": `Bearer ${mcpBearerToken!}`,
      },
    };
    if (RETRY_SAFE_MCP_SERVER_NAMES.has(serverName)) {
      const key = normalizeMcpUrlKey(url);
      if (key) retrySafeUrls.add(key);
    }
  }

  // 4b. Install bounded retry for MCP callbacks. The Agent SDK's "http" MCP
  // transport uses globalThis.fetch with no retry, so a transient orchestrator
  // stall (fast-fail 503 / ingress 502-504 / dropped connection) would silently
  // drop a finding or comment. The retry-safe URL set restricts retries to
  // idempotent/deduped servers so they can never duplicate a PR comment.
  installMcpFetchRetry({ retrySafeUrls });

  // 5–6. Call SDK, collect messages
  const resultJson = join(workspaceDir!, "result.json");
  const diagnosticsLog = join(workspaceDir!, "agent-diagnostics.log");

  const appendDiagnostic = async (line: string): Promise<void> => {
    try {
      await appendFileFn(diagnosticsLog, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // Diagnostics are best-effort; a failed append (disk full, workspace
      // removed) must not surface as an unhandledRejection from the
      // fire-and-forget call sites (e.g. the SDK stderr callback).
    }
  };

  try {
    await appendDiagnostic(`startup taskType=${agentConfig.taskType ?? "unknown"} model=${agentConfig.model} maxTurns=${agentConfig.maxTurns}`);

    const repoTransport = resolveRepoTransport(agentConfig);
    if (repoTransport) {
      await appendDiagnostic(
        repoTransport.kind === "review-bundle"
          ? `repo transport kind=${repoTransport.kind} headRef=${repoTransport.headRef} baseRef=${repoTransport.baseRef} originConfigured=${repoTransport.originUrl ? "yes" : "no"}`
          : repoTransport.kind === "working-tree-archive"
            ? `repo transport kind=${repoTransport.kind}`
            : `repo transport kind=${repoTransport.kind} originConfigured=${repoTransport.originUrl ? "yes" : "no"}`,
      );
    }

    const sdkCwd = repoTransport
      ? await materializeRepoTransport(repoTransport)
      : (agentConfig.repoCwd ?? workspaceDir!);

    if (repoTransport) {
      await appendDiagnostic(
        repoTransport.kind === "review-bundle"
          ? `materialized review bundle headRef=${repoTransport.headRef} baseRef=${repoTransport.baseRef}`
          : repoTransport.kind === "working-tree-archive"
            ? "materialized repo archive kind=working-tree-archive"
            : "materialized repo bundle kind=bundle-all",
      );
    }

    const effectiveQueryFn = queryFn
      ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
    const sdkQueryResult = effectiveQueryFn({
      prompt: agentConfig.prompt,
      options: {
        cwd: sdkCwd,
        model: agentConfig.model,
        maxTurns: agentConfig.maxTurns,
        allowedTools: agentConfig.allowedTools,
        mcpServers,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        settingSources: ["project"],
        stderr: (line: string) => {
          void appendDiagnostic(`[sdk-stderr] ${line}`);
        },
      },
    });

    let resultMessage: SDKResultMessage | undefined;
    let lastRateLimitEvent: SDKRateLimitEvent | undefined;
    const toolUseNames: string[] = [];
    const seenToolUseNames = new Set<string>();
    let usedRepoInspectionTools = false;
    let currentTurn = 0;

    for await (const message of sdkQueryResult) {
      if (message.type === "system" && (message as SystemInitMessage).subtype === "init") {
        const initMessage = message as SystemInitMessage;
        const initTools = Array.isArray(initMessage.tools) ? initMessage.tools : [];
        const initMcpServers = Array.isArray(initMessage.mcp_servers)
          ? initMessage.mcp_servers
            .map((server) => {
              const name = typeof server?.name === "string" ? server.name : "unknown";
              const status = typeof server?.status === "string" ? server.status : "unknown";
              return `${name}:${status}`;
            })
          : [];
        await appendDiagnostic(
          `sdk init tools=${initTools.join(",") || "none"} mcpServers=${initMcpServers.join(",") || "none"}`,
        );
      } else if (message.type === "assistant") {
        currentTurn++;
        const parts = ((message as { message?: { content?: AssistantContentPart[] } }).message?.content ?? []) as AssistantContentPart[];
        for (const part of parts) {
          const toolName = extractToolUseName(part);
          if (!toolName) {
            continue;
          }
          if (!seenToolUseNames.has(toolName)) {
            seenToolUseNames.add(toolName);
            toolUseNames.push(toolName);
          }
          if (isRepoInspectionToolUse(part)) {
            usedRepoInspectionTools = true;
          }
          const target = extractNormalizedToolTarget(part);
          if (target) {
            await appendDiagnostic(`turn=${currentTurn} tool=${toolName} target=${target}`);
          }
        }
      } else if (message.type === "result") {
        resultMessage = message as SDKResultMessage;
      } else if (message.type === "rate_limit_event") {
        lastRateLimitEvent = message as SDKRateLimitEvent;
      }
    }

    const durationMs = Date.now() - startTime;

    if (!resultMessage) {
      const errorResult: ExecutionResult = {
        conclusion: "error",
        published: false,
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

    await appendDiagnostic(`sdk completed subtype=${resultMessage.subtype} turns=${resultMessage.num_turns ?? "unknown"} session=${resultMessage.session_id ?? "unknown"}`);
    if (toolUseNames.length > 0) {
      await appendDiagnostic(`sdk tool-use names=${toolUseNames.join(",")} repoInspection=${usedRepoInspectionTools}`);
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
      published: false,
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
      ...(resultMessage.subtype !== "success"
        ? { failureSubtype: resultMessage.subtype }
        : {}),
      resultText:
        resultMessage.subtype === "success" ? resultMessage.result : undefined,
      ...(agentConfig.promptSections ? { promptSections: agentConfig.promptSections } : {}),
      ...(toolUseNames.length > 0
        ? {
            toolUseNames,
            usedRepoInspectionTools,
          }
        : {}),
      ...(lastRateLimitEvent !== undefined ? {
        usageLimit: {
          utilization: lastRateLimitEvent.rate_limit_info.utilization,
          rateLimitType: lastRateLimitEvent.rate_limit_info.rateLimitType,
          resetsAt: lastRateLimitEvent.rate_limit_info.resetsAt,
        },
      } : {}),
    };

    await writeFileFn(resultJson, JSON.stringify(result, null, 2));
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await appendDiagnostic(`fatal ${errorMessage}`);
    const errorResult: ExecutionResult = {
      conclusion: "error",
      published: false,
      costUsd: undefined,
      numTurns: undefined,
      durationMs,
      sessionId: undefined,
      errorMessage,
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
