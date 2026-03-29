/**
 * test-aca-job.ts — ACA Job contract checker and optional live smoke test.
 *
 * Always runs: pure-code contract check (no secrets in job spec env array).
 * With --live:  dispatches a real ACA Job, polls until complete, reads result.json.
 *
 * Usage:
 *   bun run scripts/test-aca-job.ts            # contract check only
 *   bun run scripts/test-aca-job.ts --live     # contract check + live job run
 *
 * Required env vars for --live:
 *   RESOURCE_GROUP       - Azure resource group (e.g. rg-kodiai)
 *   ACA_JOB_NAME         - ACA Job name (e.g. caj-kodiai-agent)
 *   AZURE_WORKSPACE_MOUNT - Workspace directory on the mounted share
 *                          (e.g. /mnt/kodiai-workspaces/test-job)
 */

import {
  APPLICATION_SECRET_NAMES,
  buildAcaJobSpec,
  launchAcaJob,
  pollUntilComplete,
  readJobResult,
} from "../src/jobs/aca-launcher.ts";

// ---------------------------------------------------------------------------
// Pure-code contract check (always runs)
// ---------------------------------------------------------------------------

console.log("==> ACA Job contract check: no application secrets in job spec env array");

const testSpec = buildAcaJobSpec({
  jobName: "caj-kodiai-agent",
  image: "kodiairegistry.azurecr.io/kodiai:latest",
  workspaceDir: "/mnt/kodiai-workspaces/test-job",
  mcpBearerToken: "test-token",
  mcpBaseUrl: "http://ca-kodiai.internal.env.eastus.azurecontainerapps.io",
});

let contractPassed = true;
for (const envEntry of testSpec.env) {
  if ((APPLICATION_SECRET_NAMES as readonly string[]).includes(envEntry.name)) {
    console.error(`❌ CONTRACT FAILED: ${envEntry.name} found in env array`);
    contractPassed = false;
  }
}

if (contractPassed) {
  console.log("✅ CONTRACT: no application secrets in job spec env array");
  console.log(`   Env vars in spec: ${testSpec.env.map((e) => e.name).join(", ")}`);
} else {
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Live mode (--live flag)
// ---------------------------------------------------------------------------

const isLive = process.argv.includes("--live");

if (!isLive) {
  console.log("");
  console.log("==> Skipping live test (pass --live to run a real ACA Job execution)");
  process.exit(0);
}

console.log("");
console.log("==> Live mode: dispatching real ACA Job...");

const resourceGroup = process.env["RESOURCE_GROUP"];
const acaJobName = process.env["ACA_JOB_NAME"];
const azureWorkspaceMount = process.env["AZURE_WORKSPACE_MOUNT"];

const missing: string[] = [];
if (!resourceGroup) missing.push("RESOURCE_GROUP");
if (!acaJobName) missing.push("ACA_JOB_NAME");
if (!azureWorkspaceMount) missing.push("AZURE_WORKSPACE_MOUNT");

if (missing.length > 0) {
  console.log(
    `==> Skipping live test: missing env vars: ${missing.join(", ")}`,
  );
  console.log(
    "   Set these env vars and re-run with --live to exercise a real ACA Job.",
  );
  process.exit(0);
}

// Build the live job spec. Use ANTHROPIC_API_KEY from env if available.
const liveSpec = buildAcaJobSpec({
  jobName: acaJobName!,
  image: "kodiairegistry.azurecr.io/kodiai:latest",
  workspaceDir: azureWorkspaceMount!,
  mcpBearerToken: "smoke-test-token",
  mcpBaseUrl: process.env["MCP_INTERNAL_BASE_URL"] ?? "",
  anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
});

console.log(`   Resource group : ${resourceGroup}`);
console.log(`   Job name       : ${acaJobName}`);
console.log(`   Workspace dir  : ${azureWorkspaceMount}`);

const dispatchStart = Date.now();

const { executionName } = await launchAcaJob({
  resourceGroup: resourceGroup!,
  jobName: acaJobName!,
  spec: liveSpec,
});

console.log(`   Execution name : ${executionName} (Azure portal audit trail)`);
console.log("==> Polling for completion (timeout: 120s)...");

const { status, durationMs } = await pollUntilComplete({
  resourceGroup: resourceGroup!,
  jobName: acaJobName!,
  executionName,
  timeoutMs: 120_000,
  pollIntervalMs: 5_000,
});

const totalMs = Date.now() - dispatchStart;

console.log(`   Job status     : ${status}`);
console.log(`   Cold start     : ${durationMs}ms (poll duration)`);
console.log(`   Total elapsed  : ${totalMs}ms (dispatch + poll)`);

if (status === "timed-out") {
  console.error(`❌ LIVE TEST FAILED: job timed out after ${durationMs}ms`);
  process.exit(1);
}

if (status === "failed") {
  console.error(`❌ LIVE TEST FAILED: job status = failed (durationMs: ${durationMs}ms)`);
  process.exit(1);
}

// Read result.json written by the agent container
try {
  const result = await readJobResult(azureWorkspaceMount!);
  console.log(`   result.json    :`, JSON.stringify(result, null, 2));
  console.log("✅ LIVE TEST PASSED: job succeeded and result.json is readable");
} catch (err) {
  // The smoke-test agent may not write result.json — warn but don't fail
  const message = err instanceof Error ? err.message : String(err);
  console.log(`   result.json    : not found or unreadable (${message})`);
  console.log("✅ LIVE TEST PASSED: job succeeded (result.json optional for smoke test)");
}

process.exit(0);
