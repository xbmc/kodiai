import { describe, expect, test } from "bun:test";
import {
  evaluateM067S01ReviewPlanContract,
  main,
  type M067S01Check,
} from "./verify-m067-s01.ts";

function checkById(report: Awaited<ReturnType<typeof evaluateM067S01ReviewPlanContract>>, id: M067S01Check["id"]): M067S01Check {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (!check) {
    throw new Error(`missing check ${id}`);
  }
  return check;
}

describe("evaluateM067S01ReviewPlanContract", () => {
  test("returns a successful deterministic report for the representative ready review plan", () => {
    const report = evaluateM067S01ReviewPlanContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
    });

    expect(report.command).toBe("verify:m067:s01");
    expect(report.generated_at).toBe("2026-05-09T17:00:00.000Z");
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m067_s01_ok");
    expect(report.issues).toEqual([]);
    expect(report.ready_plan.status).toBe("ready");
    expect(report.ready_plan.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(checkById(report, "READY-PLAN-HASH").detail).toContain(report.ready_plan.hash.slice(0, 12));
  });

  test("renders exactly one compact ready Review plan line plus the Review Details marker without raw plan data", () => {
    const report = evaluateM067S01ReviewPlanContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
    });

    expect(report.review_details.ready.marker_count).toBe(1);
    expect(report.review_details.ready.review_plan_line_count).toBe(1);
    expect(report.review_details.ready.review_plan_line).toStartWith("- Review plan: ready hash=");
    expect(report.review_details.ready.review_plan_line.length).toBeLessThanOrEqual(242);
    expect(report.review_details.ready.review_plan_line).toContain("route=standard");
    expect(report.review_details.ready.review_plan_line).toContain("graph=enabled");
    expect(report.review_details.ready.review_plan_line).toContain("candidates=shadow");
    expect(report.review_details.ready.review_plan_line).not.toContain("PROMPT_SECRET");
    expect(report.review_details.ready.review_plan_line).not.toContain("diff --git");
    expect(report.review_details.ready.review_plan_line).not.toContain("TOKEN=");
    expect(report.review_details.ready.review_plan_line).not.toContain("{\"");
  });

  test("reports degraded plan rendering without failing the verifier", () => {
    const report = evaluateM067S01ReviewPlanContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
    });

    expect(report.degraded_plan.status).toBe("degraded");
    expect(report.degraded_plan.hash).toMatch(/^degraded-[a-f0-9]{16}$/);
    expect(report.review_details.degraded.review_plan_line_count).toBe(1);
    expect(report.review_details.degraded.review_plan_line).toContain("Review plan: degraded");
    expect(report.review_details.degraded.review_plan_line).toContain("graph=skipped");
    expect(checkById(report, "DEGRADED-PLAN-RENDERING").passed).toBe(true);
  });

  test("emits issues and a failing status when a required Review Details check fails", () => {
    const report = evaluateM067S01ReviewPlanContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      overrides: {
        formatReviewDetailsSummaryFn: () => [
          "<details>",
          "<summary>Review Details</summary>",
          "- Review plan: ready hash=abc route=standard",
          "- Review plan: ready hash=def route=duplicate diff --git a/secret b/secret PROMPT_SECRET TOKEN=abc123 {\"raw\":true}",
          "<!-- kodiai:review-details:m067-s01-ready -->",
        ].join("\n"),
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m067_s01_contract_failed");
    expect(report.failing_check_id).toBe("READY-REVIEW-DETAILS-COMPACT");
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues.join("\n")).toContain("expected exactly one compact Review plan line");
    expect(checkById(report, "READY-REVIEW-DETAILS-COMPACT").passed).toBe(false);
  });
});

describe("main", () => {
  test("returns JSON and exits nonzero when evaluator checks fail", async () => {
    let stdout = "";
    const exitCode = await main(["--json"], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: () => undefined },
      evaluateFn: () => ({
        command: "verify:m067:s01",
        generated_at: "2026-05-09T17:00:00.000Z",
        success: false,
        status_code: "m067_s01_contract_failed",
        check_ids: ["READY-PLAN-HASH"],
        checks: [{
          id: "READY-PLAN-HASH",
          passed: false,
          status_code: "ready_plan_hash_missing",
          detail: "ready plan hash missing",
        }],
        failing_check_id: "READY-PLAN-HASH",
        issues: ["READY-PLAN-HASH: ready plan hash missing"],
        ready_plan: { status: "ready", hash: "" },
        degraded_plan: { status: "degraded", hash: "degraded-0000000000000000" },
        review_details: {
          ready: { marker_count: 0, review_plan_line_count: 0, review_plan_line: "" },
          degraded: { marker_count: 0, review_plan_line_count: 0, review_plan_line: "" },
        },
      }),
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).status_code).toBe("m067_s01_contract_failed");
  });
});
