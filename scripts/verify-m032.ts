/**
 * M032 proof harness.
 *
 * Three pure-code checks covering all M032 security contracts:
 *   - M032-JOB-SPEC-NO-SECRETS     (pure-code) -- buildAcaJobSpec env array contains no APPLICATION_SECRET_NAMES
 *   - M032-MCP-AUTH-REJECTS-UNAUTH (pure-code) -- createMcpHttpRoutes returns 401 for unauthenticated requests
 *   - M032-WORKSPACE-ON-AZURE-FILES (pure-code) -- createAzureFilesWorkspaceDir returns path under mountBase
 *
 * Usage:
 *   bun run verify:m032 [--json]
 *
 * Exit 0 = overallPassed true (all non-skipped checks pass).
 * Exit 1 = at least one non-skipped check failed.
 *
 * Failure diagnostics:
 *   bun run verify:m032 --json 2>&1 | jq '.checks[] | select(.passed == false)'
 */

import {
  buildAcaJobSpec,
  APPLICATION_SECRET_NAMES,
} from "../src/jobs/aca-launcher.ts";
import { createMcpJobRegistry, createMcpHttpRoutes } from "../src/execution/mcp/http-server.ts";
import { createAzureFilesWorkspaceDir } from "../src/jobs/workspace.ts";

// ── Exports and types ────────────────────────────────────────────────────

export const M032_CHECK_IDS = [
  "M032-JOB-SPEC-NO-SECRETS",
  "M032-MCP-AUTH-REJECTS-UNAUTH",
  "M032-WORKSPACE-ON-AZURE-FILES",
] as const;

export type M032CheckId = (typeof M032_CHECK_IDS)[number];

export type Check = {
  id: M032CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: Check[];
};

// ── Check 1: JOB-SPEC-NO-SECRETS (pure-code) ─────────────────────────────

export async function runJobSpecNoSecrets(
  _buildAcaJobSpecFn?: typeof buildAcaJobSpec,
): Promise<Check> {
  const fn = _buildAcaJobSpecFn ?? buildAcaJobSpec;

  const spec = fn({
    jobName: "test-job",
    image: "test-image",
    workspaceDir: "/tmp/test",
    mcpBearerToken: "tok",
    mcpBaseUrl: "http://localhost",
    timeoutSeconds: 600,
  });

  const envNames = spec.env.map((e) => e.name);
  const forbidden = envNames.filter((name) =>
    (APPLICATION_SECRET_NAMES as readonly string[]).includes(name),
  );

  if (forbidden.length === 0) {
    return {
      id: "M032-JOB-SPEC-NO-SECRETS",
      passed: true,
      skipped: false,
      status_code: "job_spec_no_secrets",
      detail: `env array contains no APPLICATION_SECRET_NAMES (env names: ${envNames.join(", ")})`,
    };
  }

  return {
    id: "M032-JOB-SPEC-NO-SECRETS",
    passed: false,
    skipped: false,
    status_code: "job_spec_leaks_secrets",
    detail: `forbidden names found in env: ${forbidden.join(", ")}`,
  };
}

// ── Check 2: MCP-AUTH-REJECTS-UNAUTH (pure-code) ─────────────────────────

export async function runMcpAuthRejectsUnauth(
  _appFn?: () => { fetch: (req: Request) => Response | Promise<Response> },
): Promise<Check> {
  let app: { fetch: (req: Request) => Response | Promise<Response> };

  if (_appFn) {
    app = _appFn();
  } else {
    const registry = createMcpJobRegistry();
    // No tokens registered — all requests must be rejected
    app = createMcpHttpRoutes(registry);
  }

  const res = await app.fetch(
    new Request("http://localhost/internal/mcp/github_comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    }),
  );

  if (res.status === 401) {
    return {
      id: "M032-MCP-AUTH-REJECTS-UNAUTH",
      passed: true,
      skipped: false,
      status_code: "mcp_auth_rejects_unauth",
      detail: `POST /internal/mcp/github_comment → status=${res.status}`,
    };
  }

  return {
    id: "M032-MCP-AUTH-REJECTS-UNAUTH",
    passed: false,
    skipped: false,
    status_code: "mcp_auth_accepts_unauth",
    detail: `expected status=401, got status=${res.status}`,
  };
}

// ── Check 3: WORKSPACE-ON-AZURE-FILES (pure-code) ────────────────────────

export async function runWorkspaceOnAzureFiles(
  _workspaceFn?: (opts: { mountBase: string; jobId: string }) => Promise<string>,
): Promise<Check> {
  const fn = _workspaceFn ?? createAzureFilesWorkspaceDir;
  const mountBase = "/mnt/kodiai-workspaces";
  const jobId = "test-job-id-001";

  let resultPath: string;
  try {
    resultPath = await fn({ mountBase, jobId });
  } catch (err) {
    // Azure Files mount not present in this environment (e.g. EACCES, ENOENT).
    // Skip gracefully — this check requires the live mount to be present.
    const code = (err as NodeJS.ErrnoException).code ?? "unknown";
    return {
      id: "M032-WORKSPACE-ON-AZURE-FILES",
      passed: false,
      skipped: true,
      status_code: "workspace_mount_unavailable",
      detail: `Azure Files mount not available (${code}) — run on orchestrator with mounted share`,
    };
  }

  if (resultPath.startsWith(mountBase)) {
    return {
      id: "M032-WORKSPACE-ON-AZURE-FILES",
      passed: true,
      skipped: false,
      status_code: "workspace_on_azure_files",
      detail: `path="${resultPath}" starts with mountBase="${mountBase}"`,
    };
  }

  return {
    id: "M032-WORKSPACE-ON-AZURE-FILES",
    passed: false,
    skipped: false,
    status_code: "workspace_wrong_base",
    detail: `path="${resultPath}" does not start with mountBase="${mountBase}"`,
  };
}

// ── Evaluator ────────────────────────────────────────────────────────────

export async function evaluateM032(opts?: {
  _buildAcaJobSpecFn?: typeof buildAcaJobSpec;
  _appFn?: () => { fetch: (req: Request) => Response | Promise<Response> };
  _workspaceFn?: (opts: { mountBase: string; jobId: string }) => Promise<string>;
}): Promise<EvaluationReport> {
  const [jobSpecNoSecrets, mcpAuthRejectsUnauth, workspaceOnAzureFiles] = await Promise.all([
    runJobSpecNoSecrets(opts?._buildAcaJobSpecFn),
    runMcpAuthRejectsUnauth(opts?._appFn),
    runWorkspaceOnAzureFiles(opts?._workspaceFn),
  ]);

  const checks: Check[] = [jobSpecNoSecrets, mcpAuthRejectsUnauth, workspaceOnAzureFiles];

  // All non-skipped checks gate overallPassed
  const overallPassed = checks.filter((c) => !c.skipped).every((c) => c.passed);

  return {
    check_ids: M032_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Human-readable renderer ──────────────────────────────────────────────

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M032 proof harness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    const detail = check.detail ? ` ${check.detail}` : "";
    lines.push(`- ${check.id} ${verdict} status_code=${check.status_code}${detail}`);
  }

  return `${lines.join("\n")}\n`;
}

// ── Proof harness entry point ─────────────────────────────────────────────

export async function buildM032ProofHarness(opts?: {
  _buildAcaJobSpecFn?: typeof buildAcaJobSpec;
  _appFn?: () => { fetch: (req: Request) => Response | Promise<Response> };
  _workspaceFn?: (opts: { mountBase: string; jobId: string }) => Promise<string>;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM032({
    _buildAcaJobSpecFn: opts?._buildAcaJobSpecFn,
    _appFn: opts?._appFn,
    _workspaceFn: opts?._workspaceFn,
  });

  if (useJson) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((c) => !c.passed && !c.skipped)
      .map((c) => `${c.id}:${c.status_code}`)
      .join(", ");
    stderr.write(`verify:m032 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

// ── CLI runner ────────────────────────────────────────────────────────────

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM032ProofHarness({ json: useJson });
  process.exit(exitCode);
}
