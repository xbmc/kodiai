import { describe, test, expect } from "bun:test";
import {
  M032_CHECK_IDS,
  evaluateM032,
  buildM032ProofHarness,
  runJobSpecNoSecrets,
  runMcpAuthRejectsUnauth,
  runWorkspaceOnAzureFiles,
} from "./verify-m032.ts";
import type { EvaluationReport } from "./verify-m032.ts";
import type { buildAcaJobSpec } from "../src/jobs/aca-launcher.ts";

// ── M032-JOB-SPEC-NO-SECRETS ──────────────────────────────────────────────

describe("M032-JOB-SPEC-NO-SECRETS", () => {
  test("pass: real buildAcaJobSpec has no forbidden names", async () => {
    const result = await runJobSpecNoSecrets();
    expect(result.id).toBe("M032-JOB-SPEC-NO-SECRETS");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("job_spec_no_secrets");
    expect(result.detail).toContain("MCP_BEARER_TOKEN");
  });

  test("fail: _fn injects a forbidden name into env", async () => {
    const broken: typeof buildAcaJobSpec = (opts) => ({
      jobName: opts.jobName,
      image: opts.image,
      workspaceDir: opts.workspaceDir,
      env: [
        { name: "MCP_BEARER_TOKEN", value: opts.mcpBearerToken },
        { name: "DATABASE_URL", value: "postgres://leaked" }, // forbidden
        { name: "GITHUB_PRIVATE_KEY", value: "pem-data" }, // also forbidden
      ],
      timeoutSeconds: opts.timeoutSeconds ?? 600,
    });
    const result = await runJobSpecNoSecrets(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("job_spec_leaks_secrets");
    expect(result.detail).toContain("DATABASE_URL");
    expect(result.detail).toContain("GITHUB_PRIVATE_KEY");
  });

  test("fail: _fn injects a single forbidden name", async () => {
    const broken: typeof buildAcaJobSpec = (opts) => ({
      jobName: opts.jobName,
      image: opts.image,
      workspaceDir: opts.workspaceDir,
      env: [
        { name: "SLACK_BOT_TOKEN", value: "xoxb-leaked" }, // forbidden
      ],
      timeoutSeconds: opts.timeoutSeconds ?? 600,
    });
    const result = await runJobSpecNoSecrets(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("job_spec_leaks_secrets");
    expect(result.detail).toContain("SLACK_BOT_TOKEN");
  });
});

// ── M032-MCP-AUTH-REJECTS-UNAUTH ──────────────────────────────────────────

describe("M032-MCP-AUTH-REJECTS-UNAUTH", () => {
  test("pass: real createMcpHttpRoutes returns 401 for unauthenticated request", async () => {
    const result = await runMcpAuthRejectsUnauth();
    expect(result.id).toBe("M032-MCP-AUTH-REJECTS-UNAUTH");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("mcp_auth_rejects_unauth");
    expect(result.detail).toContain("status=401");
  });

  test("fail: _appFn returns 200 (auth not enforced)", async () => {
    const broken = () => ({
      fetch: (_req: Request) => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
    const result = await runMcpAuthRejectsUnauth(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("mcp_auth_accepts_unauth");
    expect(result.detail).toContain("expected status=401");
    expect(result.detail).toContain("got status=200");
  });

  test("fail: _appFn returns 403 (wrong rejection code)", async () => {
    const broken = () => ({
      fetch: (_req: Request) => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });
    const result = await runMcpAuthRejectsUnauth(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("mcp_auth_accepts_unauth");
    expect(result.detail).toContain("got status=403");
  });
});

// ── M032-WORKSPACE-ON-AZURE-FILES ─────────────────────────────────────────

describe("M032-WORKSPACE-ON-AZURE-FILES", () => {
  test("pass: stub returns path under mountBase", async () => {
    const stub = async (opts: { mountBase: string; jobId: string }) =>
      `${opts.mountBase}/${opts.jobId}`;
    const result = await runWorkspaceOnAzureFiles(stub);
    expect(result.id).toBe("M032-WORKSPACE-ON-AZURE-FILES");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("workspace_on_azure_files");
    expect(result.detail).toContain("/mnt/kodiai-workspaces");
  });

  test("fail: stub returns path outside mountBase", async () => {
    const broken = async (_opts: { mountBase: string; jobId: string }) => "/tmp/other/test-job";
    const result = await runWorkspaceOnAzureFiles(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("workspace_wrong_base");
    expect(result.detail).toContain("/tmp/other/test-job");
    expect(result.detail).toContain("does not start with mountBase");
  });

  test("fail: stub returns completely wrong base", async () => {
    const broken = async (_opts: { mountBase: string; jobId: string }) =>
      "/var/data/workspaces/test-job";
    const result = await runWorkspaceOnAzureFiles(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("workspace_wrong_base");
    expect(result.detail).toContain("does not start with mountBase");
  });
});

// ── Envelope ─────────────────────────────────────────────────────────────

describe("envelope", () => {
  test("M032_CHECK_IDS has length 3", () => {
    expect(M032_CHECK_IDS.length).toBe(3);
  });

  test("overallPassed is true when all checks pass with stubs", async () => {
    const workspaceStub = async (opts: { mountBase: string; jobId: string }) =>
      `${opts.mountBase}/${opts.jobId}`;
    const report = await evaluateM032({ _workspaceFn: workspaceStub });
    expect(report.checks.length).toBe(3);
    expect(report.check_ids).toStrictEqual(M032_CHECK_IDS);
    const nonSkipped = report.checks.filter((c) => !c.skipped);
    expect(nonSkipped.every((c) => c.passed)).toBe(report.overallPassed);
    expect(report.overallPassed).toBe(true);
  });

  test("overallPassed is false when one check fails", async () => {
    const brokenApp = () => ({
      fetch: (_req: Request) => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
    const workspaceStub = async (opts: { mountBase: string; jobId: string }) =>
      `${opts.mountBase}/${opts.jobId}`;
    const report = await evaluateM032({ _appFn: brokenApp, _workspaceFn: workspaceStub });
    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((c) => !c.passed && !c.skipped);
    expect(failing.length).toBeGreaterThanOrEqual(1);
    expect(failing[0]!.id).toBe("M032-MCP-AUTH-REJECTS-UNAUTH");
  });

  test("overallPassed is false when workspace check fails", async () => {
    const brokenWorkspace = async (_opts: { mountBase: string; jobId: string }) =>
      "/tmp/wrong-place";
    const report = await evaluateM032({ _workspaceFn: brokenWorkspace });
    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((c) => !c.passed && !c.skipped);
    expect(failing.some((c) => c.id === "M032-WORKSPACE-ON-AZURE-FILES")).toBe(true);
  });

  test("no checks are skipped (all pure-code)", async () => {
    const workspaceStub = async (opts: { mountBase: string; jobId: string }) =>
      `${opts.mountBase}/${opts.jobId}`;
    const report = await evaluateM032({ _workspaceFn: workspaceStub });
    const skipped = report.checks.filter((c) => c.skipped);
    expect(skipped.length).toBe(0);
  });
});

// ── buildM032ProofHarness ─────────────────────────────────────────────────

describe("buildM032ProofHarness", () => {
  const workspaceStub = async (opts: { mountBase: string; jobId: string }) =>
    `${opts.mountBase}/${opts.jobId}`;

  test("stdout contains check IDs in text mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };
    await buildM032ProofHarness({ stdout, stderr, _workspaceFn: workspaceStub });
    const output = chunks.join("");
    expect(output).toContain("M032-JOB-SPEC-NO-SECRETS");
    expect(output).toContain("M032-MCP-AUTH-REJECTS-UNAUTH");
    expect(output).toContain("M032-WORKSPACE-ON-AZURE-FILES");
    expect(output).toContain("Final verdict:");
  });

  test("stdout is valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };
    await buildM032ProofHarness({ stdout, stderr, json: true, _workspaceFn: workspaceStub });
    const output = chunks.join("");
    const parsed = JSON.parse(output) as EvaluationReport;
    expect(parsed.check_ids).toStrictEqual(Array.from(M032_CHECK_IDS));
    expect(typeof parsed.overallPassed).toBe("boolean");
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBe(3);
  });

  test("exit code 0 when all checks pass", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderr = { write: (_s: string) => {} };
    const { exitCode } = await buildM032ProofHarness({ stdout, stderr, _workspaceFn: workspaceStub });
    expect(exitCode).toBe(0);
  });

  test("exit code 1 and stderr message when MCP check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderrChunks: string[] = [];
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };
    const brokenApp = () => ({
      fetch: (_req: Request) => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
    const { exitCode } = await buildM032ProofHarness({
      stdout,
      stderr,
      _appFn: brokenApp,
      _workspaceFn: workspaceStub,
    });
    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m032 failed");
  });

  test("exit code 1 when workspace check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderr = { write: (_s: string) => {} };
    const brokenWorkspace = async (_opts: { mountBase: string; jobId: string }) => "/tmp/wrong";
    const { exitCode } = await buildM032ProofHarness({
      stdout,
      stderr,
      _workspaceFn: brokenWorkspace,
    });
    expect(exitCode).toBe(1);
  });
});
