import { describe, expect, test } from "bun:test";
import {
  M041_S03_CHECK_IDS,
  evaluateM041S03,
  buildM041S03ProofHarness,
  runUnchangedFilePreservationCheck,
  runDriftDetectedByAuditCheck,
  runSelectiveRepairFixesOnlyDriftedRowsCheck,
  runRepairSkipsWhenNoDriftCheck,
  type M041S03SelectiveUpdateResult,
  type M041S03AuditResult,
  type M041S03RepairResult,
  type M041S03NoRepairNeededResult,
  type M041S03EvaluationReport,
} from "./verify-m041-s03.ts";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeSelectiveUpdateResult(
  overrides?: Partial<M041S03SelectiveUpdateResult["update"]>,
): M041S03SelectiveUpdateResult {
  return {
    update: {
      unchanged: 2,
      updated: 0,
      removed: 0,
      failed: 0,
      upsertCallCount: 0,
      deleteCallCount: 0,
      ...overrides,
    },
  };
}

function makePartialUpdateResult(
  overrides?: Partial<M041S03SelectiveUpdateResult["update"]>,
): M041S03SelectiveUpdateResult {
  return {
    update: {
      unchanged: 1,
      updated: 1,
      removed: 0,
      failed: 0,
      upsertCallCount: 1,
      deleteCallCount: 0,
      ...overrides,
    },
  };
}

function makeAuditResult(
  overrides?: Partial<M041S03AuditResult["audit"]>,
): M041S03AuditResult {
  return {
    audit: {
      status_code: "audit_failed",
      success: false,
      canonicalCodeStatus: "fail",
      canonicalCodeMissingOrNull: 1,
      canonicalCodeStale: 2,
      canonicalCodeModelMismatch: 3,
      ...overrides,
    },
  };
}

function makeCleanAuditResult(
  overrides?: Partial<M041S03AuditResult["audit"]>,
): M041S03AuditResult {
  return {
    audit: {
      status_code: "audit_ok",
      success: true,
      canonicalCodeStatus: "pass",
      canonicalCodeMissingOrNull: 0,
      canonicalCodeStale: 0,
      canonicalCodeModelMismatch: 0,
      ...overrides,
    },
  };
}

function makeRepairResult(
  overrides?: Partial<M041S03RepairResult["repair"]>,
): M041S03RepairResult {
  return {
    repair: {
      status_code: "repair_completed",
      success: true,
      processed: 3,
      repaired: 3,
      skipped: 0,
      failed: 0,
      embedCallCount: 3,
      writeCallCount: 3,
      ...overrides,
    },
  };
}

function makeNoRepairResult(
  overrides?: Partial<M041S03NoRepairNeededResult["noRepair"]>,
): M041S03NoRepairNeededResult {
  return {
    noRepair: {
      status_code: "repair_not_needed",
      success: true,
      processed: 0,
      repaired: 0,
      embedCallCount: 0,
      ...overrides,
    },
  };
}

// ── M041-S03-UNCHANGED-FILE-PRESERVATION ─────────────────────────────────────

describe("M041-S03-UNCHANGED-FILE-PRESERVATION", () => {
  test("passes against the real deterministic fixtures", async () => {
    const result = await runUnchangedFilePreservationCheck();

    expect(result.id).toBe("M041-S03-UNCHANGED-FILE-PRESERVATION");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("selective_update_preserves_unchanged_rows");
    expect(result.detail).toContain("unchanged_upserts=0");
    expect(result.detail).toContain("partial_upserts=1");
  });

  test("fails when the unchanged file still triggers upserts", async () => {
    const result = await runUnchangedFilePreservationCheck(
      async () => makeSelectiveUpdateResult({ upsertCallCount: 2, unchanged: 2 }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("selective_update_verification_failed");
    expect(result.detail).toContain("unchanged file: expected 0 upserts, got 2");
  });

  test("fails when unchanged chunk count is too low", async () => {
    const result = await runUnchangedFilePreservationCheck(
      async () => makeSelectiveUpdateResult({ unchanged: 1, upsertCallCount: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("expected >= 2 unchanged");
  });

  test("fails when partial update has no upserts", async () => {
    const result = await runUnchangedFilePreservationCheck(
      async () => makeSelectiveUpdateResult({ upsertCallCount: 0, unchanged: 2 }),
      async () => makePartialUpdateResult({ upsertCallCount: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("partial update: expected 1 upsert, got 0");
  });

  test("fails when partial update shows no unchanged rows", async () => {
    const result = await runUnchangedFilePreservationCheck(
      async () => makeSelectiveUpdateResult({ upsertCallCount: 0, unchanged: 2 }),
      async () => makePartialUpdateResult({ unchanged: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("expected >= 1 unchanged");
  });

  test("fails when delete is called on an unchanged file", async () => {
    const result = await runUnchangedFilePreservationCheck(
      async () => makeSelectiveUpdateResult({ deleteCallCount: 1 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("expected 0 deletes, got 1");
  });
});

// ── M041-S03-DRIFT-DETECTED-BY-AUDIT ─────────────────────────────────────────

describe("M041-S03-DRIFT-DETECTED-BY-AUDIT", () => {
  test("passes against the real deterministic fixtures", () => {
    const result = runDriftDetectedByAuditCheck();

    expect(result.id).toBe("M041-S03-DRIFT-DETECTED-BY-AUDIT");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("audit_surfaces_canonical_code_drift");
    expect(result.detail).toContain("drift_status_code=audit_failed");
    expect(result.detail).toContain("drift_canonical_status=fail");
    expect(result.detail).toContain("clean_status_code=audit_ok");
  });

  test("fails when drift scenario returns audit_ok instead of audit_failed", () => {
    const result = runDriftDetectedByAuditCheck(
      () => makeAuditResult({ status_code: "audit_ok", canonicalCodeStatus: "pass" }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("audit_drift_detection_failed");
    expect(result.detail).toContain("expected status_code=audit_failed");
  });

  test("fails when canonical_code is not marked fail in drift scenario", () => {
    const result = runDriftDetectedByAuditCheck(
      () => makeAuditResult({ canonicalCodeStatus: "warn" }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("canonical_code status=warn (expected fail)");
  });

  test("fails when missing_or_null is 0 in drift scenario", () => {
    const result = runDriftDetectedByAuditCheck(
      () => makeAuditResult({ canonicalCodeMissingOrNull: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("missing_or_null unexpectedly 0");
  });

  test("fails when model_mismatch is 0 in drift scenario", () => {
    const result = runDriftDetectedByAuditCheck(
      () => makeAuditResult({ canonicalCodeModelMismatch: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("model_mismatch unexpectedly 0");
  });

  test("fails when clean scenario does not return audit_ok", () => {
    const result = runDriftDetectedByAuditCheck(
      () => makeAuditResult(),
      () => makeCleanAuditResult({ status_code: "audit_warn", canonicalCodeStatus: "warn" }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("clean scenario: expected status_code=audit_ok");
  });
});

// ── M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS ────────────────────────

describe("M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS", () => {
  test("passes against the real deterministic fixture", async () => {
    const result = await runSelectiveRepairFixesOnlyDriftedRowsCheck();

    expect(result.id).toBe("M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("repair_targets_only_drifted_canonical_rows");
    expect(result.detail).toContain("repaired=3");
    expect(result.detail).toContain("embedCallCount=3");
  });

  test("fails when not all 3 drifted rows are repaired", async () => {
    const result = await runSelectiveRepairFixesOnlyDriftedRowsCheck(
      async () => makeRepairResult({ repaired: 2 }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("selective_repair_verification_failed");
    expect(result.detail).toContain("repaired=2 (expected 3)");
  });

  test("fails when the fresh row is also re-embedded (embedCallCount > 3)", async () => {
    const result = await runSelectiveRepairFixesOnlyDriftedRowsCheck(
      async () => makeRepairResult({ embedCallCount: 4, repaired: 4, writeCallCount: 4 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("embedCallCount=4 (expected 3");
  });

  test("fails when repair reports failure", async () => {
    const result = await runSelectiveRepairFixesOnlyDriftedRowsCheck(
      async () => makeRepairResult({ status_code: "repair_failed", success: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("status_code=repair_failed");
  });

  test("fails when there are repair failures", async () => {
    const result = await runSelectiveRepairFixesOnlyDriftedRowsCheck(
      async () => makeRepairResult({ failed: 1 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("failed=1 (expected 0)");
  });
});

// ── M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT ──────────────────────────────────────

describe("M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT", () => {
  test("passes against the real deterministic fixture", async () => {
    const result = await runRepairSkipsWhenNoDriftCheck();

    expect(result.id).toBe("M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("repair_reports_not_needed_when_corpus_is_fresh");
    expect(result.detail).toContain("status_code=repair_not_needed");
    expect(result.detail).toContain("embedCallCount=0");
  });

  test("fails when the no-drift scenario still triggers repair_completed", async () => {
    const result = await runRepairSkipsWhenNoDriftCheck(
      async () => makeNoRepairResult({ status_code: "repair_completed" }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("no_drift_repair_check_failed");
    expect(result.detail).toContain("status_code=repair_completed (expected repair_not_needed)");
  });

  test("fails when embed is called despite no drift", async () => {
    const result = await runRepairSkipsWhenNoDriftCheck(
      async () => makeNoRepairResult({ embedCallCount: 2, status_code: "repair_not_needed" }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("embedCallCount=2 (expected 0");
  });

  test("fails when rows are reported as repaired despite no drift", async () => {
    const result = await runRepairSkipsWhenNoDriftCheck(
      async () => makeNoRepairResult({ repaired: 1, status_code: "repair_not_needed" }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("repaired=1 (expected 0)");
  });
});

// ── evaluateM041S03 ───────────────────────────────────────────────────────────

describe("evaluateM041S03", () => {
  test("returns all four check ids and passes with real fixtures", async () => {
    const report = await evaluateM041S03();

    expect(report.check_ids).toStrictEqual(M041_S03_CHECK_IDS);
    expect(report.checks).toHaveLength(4);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((c) => c.passed && !c.skipped)).toBe(true);
  });

  test("overallPassed is false when a check fails", async () => {
    const report = await evaluateM041S03({
      _runUnchangedFile: async () =>
        makeSelectiveUpdateResult({ upsertCallCount: 99 }),
    });

    expect(report.overallPassed).toBe(false);
    const failedCheck = report.checks.find((c) => !c.passed);
    expect(failedCheck?.id).toBe("M041-S03-UNCHANGED-FILE-PRESERVATION");
  });

  test("individual check failures are isolated", async () => {
    const report = await evaluateM041S03({
      _runSelectiveRepair: async () => makeRepairResult({ repaired: 0, embedCallCount: 0, writeCallCount: 0 }),
    });

    expect(report.overallPassed).toBe(false);
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.id).toBe("M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS");
  });
});

// ── buildM041S03ProofHarness ──────────────────────────────────────────────────

describe("buildM041S03ProofHarness", () => {
  test("prints text output containing all four check ids and PASS", async () => {
    const chunks: string[] = [];
    const stdout = { write: (chunk: string) => void chunks.push(chunk) };
    const stderr = { write: (_chunk: string) => undefined };

    const { exitCode } = await buildM041S03ProofHarness({ stdout, stderr });
    const output = chunks.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("M041-S03-UNCHANGED-FILE-PRESERVATION");
    expect(output).toContain("M041-S03-DRIFT-DETECTED-BY-AUDIT");
    expect(output).toContain("M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS");
    expect(output).toContain("M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT");
    expect(output).toContain("Final verdict: PASS");
  });

  test("prints valid JSON in json mode with correct shape", async () => {
    const chunks: string[] = [];
    const stdout = { write: (chunk: string) => void chunks.push(chunk) };
    const stderr = { write: (_chunk: string) => undefined };

    await buildM041S03ProofHarness({ stdout, stderr, json: true });
    const parsed = JSON.parse(chunks.join("")) as M041S03EvaluationReport;

    expect(parsed.check_ids).toStrictEqual(Array.from(M041_S03_CHECK_IDS));
    expect(parsed.checks).toHaveLength(4);
    expect(parsed.overallPassed).toBe(true);
    expect(parsed.checks.every((c) => c.passed)).toBe(true);
  });

  test("returns exitCode 1 and stderr message when a check fails", async () => {
    const stdout = { write: (_chunk: string) => undefined };
    const stderrChunks: string[] = [];
    const stderr = { write: (chunk: string) => void stderrChunks.push(chunk) };

    const { exitCode } = await buildM041S03ProofHarness({
      stdout,
      stderr,
      _runNoRepair: async () =>
        makeNoRepairResult({ status_code: "repair_completed" }),
    });

    expect(exitCode).toBe(1);
    const stderrOut = stderrChunks.join("");
    expect(stderrOut).toContain("verify:m041:s03 failed");
    expect(stderrOut).toContain("M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT");
  });

  test("FAIL verdict appears in text output when a check fails", async () => {
    const chunks: string[] = [];
    const stdout = { write: (chunk: string) => void chunks.push(chunk) };
    const stderr = { write: (_chunk: string) => undefined };

    await buildM041S03ProofHarness({
      stdout,
      stderr,
      _runDriftAudit: () => ({
        audit: {
          status_code: "audit_ok",
          success: true,
          canonicalCodeStatus: "pass",
          canonicalCodeMissingOrNull: 0,
          canonicalCodeStale: 0,
          canonicalCodeModelMismatch: 0,
        },
      }),
    });
    const output = chunks.join("");

    expect(output).toContain("Final verdict: FAIL");
    expect(output).toContain("M041-S03-DRIFT-DETECTED-BY-AUDIT FAIL");
  });
});
