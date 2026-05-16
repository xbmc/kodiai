import { describe, expect, test } from "bun:test";
import {
  evaluateM067S02GraphValidationContract,
  main,
  type M067S02Check,
  type M067S02Report,
} from "./verify-m067-s02.ts";

function checkById(report: M067S02Report, id: string): M067S02Check {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (!check) {
    throw new Error(`missing check ${id}`);
  }
  return check;
}

describe("evaluateM067S02GraphValidationContract", () => {
  test("returns a successful deterministic report covering config, plan details, and validation semantics", async () => {
    const report = await evaluateM067S02GraphValidationContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
    });

    expect(report.command).toBe("verify:m067:s02");
    expect(report.generated_at).toBe("2026-05-09T17:00:00.000Z");
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m067_s02_ok");
    expect(report.issues).toEqual([]);
    expect(report.check_ids).toEqual([
      "CONFIG-REACHABILITY",
      "PLAN-DETAILS-STATES",
      "VALIDATION-SEMANTICS",
      "NO-RAW-LEAKS",
    ]);
    expect(report.checks.every((check) => check.passed)).toBe(true);

    expect(report.config.enabled_value).toBe(true);
    expect(report.config.default_value).toBe(false);
    expect(report.config.enabled_warning_count).toBe(0);

    expect(report.scenarios.map((scenario) => scenario.actual_status).sort()).toEqual([
      "applied",
      "enabled",
      "skipped",
      "unavailable",
    ]);
    for (const scenario of report.scenarios) {
      expect(scenario.review_plan_line_count).toBe(1);
      expect(scenario.review_plan_line).toContain(`graph=${scenario.actual_status}`);
      expect(scenario.review_plan_line.length).toBeLessThanOrEqual(242);
    }

    expect(report.validation.disabled.succeeded).toBe(true);
    expect(report.validation.disabled.validatedCount).toBe(0);
    expect(report.validation.disabled.verdicts).toEqual(["skipped", "skipped"]);
    expect(report.validation.applied.succeeded).toBe(true);
    expect(report.validation.applied.validatedCount).toBe(2);
    expect(report.validation.applied.confirmedCount).toBe(1);
    expect(report.validation.applied.uncertainCount).toBe(1);
    expect(report.validation.applied.verdicts).toEqual(["confirmed", "uncertain", "skipped"]);
  });

  test("renders bounded Review Details lines for each status without raw fixture data", async () => {
    const report = await evaluateM067S02GraphValidationContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
    });

    for (const status of ["enabled", "unavailable", "skipped", "applied"] as const) {
      const scenario = report.scenarios.find((candidate) => candidate.actual_status === status);
      expect(scenario).toBeDefined();
      expect(scenario?.review_plan_line_count).toBe(1);
      expect(scenario?.review_plan_line).toStartWith("Review plan: ready hash=");
      expect(scenario?.review_plan_line).toContain(`graph=${status}`);
      expect(scenario?.review_plan_line).not.toContain("PROMPT_SECRET");
      expect(scenario?.review_plan_line).not.toContain("diff --git");
      expect(scenario?.review_plan_line).not.toContain("TOKEN=");
      expect(scenario?.review_plan_line).not.toContain("super-secret");
    }

    expect(checkById(report, "PLAN-DETAILS-STATES").passed).toBe(true);
    expect(checkById(report, "NO-RAW-LEAKS").passed).toBe(true);
  });

  test("emits a failing report when an overridden config reachability check fails", async () => {
    const report = await evaluateM067S02GraphValidationContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      overrides: {
        loadEnabledConfigFn: async () => ({ enabled: false, warningCount: 0 }),
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m067_s02_contract_failed");
    expect(report.failing_check_id).toBe("CONFIG-REACHABILITY");
    expect(report.issues.join("\n")).toContain("enabled fixture parsed false");
    expect(checkById(report, "CONFIG-REACHABILITY").passed).toBe(false);
  });
});

describe("main", () => {
  test("prints parseable JSON for the successful verifier report", async () => {
    let stdout = "";
    const exitCode = await main(["--json"], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: () => undefined },
      evaluateFn: () => Promise.resolve({
        command: "verify:m067:s02",
        generated_at: "2026-05-09T17:00:00.000Z",
        success: true,
        status_code: "m067_s02_ok",
        check_ids: ["CONFIG-REACHABILITY"],
        checks: [{
          id: "CONFIG-REACHABILITY",
          passed: true,
          status_code: "config_reachability_ok",
          detail: "config reached typed review.graphValidation.enabled",
        }],
        failing_check_id: null,
        issues: [],
        config: {
          enabled_value: true,
          default_value: false,
          enabled_warning_count: 0,
          default_warning_count: 0,
        },
        scenarios: [],
        validation: {
          disabled: { succeeded: true, validatedCount: 0, confirmedCount: 0, uncertainCount: 0, verdicts: [] },
          applied: { succeeded: true, validatedCount: 0, confirmedCount: 0, uncertainCount: 0, verdicts: [] },
        },
      } as M067S02Report),
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).status_code).toBe("m067_s02_ok");
  });

  test("returns nonzero and JSON when evaluator checks fail", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await main(["--json"], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
      evaluateFn: () => Promise.resolve({
        command: "verify:m067:s02",
        generated_at: "2026-05-09T17:00:00.000Z",
        success: false,
        status_code: "m067_s02_contract_failed",
        check_ids: ["VALIDATION-SEMANTICS"],
        checks: [{
          id: "VALIDATION-SEMANTICS",
          passed: false,
          status_code: "validation_semantics_invalid",
          detail: "applied validation did not validate graph-amplified findings",
        }],
        failing_check_id: "VALIDATION-SEMANTICS",
        issues: ["VALIDATION-SEMANTICS: applied validation did not validate graph-amplified findings"],
        config: {
          enabled_value: true,
          default_value: false,
          enabled_warning_count: 0,
          default_warning_count: 0,
        },
        scenarios: [],
        validation: {
          disabled: { succeeded: true, validatedCount: 0, confirmedCount: 0, uncertainCount: 0, verdicts: [] },
          applied: { succeeded: false, validatedCount: 0, confirmedCount: 0, uncertainCount: 0, verdicts: [] },
        },
      } as M067S02Report),
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).failing_check_id).toBe("VALIDATION-SEMANTICS");
    expect(stderr).toContain("verify:m067:s02 failed: VALIDATION-SEMANTICS");
  });
});
