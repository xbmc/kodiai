import { describe, expect, test } from "bun:test";
import {
  evaluateM067S03ReviewReducerContract,
  main,
  renderM067S03Report,
  type M067S03Check,
  type M067S03Report,
} from "./verify-m067-s03.ts";

const RAW_LEAK_MARKERS = [
  "PROMPT_SECRET",
  "diff --git",
  "TOKEN=abc123",
  "rawPrompt",
  "rawDiff",
  "secretToken",
  "Unsafe raw fixture title",
];

function checkById(report: M067S03Report, id: M067S03Check["id"]): M067S03Check {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (!check) {
    throw new Error(`missing check ${id}`);
  }
  return check;
}

function expectNoRawLeak(value: string): void {
  for (const marker of RAW_LEAK_MARKERS) {
    expect(value).not.toContain(marker);
  }
}

describe("evaluateM067S03ReviewReducerContract", () => {
  test("returns a successful deterministic report for reducer counts, parity, details, fail-open, and graph validation", async () => {
    const report = await evaluateM067S03ReviewReducerContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
    });

    expect(report.command).toBe("verify:m067:s03");
    expect(report.generated_at).toBe("2026-05-09T17:00:00.000Z");
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m067_s03_ok");
    expect(report.issues).toEqual([]);
    expect(report.check_ids).toEqual([
      "REDUCER-COUNTS",
      "REDUCER-BEHAVIOR-PARITY",
      "REDUCER-DETAILS-COMPACT",
      "REDUCER-DEGRADED-FAIL-OPEN",
      "GRAPH-VALIDATION-CONSUMED",
    ]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.reducer.status).toBe("ready");
    expect(report.reducer.counts).toMatchObject({
      input: 4,
      kept: 2,
      suppressed: 1,
      rewritten: 1,
      deprioritized: 0,
      lowConfidence: 1,
      graphValidated: 1,
      graphUncertain: 1,
    });
    expect(report.reducer.visible_comment_ids).toEqual([1, 2]);
    expect(report.reducer.filtered_inline_comment_ids).toEqual([3, 4]);
    expect(report.reducer.rewritten_comment_ids).toEqual([2]);
    expect(report.reducer.suppressed_comment_ids).toEqual([3]);
    expect(report.reducer.low_confidence_comment_ids).toEqual([4]);
    expect(report.reducer.details_line).toStartWith("Review reducer: ready");
    expect(report.reducer.details_line.length).toBeLessThanOrEqual(240);
    expect(report.reducer.review_details_line_count).toBe(1);
    expect(report.degraded.status).toBe("degraded");
    expect(report.degraded.filtered_inline_count).toBe(0);
    expect(report.degraded.visible_count).toBe(4);
    expect(report.degraded.details_line).toContain("Review reducer: degraded");
    expect(report.graph_validation).toEqual({
      enabled: true,
      validated: 1,
      uncertain: 1,
      verdicts: ["skipped", "skipped", "skipped", "uncertain"],
    });
    expect(checkById(report, "REDUCER-COUNTS").passed).toBe(true);
    expect(checkById(report, "REDUCER-BEHAVIOR-PARITY").passed).toBe(true);
    expect(checkById(report, "REDUCER-DETAILS-COMPACT").passed).toBe(true);
    expect(checkById(report, "REDUCER-DEGRADED-FAIL-OPEN").passed).toBe(true);
    expect(checkById(report, "GRAPH-VALIDATION-CONSUMED").passed).toBe(true);
  });

  test("renders text output without raw fixture leakage", async () => {
    const report = await evaluateM067S03ReviewReducerContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      overrides: {
        degradedReason: "Unsafe raw fixture title PROMPT_SECRET diff --git TOKEN=abc123 rawPrompt rawDiff secretToken",
      },
    });
    const rendered = renderM067S03Report(report);

    expect(rendered).toContain("# M067 S03 — Review Reducer Contract Verifier");
    expect(rendered).toContain("REDUCER-COUNTS");
    expect(rendered).toContain("GRAPH-VALIDATION-CONSUMED");
    expectNoRawLeak(rendered);
    expectNoRawLeak(JSON.stringify(report));
  });

  test("prints parseable JSON with bounded evidence and no raw finding, diff, prompt, or secret payloads", async () => {
    let stdout = "";
    const exitCode = await main(["--json"], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: () => undefined },
      evaluateFn: () => evaluateM067S03ReviewReducerContract({
        generatedAt: "2026-05-09T17:00:00.000Z",
        overrides: {
          degradedReason: "Unsafe raw fixture title PROMPT_SECRET diff --git TOKEN=abc123 rawPrompt rawDiff secretToken",
        },
      }),
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as M067S03Report;
    expect(parsed.status_code).toBe("m067_s03_ok");
    expect(parsed.checks.map((check) => check.id)).toEqual(parsed.check_ids);
    expect(parsed.reducer.counts.input).toBe(4);
    expect(parsed.reducer.details_line).toContain("Review reducer: ready");
    expectNoRawLeak(stdout);
  });

  test("returns nonzero and names the failing check when evaluator checks fail", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await main(["--json"], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
      evaluateFn: async () => ({
        command: "verify:m067:s03",
        generated_at: "2026-05-09T17:00:00.000Z",
        success: false,
        status_code: "m067_s03_contract_failed",
        check_ids: ["REDUCER-COUNTS"],
        checks: [{
          id: "REDUCER-COUNTS",
          passed: false,
          status_code: "reducer_counts_invalid",
          detail: "expected bounded reducer counts",
        }],
        failing_check_id: "REDUCER-COUNTS",
        issues: ["REDUCER-COUNTS: expected bounded reducer counts"],
        reducer: {
          status: "ready",
          counts: {
            input: 0,
            kept: 0,
            suppressed: 0,
            rewritten: 0,
            deprioritized: 0,
            lowConfidence: 0,
            auditEvents: 0,
            severityDemoted: 0,
            graphValidated: 0,
            graphUncertain: 0,
          },
          visible_comment_ids: [],
          filtered_inline_comment_ids: [],
          suppressed_comment_ids: [],
          rewritten_comment_ids: [],
          deprioritized_comment_ids: [],
          low_confidence_comment_ids: [],
          audit_sources: [],
          details_line: "",
          review_details_line_count: 0,
        },
        degraded: {
          status: "degraded",
          reason: "reducer-exception",
          visible_count: 0,
          filtered_inline_count: 0,
          details_line: "",
        },
        graph_validation: {
          enabled: true,
          validated: 0,
          uncertain: 0,
          verdicts: [],
        },
      } satisfies M067S03Report),
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).failing_check_id).toBe("REDUCER-COUNTS");
    expect(stderr).toContain("verify:m067:s03 failed: REDUCER-COUNTS");
  });
});
