/**
 * ACA Job Launcher — spec builder, dispatch, poll, result reader.
 *
 * Security contract: `buildAcaJobSpec` never puts application secrets in the
 * job's env array. The runtime guard throws if any APPLICATION_SECRET_NAMES
 * are found — validated at both build time and at test time.
 */

import { join } from "node:path";
import { $ } from "bun";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AcaJobEnvVar {
  name: string;
  value: string;
}

export interface AcaJobSpec {
  jobName: string;
  image: string;
  workspaceDir: string;
  env: AcaJobEnvVar[];
  timeoutSeconds: number;
}

// ---------------------------------------------------------------------------
// Security contract — names that must NEVER appear in the job's env array
// ---------------------------------------------------------------------------

/**
 * Application secret key names that are forbidden from the ACA job env array.
 * This is the security contract artifact — if any of these appear in a job spec,
 * the application would leak credentials to the untrusted agent container.
 */
export const APPLICATION_SECRET_NAMES: readonly string[] = [
  "GITHUB_PRIVATE_KEY",
  "GITHUB_PRIVATE_KEY_BASE64",
  "GITHUB_APP_ID",
  "GITHUB_WEBHOOK_SECRET",
  "DATABASE_URL",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "VOYAGE_API_KEY",
  "BOT_USER_PAT",
  "GITHUB_INSTALLATION_TOKEN",
] as const;

// ---------------------------------------------------------------------------
// Spec builder
// ---------------------------------------------------------------------------

export interface BuildAcaJobSpecOpts {
  jobName: string;
  image: string;
  workspaceDir: string;
  anthropicApiKey?: string;
  mcpBearerToken: string;
  mcpBaseUrl: string;
  timeoutSeconds?: number;
}

/**
 * Build an ACA Job spec with only the minimal env set needed by the agent
 * container. Throws if any APPLICATION_SECRET_NAMES appear in the resulting
 * env array — this is a hard security invariant.
 */
export function buildAcaJobSpec(opts: BuildAcaJobSpecOpts): AcaJobSpec {
  const env: AcaJobEnvVar[] = [];

  const rawAuthToken = opts.anthropicApiKey;
  if (rawAuthToken !== undefined) {
    // OAuth tokens (sk-ant-oat01-...) must be passed as CLAUDE_CODE_OAUTH_TOKEN;
    // API keys (sk-ant-api03-...) use ANTHROPIC_API_KEY
    if (rawAuthToken.startsWith("sk-ant-oat")) {
      env.push({ name: "CLAUDE_CODE_OAUTH_TOKEN", value: rawAuthToken });
    } else {
      env.push({ name: "ANTHROPIC_API_KEY", value: rawAuthToken });
    }
  }

  env.push({ name: "MCP_BEARER_TOKEN", value: opts.mcpBearerToken });
  env.push({ name: "MCP_BASE_URL", value: opts.mcpBaseUrl });
  env.push({ name: "WORKSPACE_DIR", value: opts.workspaceDir });

  // Runtime guard: verify the contract — no application secrets in the env
  const forbidden = env.filter((e) =>
    (APPLICATION_SECRET_NAMES as readonly string[]).includes(e.name),
  );
  if (forbidden.length > 0) {
    const names = forbidden.map((e) => e.name).join(", ");
    throw new Error(
      `Security violation: APPLICATION_SECRET_NAMES found in ACA job env array: ${names}`,
    );
  }

  return {
    jobName: opts.jobName,
    image: opts.image,
    workspaceDir: opts.workspaceDir,
    env,
    timeoutSeconds: opts.timeoutSeconds ?? 600,
  };
}

// ---------------------------------------------------------------------------
// Job dispatch
// ---------------------------------------------------------------------------

/**
 * Get an Azure management API access token.
 *
 * In ACA (production): uses the managed identity IMDS endpoint.
 * Outside ACA (local dev / CI): falls back to `az account get-access-token`.
 */
async function getAzureAccessToken(): Promise<{ token: string; subscriptionId: string }> {
  // Subscription ID for rg-kodiai
  const subscriptionId = "ca35c409-cc4f-4072-ac43-c50a426f62a4";
  // Client ID for user-assigned managed identity (id-kodiai)
  const clientId = "2956d96a-b618-498d-a021-6bb3196fdcdf";

  // ACA injects IDENTITY_ENDPOINT + IDENTITY_HEADER for managed identity auth
  // (different from VM IMDS at 169.254.169.254 — ACA uses a sidecar proxy)
  const identityEndpoint = process.env["IDENTITY_ENDPOINT"];
  const identityHeader = process.env["IDENTITY_HEADER"];

  if (identityEndpoint && identityHeader) {
    const url = `${identityEndpoint}?resource=https://management.azure.com/&api-version=2019-08-01&client_id=${clientId}`;
    const resp = await fetch(url, { headers: { "X-IDENTITY-HEADER": identityHeader } });
    const body = await resp.text();
    if (!resp.ok) {
      throw new Error(`getAzureAccessToken: MSI endpoint returned ${resp.status}: ${body.slice(0, 300)}`);
    }
    const parsed = JSON.parse(body) as { access_token?: string };
    const token = parsed.access_token ?? "";
    if (!token) {
      throw new Error(`getAzureAccessToken: MSI endpoint returned no access_token: ${body.slice(0, 300)}`);
    }
    return { token, subscriptionId };
  }

  // Fallback: az CLI (local dev only — not available in orchestrator container)
  try {
    const tokenResult = await $`az account get-access-token --query accessToken -o tsv`.quiet();
    const token = tokenResult.text().trim();
    if (token) return { token, subscriptionId };
  } catch {
    // az not available
  }

  throw new Error(
    "getAzureAccessToken: IDENTITY_ENDPOINT not set (managed identity not configured?) and az CLI not available",
  );
}

/**
 * Launch an ACA Job execution and return the execution name.
 *
 * Uses the Azure Management REST API directly because `az containerapp job
 * execution start` does not exist in containerapp CLI extension ≤1.3.0b2, and
 * `az containerapp job start --env-vars` does not pass env overrides into the
 * running container (it modifies the job template permanently instead).
 *
 * The REST endpoint POST /jobs/{name}/start accepts per-execution env overrides
 * in the request body and is available in API version 2024-03-01+.
 */
export async function launchAcaJob(opts: {
  resourceGroup: string;
  jobName: string;
  spec: AcaJobSpec;
  logger?: Logger;
}): Promise<{ executionName: string }> {
  const { resourceGroup, jobName, spec, logger } = opts;

  const { token: accessToken, subscriptionId } = await getAzureAccessToken();

  const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/jobs/${jobName}/start?api-version=2024-03-01`;

  const body = {
    containers: [
      {
        name: jobName,
        image: spec.image,
        env: spec.env.map((e) => ({ name: e.name, value: e.value })),
      },
    ],
  };

  logger?.info(
    {
      jobName,
      resourceGroup,
      startApiVersion: "2024-03-01",
      specImage: spec.image,
      bodyContainerNames: body.containers.map((c) => c.name),
      bodyImages: body.containers.map((c) => c.image),
      bodyEnvNames: body.containers[0]?.env?.map((e) => e.name) ?? [],
      workspaceDir: spec.workspaceDir,
    },
    "ACA Job start request prepared",
  );

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logger?.error(
      {
        jobName,
        resourceGroup,
        httpStatus: response.status,
        responseBody: text.slice(0, 1000),
        startApiVersion: "2024-03-01",
        specImage: spec.image,
        bodyShape: {
          hasTemplate: false,
          containerCount: body.containers.length,
          containerNames: body.containers.map((c) => c.name),
          containerImagesPresent: body.containers.map((c) => Boolean(c.image)),
          envCounts: body.containers.map((c) => c.env?.length ?? 0),
        },
      },
      "ACA Job start request rejected",
    );
    throw new Error(
      `launchAcaJob: REST API returned ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  const parsed = (await response.json()) as { name?: string; id?: string };
  const executionName = parsed.name ?? "";
  if (!executionName) {
    throw new Error(
      `launchAcaJob: API returned no execution name. Body: ${JSON.stringify(parsed).slice(0, 500)}`,
    );
  }

  logger?.info(
    { executionName, jobName, workspaceDir: spec.workspaceDir },
    "ACA Job dispatched",
  );

  return { executionName };
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

type PollStatus = "succeeded" | "failed" | "timed-out";

interface AcaExecutionShowResult {
  properties?: {
    status?: string;
  };
  status?: string;
}

function parseExecutionStatus(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as AcaExecutionShowResult;
    return (
      parsed.properties?.status ??
      parsed.status ??
      undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * Poll the Azure Management REST API for execution status until terminal state
 * or timeout. Returns the final status and duration in milliseconds.
 *
 * Uses REST API (not az CLI) — az is not installed in the orchestrator container.
 * GET /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.App/jobs/{job}/executions/{exec}
 */
export async function pollUntilComplete(opts: {
  resourceGroup: string;
  jobName: string;
  executionName: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  logger?: Logger;
}): Promise<{ status: PollStatus; durationMs: number }> {
  const {
    resourceGroup,
    jobName,
    executionName,
    timeoutMs,
    pollIntervalMs = 10_000,
    logger,
  } = opts;

  const { token: accessToken, subscriptionId } = await getAzureAccessToken();
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/jobs/${jobName}/executions/${executionName}?api-version=2024-03-01`;

  const startMs = Date.now();
  let attempt = 0;

  while (true) {
    const elapsed = Date.now() - startMs;
    if (elapsed >= timeoutMs) {
      const durationMs = Date.now() - startMs;
      logger?.info({ executionName, jobName, durationMs, status: "timed-out" }, "ACA Job poll timed out");
      return { status: "timed-out", durationMs };
    }

    attempt++;
    let rawBody = "";
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      rawBody = await resp.text();
      if (!resp.ok) {
        logger?.debug(
          { attempt, executionName, httpStatus: resp.status, body: rawBody.slice(0, 200) },
          "ACA Job poll: REST API error, will retry",
        );
        rawBody = "";
      }
    } catch (err) {
      logger?.debug(
        { attempt, executionName, err },
        "ACA Job poll: fetch failed, will retry",
      );
    }

    const status = parseExecutionStatus(rawBody);
    logger?.debug({ attempt, executionName, status }, "ACA Job poll attempt");

    if (status) {
      const normalized = status.toLowerCase();
      if (normalized === "succeeded") {
        const durationMs = Date.now() - startMs;
        logger?.info({ executionName, jobName, durationMs, status: "succeeded" }, "ACA Job completed");
        return { status: "succeeded", durationMs };
      }
      if (normalized === "failed") {
        const durationMs = Date.now() - startMs;
        logger?.info({ executionName, jobName, durationMs, status: "failed" }, "ACA Job failed");
        return { status: "failed", durationMs };
      }
    }

    // Sleep before next poll (or bail out if timeout would be exceeded)
    const remaining = timeoutMs - (Date.now() - startMs);
    if (remaining <= 0) continue;
    await Bun.sleep(Math.min(pollIntervalMs, remaining));
  }
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Cancel a running ACA Job execution via the Azure Management REST API.
 *
 * Uses REST API (not az CLI) — az is not installed in the orchestrator container.
 * POST /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.App/jobs/{job}/executions/{exec}/stop
 */
export async function cancelAcaJob(opts: {
  resourceGroup: string;
  jobName: string;
  executionName: string;
  logger?: Logger;
}): Promise<void> {
  const { resourceGroup, jobName, executionName, logger } = opts;

  const { token: accessToken, subscriptionId } = await getAzureAccessToken();
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/jobs/${jobName}/executions/${executionName}/stop?api-version=2024-03-01`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Length": "0",
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`cancelAcaJob: REST API returned ${resp.status}: ${text.slice(0, 300)}`);
  }

  logger?.info({ executionName, jobName }, "ACA Job execution cancelled");
}

// ---------------------------------------------------------------------------
// Result reader
// ---------------------------------------------------------------------------

/**
 * Read and JSON-parse `{workspaceDir}/result.json` written by the agent container.
 */
export async function readJobResult(workspaceDir: string): Promise<unknown> {
  const resultPath = join(workspaceDir, "result.json");
  const text = await Bun.file(resultPath).text();
  return JSON.parse(text) as unknown;
}

export async function readJobDiagnostics(workspaceDir: string): Promise<string | undefined> {
  const diagnosticsPath = join(workspaceDir, "agent-diagnostics.log");
  const file = Bun.file(diagnosticsPath);
  if (!(await file.exists())) return undefined;
  return await file.text();
}
