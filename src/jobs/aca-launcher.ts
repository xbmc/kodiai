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
  githubInstallationToken?: string;
  timeoutSeconds?: number;
}

/**
 * Build an ACA Job spec with only the minimal env set needed by the agent
 * container. Throws if any APPLICATION_SECRET_NAMES appear in the resulting
 * env array — this is a hard security invariant.
 */
export function buildAcaJobSpec(opts: BuildAcaJobSpecOpts): AcaJobSpec {
  const env: AcaJobEnvVar[] = [];

  if (opts.anthropicApiKey !== undefined) {
    env.push({ name: "ANTHROPIC_API_KEY", value: opts.anthropicApiKey });
  }

  env.push({ name: "MCP_BEARER_TOKEN", value: opts.mcpBearerToken });
  env.push({ name: "MCP_BASE_URL", value: opts.mcpBaseUrl });
  env.push({ name: "WORKSPACE_DIR", value: opts.workspaceDir });

  if (opts.githubInstallationToken !== undefined) {
    env.push({ name: "GITHUB_INSTALLATION_TOKEN", value: opts.githubInstallationToken });
  }

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
  // Try IMDS first (available in ACA with managed identity)
  try {
    const imdsResp = await fetch(
      "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/",
      { headers: { Metadata: "true" } },
    );
    if (imdsResp.ok) {
      const imds = (await imdsResp.json()) as { access_token?: string };
      const token = imds.access_token ?? "";
      if (token) {
        // Get subscription ID from IMDS instance metadata
        const instanceResp = await fetch(
          "http://169.254.169.254/metadata/instance?api-version=2021-02-01",
          { headers: { Metadata: "true" } },
        );
        let subscriptionId = "";
        if (instanceResp.ok) {
          const instance = (await instanceResp.json()) as {
            compute?: { subscriptionId?: string };
          };
          subscriptionId = instance.compute?.subscriptionId ?? "";
        }
        if (!subscriptionId) {
          throw new Error("launchAcaJob: IMDS did not return subscriptionId");
        }
        return { token, subscriptionId };
      }
    }
  } catch {
    // IMDS not available — fall through to az CLI
  }

  // Fallback: az CLI (local dev / CI)
  const tokenResult = await $`az account get-access-token --query accessToken -o tsv`.quiet();
  const token = tokenResult.text().trim();
  if (!token) throw new Error("launchAcaJob: failed to get Azure access token via az CLI");

  const subResult = await $`az account show --query id -o tsv`.quiet();
  const subscriptionId = subResult.text().trim();
  if (!subscriptionId) throw new Error("launchAcaJob: failed to get Azure subscription ID via az CLI");

  return { token, subscriptionId };
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
 * Poll `az containerapp job execution show` until terminal state or timeout.
 * Returns the final status and duration in milliseconds.
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
    let rawOutput = "";
    try {
      const result = await $`az containerapp job execution show \
        --name ${jobName} \
        --resource-group ${resourceGroup} \
        --job-execution-name ${executionName} \
        --output json`.quiet();
      rawOutput = result.text();
    } catch (err) {
      logger?.debug(
        { attempt, executionName, err },
        "ACA Job poll: az command failed, will retry",
      );
    }

    const status = parseExecutionStatus(rawOutput);
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
 * Cancel a running ACA Job execution.
 * Calls `az containerapp job execution stop` and logs after completion.
 */
export async function cancelAcaJob(opts: {
  resourceGroup: string;
  jobName: string;
  executionName: string;
  logger?: Logger;
}): Promise<void> {
  const { resourceGroup, jobName, executionName, logger } = opts;

  await $`az containerapp job execution stop \
    --name ${jobName} \
    --resource-group ${resourceGroup} \
    --job-execution-name ${executionName} \
    --output none`.quiet();

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
