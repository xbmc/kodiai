import { describe, expect, test } from "bun:test";

type EmbeddingRepairCorpus = "review_comments" | "learning_memories" | "code_snippets" | "issues" | "issue_comments";

type RepairCliReport = {
  command: "repair:embeddings";
  mode: "repair" | "status";
  success: boolean;
  status_code: string;
  corpus: EmbeddingRepairCorpus;
  target_model: string;
  resumed: boolean;
  dry_run: boolean;
  run: {
    run_id: string;
    status: "running" | "completed" | "failed" | "resume_required" | "not_needed";
    corpus: EmbeddingRepairCorpus;
    batch_index: number | null;
    batches_total: number | null;
    last_row_id: number | null;
    processed: number;
    repaired: number;
    skipped: number;
    failed: number;
    failure_summary: {
      by_class: Record<string, number>;
      last_failure_class: string | null;
      last_failure_message: string | null;
    };
    updated_at: string;
  };
};

type AuditCorpusReport = {
  corpus: string;
  status: string;
  severity: string;
  expected_model: string;
  actual_models: string[];
  model_mismatch: number;
  missing_or_null: number;
};

type AuditReport = {
  success: boolean;
  status_code: string;
  overall_status: string;
  corpora: AuditCorpusReport[];
};

type VerifyM027S03Module = {
  parseVerifyM027S03Args: (args: string[]) => {
    help?: boolean;
    json?: boolean;
    corpus?: EmbeddingRepairCorpus;
  };
  evaluateM027S03Checks: (deps: {
    runRepair: () => Promise<RepairCliReport>;
    getRepairStatus: () => Promise<RepairCliReport>;
    runNoopProbe: () => Promise<RepairCliReport>;
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
    repair_evidence: RepairCliReport;
    status_evidence: RepairCliReport;
    noop_probe_evidence: RepairCliReport;
    audit_evidence: AuditReport;
  }>;
  renderM027S03Report: (report: {
    check_ids: string[];
    overallPassed: boolean;
    status_code: string;
    checks: Array<{
      id: string;
      passed: boolean;
      status_code: string;
      detail: string;
    }>;
    repair_evidence: RepairCliReport;
    status_evidence: RepairCliReport;
    noop_probe_evidence: RepairCliReport;
    audit_evidence: AuditReport;
  }) => string;
  main: (args: string[], deps?: {
    runRepair?: () => Promise<RepairCliReport>;
    getRepairStatus?: () => Promise<RepairCliReport>;
    runNoopProbe?: () => Promise<RepairCliReport>;
    runAudit?: () => Promise<AuditReport>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  }) => Promise<number> | number;
};

async function loadVerifyM027S03Module(): Promise<VerifyM027S03Module> {
  try {
    return await import("./verify-m027-s03.ts") as unknown as VerifyM027S03Module;
  } catch (error) {
    throw new Error(
      "Missing S03 implementation: expected scripts/verify-m027-s03.ts to export parseVerifyM027S03Args(), evaluateM027S03Checks(), renderM027S03Report(), and main() for bun run verify:m027:s03 -- --corpus <name> [--json].",
      { cause: error },
    );
  }
}

function makeRepairReport(overrides: Partial<RepairCliReport> = {}): RepairCliReport {
  return {
    command: "repair:embeddings",
    mode: "repair",
    success: true,
    status_code: "repair_completed",
    corpus: "review_comments",
    target_model: "voyage-code-3",
    resumed: false,
    dry_run: false,
    run: {
      run_id: "embedding-repair-review_comments-2026-03-12T12:00:00.000Z",
      status: "completed",
      corpus: "review_comments",
      batch_index: 1,
      batches_total: 2,
      last_row_id: 3033,
      processed: 4,
      repaired: 4,
      skipped: 0,
      failed: 0,
      failure_summary: {
        by_class: {},
        last_failure_class: null,
        last_failure_message: null,
      },
      updated_at: "2026-03-12T12:10:00.000Z",
    },
    ...overrides,
  };
}

function makeNoopProbeReport(overrides: Partial<RepairCliReport> = {}): RepairCliReport {
  return {
    command: "repair:embeddings",
    mode: "repair",
    success: true,
    status_code: "repair_not_needed",
    corpus: "issues",
    target_model: "voyage-code-3",
    resumed: false,
    dry_run: true,
    run: {
      run_id: "embedding-repair-issues-2026-03-12T12:20:00.000Z",
      status: "not_needed",
      corpus: "issues",
      batch_index: null,
      batches_total: null,
      last_row_id: null,
      processed: 0,
      repaired: 0,
      skipped: 0,
      failed: 0,
      failure_summary: {
        by_class: {},
        last_failure_class: null,
        last_failure_message: null,
      },
      updated_at: "2026-03-12T12:20:00.000Z",
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
        corpus: "review_comments",
        status: "pass",
        severity: "info",
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        model_mismatch: 0,
        missing_or_null: 0,
      },
      {
        corpus: "issues",
        status: "pass",
        severity: "info",
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        model_mismatch: 0,
        missing_or_null: 0,
      },
    ],
    ...overrides,
  };
}

describe("slice proof harness contract for scripts/verify-m027-s03.ts", () => {
  test("passes only when repair, persisted status, safe no-op probe, and scoped post-run audit all pass while preserving raw evidence envelopes", async () => {
    const module = await loadVerifyM027S03Module();

    const repair = makeRepairReport();
    const status = makeRepairReport({ mode: "status" });
    const noop = makeNoopProbeReport();
    const audit = makeAuditReport({
      success: false,
      status_code: "audit_failed",
      overall_status: "fail",
      corpora: [
        ...makeAuditReport().corpora,
        {
          corpus: "wiki_pages",
          status: "fail",
          severity: "critical",
          expected_model: "voyage-context-3",
          actual_models: ["voyage-context-3"],
          model_mismatch: 0,
          missing_or_null: 12,
        },
      ],
    });

    const report = await module.evaluateM027S03Checks({
      runRepair: async () => repair,
      getRepairStatus: async () => status,
      runNoopProbe: async () => noop,
      runAudit: async () => audit,
    });

    expect(report.check_ids).toEqual([
      "M027-S03-REPAIR",
      "M027-S03-STATUS",
      "M027-S03-NOOP",
      "M027-S03-AUDIT",
    ]);
    expect(report.overallPassed).toBe(true);
    expect(report.status_code).toBe("m027_s03_ok");
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M027-S03-REPAIR", passed: true, status_code: "repair_completed" }),
      expect.objectContaining({ id: "M027-S03-STATUS", passed: true, status_code: "repair_completed" }),
      expect.objectContaining({ id: "M027-S03-NOOP", passed: true, status_code: "repair_not_needed" }),
      expect.objectContaining({ id: "M027-S03-AUDIT", passed: true, status_code: "audit_failed" }),
    ]);
    expect(report.repair_evidence).toEqual(repair);
    expect(report.status_evidence).toEqual(status);
    expect(report.noop_probe_evidence).toEqual(noop);
    expect(report.audit_evidence).toEqual(audit);
  });

  test("fails loudly when repair status or no-op probe surface real failure-state metadata instead of flattening them into a generic verdict", async () => {
    const module = await loadVerifyM027S03Module();

    const report = await module.evaluateM027S03Checks({
      runRepair: async () => makeRepairReport(),
      getRepairStatus: async () => makeRepairReport({
        mode: "status",
        success: false,
        status_code: "repair_resume_available",
        run: {
          run_id: "embedding-repair-review_comments-2026-03-12T12:00:00.000Z",
          status: "resume_required",
          corpus: "review_comments",
          batch_index: 0,
          batches_total: 2,
          last_row_id: 1516,
          processed: 2,
          repaired: 2,
          skipped: 0,
          failed: 1,
          failure_summary: {
            by_class: { timeout_transient: 2 },
            last_failure_class: "timeout_transient",
            last_failure_message: "provider timed out after retry budget",
          },
          updated_at: "2026-03-12T12:05:00.000Z",
        },
      }),
      runNoopProbe: async () => makeNoopProbeReport({
        success: false,
        status_code: "repair_failed",
        run: {
          run_id: "embedding-repair-issues-2026-03-12T12:20:00.000Z",
          status: "failed",
          corpus: "issues",
          batch_index: 0,
          batches_total: 1,
          last_row_id: 9001,
          processed: 1,
          repaired: 0,
          skipped: 0,
          failed: 1,
          failure_summary: {
            by_class: { selection_contract_drift: 1 },
            last_failure_class: "selection_contract_drift",
            last_failure_message: "issues unexpectedly reported degraded rows",
          },
          updated_at: "2026-03-12T12:20:00.000Z",
        },
      }),
      runAudit: async () => makeAuditReport({
        success: false,
        status_code: "audit_failed",
        overall_status: "fail",
        corpora: [
          {
            corpus: "review_comments",
            status: "fail",
            severity: "critical",
            expected_model: "voyage-code-3",
            actual_models: ["voyage-code-3"],
            model_mismatch: 0,
            missing_or_null: 3,
          },
          {
            corpus: "issues",
            status: "pass",
            severity: "info",
            expected_model: "voyage-code-3",
            actual_models: ["voyage-code-3"],
            model_mismatch: 0,
            missing_or_null: 0,
          },
        ],
      }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.status_code).toBe("m027_s03_resume_required");
    expect(report.checks.find((check) => check.id === "M027-S03-STATUS")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "repair_resume_available",
        detail: expect.stringContaining("timeout_transient"),
      }),
    );
    expect(report.checks.find((check) => check.id === "M027-S03-NOOP")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "repair_failed",
        detail: expect.stringContaining("selection_contract_drift"),
      }),
    );
    expect(report.checks.find((check) => check.id === "M027-S03-AUDIT")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "audit_failed",
        detail: expect.stringContaining("review_comments:status=fail"),
      }),
    );

    const rendered = module.renderM027S03Report(report);
    expect(rendered).toContain("Final verdict: FAIL");
    expect(rendered).toContain("M027-S03-STATUS");
    expect(rendered).toContain("repair_resume_available");
    expect(rendered).toContain("M027-S03-NOOP");
    expect(rendered).toContain("selection_contract_drift");
  });

  test("main returns stable exit codes and surfaces repair, noop-probe, and audit failure codes in stderr for bun run verify:m027:s03", async () => {
    const module = await loadVerifyM027S03Module();

    const okStdout: string[] = [];
    const okExit = await module.main(["--corpus", "review_comments", "--json"], {
      runRepair: async () => makeRepairReport(),
      getRepairStatus: async () => makeRepairReport({ mode: "status" }),
      runNoopProbe: async () => makeNoopProbeReport(),
      runAudit: async () => makeAuditReport(),
      stdout: { write: (chunk: string) => void okStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(okExit).toBe(0);
    expect(JSON.parse(okStdout.join(""))).toMatchObject({
      overallPassed: true,
      status_code: "m027_s03_ok",
      check_ids: ["M027-S03-REPAIR", "M027-S03-STATUS", "M027-S03-NOOP", "M027-S03-AUDIT"],
    });

    const failStderr: string[] = [];
    const failExit = await module.main(["--corpus", "review_comments", "--json"], {
      runRepair: async () => makeRepairReport({
        success: false,
        status_code: "repair_failed",
        run: {
          run_id: "embedding-repair-review_comments-2026-03-12T12:00:00.000Z",
          status: "failed",
          corpus: "review_comments",
          batch_index: 0,
          batches_total: 2,
          last_row_id: 1516,
          processed: 2,
          repaired: 2,
          skipped: 0,
          failed: 1,
          failure_summary: {
            by_class: { timeout_transient: 2 },
            last_failure_class: "timeout_transient",
            last_failure_message: "provider timed out after retry budget",
          },
          updated_at: "2026-03-12T12:06:00.000Z",
        },
      }),
      getRepairStatus: async () => makeRepairReport({ mode: "status" }),
      runNoopProbe: async () => makeNoopProbeReport({
        success: false,
        status_code: "repair_failed",
        run: {
          run_id: "embedding-repair-issues-2026-03-12T12:20:00.000Z",
          status: "failed",
          corpus: "issues",
          batch_index: 0,
          batches_total: 1,
          last_row_id: 9001,
          processed: 1,
          repaired: 0,
          skipped: 0,
          failed: 1,
          failure_summary: {
            by_class: { selection_contract_drift: 1 },
            last_failure_class: "selection_contract_drift",
            last_failure_message: "issues unexpectedly reported degraded rows",
          },
          updated_at: "2026-03-12T12:20:00.000Z",
        },
      }),
      runAudit: async () => makeAuditReport({
        success: false,
        status_code: "audit_failed",
        overall_status: "fail",
        corpora: [
          {
            corpus: "review_comments",
            status: "fail",
            severity: "critical",
            expected_model: "voyage-code-3",
            actual_models: ["voyage-code-3"],
            model_mismatch: 0,
            missing_or_null: 1,
          },
          {
            corpus: "issues",
            status: "pass",
            severity: "info",
            expected_model: "voyage-code-3",
            actual_models: ["voyage-code-3"],
            model_mismatch: 0,
            missing_or_null: 0,
          },
        ],
      }),
      stdout: { write: () => undefined },
      stderr: { write: (chunk: string) => void failStderr.push(chunk) },
    });

    expect(failExit).toBe(1);
    expect(failStderr.join(" ")).toContain("verify:m027:s03 failed");
    expect(failStderr.join(" ")).toContain("repair_failed");
    expect(failStderr.join(" ")).toContain("audit_failed");
    expect(failStderr.join(" ")).toContain("timeout_transient");
    expect(failStderr.join(" ")).toContain("selection_contract_drift");
  });
});
