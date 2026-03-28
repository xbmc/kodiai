import { describe, expect, test } from "bun:test";

type RepairProofReport = {
  command: "repair:wiki-embeddings";
  mode: "repair" | "status";
  success: boolean;
  status_code: string;
  target_model: string;
  requested_page_title: string | null;
  resumed: boolean;
  run: {
    run_id: string;
    status: "running" | "completed" | "failed" | "resume_required";
    page_id: number | null;
    page_title: string | null;
    window_index: number | null;
    windows_total: number | null;
    repaired: number;
    skipped: number;
    failed: number;
    retry_count: number;
    failure_summary: {
      by_class: Record<string, number>;
      last_failure_class: string | null;
      last_failure_message: string | null;
    };
    used_split_fallback: boolean;
    updated_at: string;
  };
};

type AuditReport = {
  success: boolean;
  status_code: string;
  overall_status: string;
  corpora: Array<{
    corpus: string;
    status: string;
    severity: string;
    expected_model: string;
    actual_models: string[];
    model_mismatch: number;
    missing_or_null: number;
  }>;
};

type VerifyM027S02Module = {
  parseVerifyM027S02Args: (args: string[]) => {
    help?: boolean;
    json?: boolean;
    pageTitle?: string;
  };
  evaluateM027S02Checks: (deps: {
    runRepair: () => Promise<RepairProofReport>;
    getRepairStatus: () => Promise<RepairProofReport>;
    runAudit: () => Promise<AuditReport>;
  }) => Promise<{
    check_ids: string[];
    overallPassed: boolean;
    status_code: string;
    checks: Array<{
      id: string;
      passed: boolean;
      status_code: string;
      detail: string;
    }>;
    repair_evidence: RepairProofReport;
    status_evidence: RepairProofReport;
    audit_evidence: AuditReport;
  }>;
  renderM027S02Report: (report: {
    check_ids: string[];
    overallPassed: boolean;
    status_code: string;
    checks: Array<{
      id: string;
      passed: boolean;
      status_code: string;
      detail: string;
    }>;
    repair_evidence: RepairProofReport;
    status_evidence: RepairProofReport;
    audit_evidence: AuditReport;
  }) => string;
  main: (args: string[], deps?: {
    runRepair?: () => Promise<RepairProofReport>;
    getRepairStatus?: () => Promise<RepairProofReport>;
    runAudit?: () => Promise<AuditReport>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  }) => Promise<number> | number;
};

async function loadVerifyM027S02Module(): Promise<VerifyM027S02Module> {
  try {
    return await import("./verify-m027-s02.ts") as unknown as VerifyM027S02Module;
  } catch (error) {
    throw new Error(
      "Missing S02 implementation: expected scripts/verify-m027-s02.ts to export parseVerifyM027S02Args(), evaluateM027S02Checks(), renderM027S02Report(), and main() for bun run verify:m027:s02 -- --page-title <title> [--json].",
      { cause: error },
    );
  }
}

function makeRepairReport(overrides: Partial<RepairProofReport> = {}): RepairProofReport {
  return {
    command: "repair:wiki-embeddings",
    mode: "repair",
    success: true,
    status_code: "repair_completed",
    target_model: "voyage-context-3",
    requested_page_title: "JSON-RPC API/v8",
    resumed: false,
    run: {
      run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
      status: "completed",
      page_id: 881,
      page_title: "JSON-RPC API/v8",
      window_index: 3,
      windows_total: 4,
      repaired: 12,
      skipped: 0,
      failed: 0,
      retry_count: 1,
      failure_summary: {
        by_class: { timeout_transient: 1 },
        last_failure_class: null,
        last_failure_message: null,
      },
      used_split_fallback: true,
      updated_at: "2026-03-12T12:10:00.000Z",
    },
    ...overrides,
  };
}

function makeAuditReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    success: true,
    status_code: "audit_ok",
    overall_status: "pass",
    corpora: [
      {
        corpus: "wiki_pages",
        status: "pass",
        severity: "info",
        expected_model: "voyage-context-3",
        actual_models: ["voyage-context-3"],
        model_mismatch: 0,
        missing_or_null: 0,
      },
    ],
    ...overrides,
  };
}

describe("slice proof harness contract for scripts/verify-m027-s02.ts", () => {
  test("passes only when repair run, persisted status evidence, and post-run wiki audit all pass while preserving raw evidence payloads", async () => {
    const module = await loadVerifyM027S02Module();

    const repair = makeRepairReport();
    const status = makeRepairReport({ mode: "status" });
    const audit = makeAuditReport();

    const report = await module.evaluateM027S02Checks({
      runRepair: async () => repair,
      getRepairStatus: async () => status,
      runAudit: async () => audit,
    });

    expect(report.check_ids).toEqual([
      "M027-S02-REPAIR",
      "M027-S02-STATUS",
      "M027-S02-AUDIT",
    ]);
    expect(report.overallPassed).toBe(true);
    expect(report.status_code).toBe("m027_s02_ok");
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M027-S02-REPAIR",
        passed: true,
        status_code: "repair_completed",
      }),
      expect.objectContaining({
        id: "M027-S02-STATUS",
        passed: true,
        status_code: "repair_completed",
      }),
      expect.objectContaining({
        id: "M027-S02-AUDIT",
        passed: true,
        status_code: "audit_ok",
      }),
    ]);
    expect(report.repair_evidence).toEqual(repair);
    expect(report.status_evidence).toEqual(status);
    expect(report.audit_evidence).toEqual(audit);
  });

  test("fails loudly when status evidence says the run is resume-required instead of collapsing that into a generic proof failure", async () => {
    const module = await loadVerifyM027S02Module();

    const report = await module.evaluateM027S02Checks({
      runRepair: async () => makeRepairReport(),
      getRepairStatus: async () => makeRepairReport({
        mode: "status",
        success: false,
        status_code: "repair_resume_available",
        run: {
          run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
          status: "resume_required",
          page_id: 881,
          page_title: "JSON-RPC API/v8",
          window_index: 1,
          windows_total: 4,
          repaired: 6,
          skipped: 0,
          failed: 1,
          retry_count: 2,
          failure_summary: {
            by_class: { timeout_transient: 2, request_too_large: 1 },
            last_failure_class: "timeout_transient",
            last_failure_message: "provider timed out after retry budget",
          },
          used_split_fallback: true,
          updated_at: "2026-03-12T12:05:00.000Z",
        },
      }),
      runAudit: async () => makeAuditReport(),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.status_code).toBe("m027_s02_resume_required");
    expect(report.checks.find((check) => check.id === "M027-S02-STATUS")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "repair_resume_available",
        detail: expect.stringContaining("timeout_transient"),
      }),
    );

    const rendered = module.renderM027S02Report(report);
    expect(rendered).toContain("Final verdict: FAIL");
    expect(rendered).toContain("M027-S02-STATUS");
    expect(rendered).toContain("repair_resume_available");
    expect(rendered).toContain("timeout_transient");
  });

  test("main returns stable exit codes and surfaces repair or audit failure classes in stderr for bun run verify:m027:s02", async () => {
    const module = await loadVerifyM027S02Module();

    const okStdout: string[] = [];
    const okExit = await module.main(["--page-title", "JSON-RPC API/v8", "--json"], {
      runRepair: async () => makeRepairReport(),
      getRepairStatus: async () => makeRepairReport({ mode: "status" }),
      runAudit: async () => makeAuditReport(),
      stdout: { write: (chunk: string) => void okStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(okExit).toBe(0);
    expect(JSON.parse(okStdout.join(""))).toMatchObject({
      overallPassed: true,
      status_code: "m027_s02_ok",
      check_ids: ["M027-S02-REPAIR", "M027-S02-STATUS", "M027-S02-AUDIT"],
    });

    const failStderr: string[] = [];
    const failExit = await module.main(["--page-title", "JSON-RPC API/v8", "--json"], {
      runRepair: async () => makeRepairReport({
        success: false,
        status_code: "repair_failed",
        run: {
          run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
          status: "failed",
          page_id: 881,
          page_title: "JSON-RPC API/v8",
          window_index: 2,
          windows_total: 4,
          repaired: 8,
          skipped: 0,
          failed: 2,
          retry_count: 2,
          failure_summary: {
            by_class: { timeout_transient: 2 },
            last_failure_class: "timeout_transient",
            last_failure_message: "provider timed out after retry budget",
          },
          used_split_fallback: true,
          updated_at: "2026-03-12T12:06:00.000Z",
        },
      }),
      getRepairStatus: async () => makeRepairReport({ mode: "status" }),
      runAudit: async () => makeAuditReport({
        success: false,
        status_code: "audit_failed",
        overall_status: "fail",
        corpora: [
          {
            corpus: "wiki_pages",
            status: "fail",
            severity: "critical",
            expected_model: "voyage-context-3",
            actual_models: ["voyage-code-3"],
            model_mismatch: 12,
            missing_or_null: 0,
          },
        ],
      }),
      stdout: { write: () => undefined },
      stderr: { write: (chunk: string) => void failStderr.push(chunk) },
    });

    expect(failExit).toBe(1);
    expect(failStderr.join(" ")).toContain("verify:m027:s02 failed");
    expect(failStderr.join(" ")).toContain("repair_failed");
    expect(failStderr.join(" ")).toContain("audit_failed");
    expect(failStderr.join(" ")).toContain("timeout_transient");
  });
});
