import { describe, expect, test } from "bun:test";
import {
  evaluateM067S04CandidateSeamContract,
  main,
  renderM067S04Report,
  type M067S04Check,
  type M067S04Report,
} from "./verify-m067-s04.ts";

const RAW_LEAK_MARKERS = [
  "Unsafe raw fixture title",
  "Candidate body includes hidden prompt",
  "diff --git",
  "BEGIN PROMPT",
  "PROMPT_SECRET",
  "TOKEN=abc123",
  "sk-live-secret-token",
  "/tmp/kodiai/workspace",
];

function checkById(report: M067S04Report, id: M067S04Check["id"]): M067S04Check {
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

describe("evaluateM067S04CandidateSeamContract", () => {
  test("returns a successful deterministic report for the shadow candidate seam", async () => {
    const report = await evaluateM067S04CandidateSeamContract({
      generatedAt: "2026-05-09T18:00:00.000Z",
    });

    expect(report.command).toBe("verify:m067:s04");
    expect(report.generated_at).toBe("2026-05-09T18:00:00.000Z");
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m067_s04_ok");
    expect(report.issues).toEqual([]);
    expect(report.check_ids).toEqual([
      "CANDIDATE-SCHEMA-SHADOW",
      "CANDIDATE-MCP-TOOL-CAPTURE",
      "CANDIDATE-FAIL-OPEN",
      "CANDIDATE-DETAILS-COMPACT",
      "PLAN-CANDIDATE-SHADOW",
      "PROMPT-SHADOW-NOT-PUBLISH",
      "CANDIDATE-ARTIFACT-SIDECAR",
    ]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.candidate.status).toBe("shadow");
    expect(report.candidate.counts).toEqual({ input: 2, recorded: 1, rejected: 1, errors: 0 });
    expect(report.candidate.artifact_present).toBe(true);
    expect(report.candidate.artifact_basename).toBe("review-candidate-findings.json");
    expect(report.mcp.recorded_response).toEqual({ recorded: true, mode: "shadow" });
    expect(report.mcp.failing_recorder_response).toEqual({
      recorded: false,
      mode: "degraded",
      reason: "candidate-finding-record-failed",
    });
    expect(report.mcp.allowed_tools).toContain("mcp__review_candidate_finding__record_candidate_finding");
    expect(report.mcp.allowed_tools).toContain("mcp__github_inline_comment__create_inline_comment");
    expect(report.review_details.candidate_line).toStartWith("- Review candidates: shadow");
    expect(report.review_plan.candidate_mode).toBe("shadow");
    expect(report.prompt.has_shadow_section).toBe(true);
    expect(report.prompt.shadow_section).toContain("optional shadow-only tool");
    expect(report.prompt.shadow_section).toContain("does not publish GitHub comments");
    expect(report.prompt.shadow_section).toContain("MUST still use the GitHub publish tools");
    expect(report.prompt.shadow_section).not.toContain("Tool Availability Contract");
    expect(checkById(report, "CANDIDATE-SCHEMA-SHADOW").passed).toBe(true);
    expect(checkById(report, "CANDIDATE-MCP-TOOL-CAPTURE").passed).toBe(true);
    expect(checkById(report, "CANDIDATE-FAIL-OPEN").passed).toBe(true);
    expect(checkById(report, "CANDIDATE-DETAILS-COMPACT").passed).toBe(true);
    expect(checkById(report, "PLAN-CANDIDATE-SHADOW").passed).toBe(true);
    expect(checkById(report, "PROMPT-SHADOW-NOT-PUBLISH").passed).toBe(true);
    expect(checkById(report, "CANDIDATE-ARTIFACT-SIDECAR").passed).toBe(true);
  });

  test("renders successful text output without raw candidate, diff, prompt, token, or absolute-path leakage", async () => {
    const report = await evaluateM067S04CandidateSeamContract({
      generatedAt: "2026-05-09T18:00:00.000Z",
    });
    const rendered = renderM067S04Report(report);

    expect(rendered).toContain("# M067 S04 — Shadow Candidate Seam Verifier");
    expect(rendered).toContain("Overall success: true");
    expect(rendered).toContain("CANDIDATE-MCP-TOOL-CAPTURE");
    expect(rendered).toContain("Review candidates: shadow");
    expectNoRawLeak(rendered);
    expectNoRawLeak(JSON.stringify(report));
  });

  test("prints parseable JSON with every check ID and no raw leakage", async () => {
    let stdout = "";
    const exitCode = await main(["--json"], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: () => undefined },
      evaluateFn: () => evaluateM067S04CandidateSeamContract({
        generatedAt: "2026-05-09T18:00:00.000Z",
      }),
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as M067S04Report;
    expect(parsed.status_code).toBe("m067_s04_ok");
    expect(parsed.checks.map((check) => check.id)).toEqual(parsed.check_ids);
    expect(parsed.check_ids).toContain("PROMPT-SHADOW-NOT-PUBLISH");
    expect(parsed.candidate.details_line).toContain("Review candidates: shadow");
    expectNoRawLeak(stdout);
  });

  test("emits issues and failing status when an override makes a candidate details line malformed", async () => {
    const report = await evaluateM067S04CandidateSeamContract({
      generatedAt: "2026-05-09T18:00:00.000Z",
      overrides: {
        candidateDetailsSummaryText: "Review candidates: shadow recorded=1 Unsafe raw fixture title diff --git TOKEN=abc123",
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m067_s04_contract_failed");
    expect(report.failing_check_id).toBe("CANDIDATE-DETAILS-COMPACT");
    expect(checkById(report, "CANDIDATE-DETAILS-COMPACT").passed).toBe(false);
    expect(report.issues.join("\n")).toContain("CANDIDATE-DETAILS-COMPACT");
    expectNoRawLeak(JSON.stringify(report));
  });
});

describe("main", () => {
  test("returns text output for successful verifier execution", async () => {
    let stdout = "";
    const exitCode = await main([], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: () => undefined },
      evaluateFn: () => evaluateM067S04CandidateSeamContract({
        generatedAt: "2026-05-09T18:00:00.000Z",
      }),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("# M067 S04 — Shadow Candidate Seam Verifier");
    expect(stdout).toContain("Overall success: true");
    expect(stdout).toContain("CANDIDATE-ARTIFACT-SIDECAR");
  });

  test("returns nonzero and names the failing check when evaluator checks fail", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await main(["--json"], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
      evaluateFn: async () => ({
        command: "verify:m067:s04",
        generated_at: "2026-05-09T18:00:00.000Z",
        success: false,
        status_code: "m067_s04_contract_failed",
        check_ids: ["CANDIDATE-SCHEMA-SHADOW"],
        checks: [{
          id: "CANDIDATE-SCHEMA-SHADOW",
          passed: false,
          status_code: "candidate_schema_not_shadow",
          detail: "candidate contract did not stay shadow-only",
        }],
        failing_check_id: "CANDIDATE-SCHEMA-SHADOW",
        issues: ["CANDIDATE-SCHEMA-SHADOW: candidate contract did not stay shadow-only"],
        candidate: {
          status: "unavailable",
          counts: { input: 0, recorded: 0, rejected: 0, errors: 0 },
          artifact_present: false,
          artifact_basename: null,
          details_line: "",
        },
        mcp: {
          server_names: [],
          allowed_tools: [],
          recorded_response: {},
          failing_recorder_response: {},
          warning_count: 0,
        },
        review_details: {
          marker_count: 0,
          candidate_line_count: 0,
          candidate_line: "",
        },
        review_plan: {
          status: "ready",
          candidate_mode: "unavailable",
          details_line: "",
        },
        prompt: {
          has_shadow_section: false,
          shadow_section: "",
          publish_tool_count: 0,
          includes_candidate_in_publish_contract: false,
        },
        sidecar: {
          artifact_present: false,
          artifact_basename: null,
        },
      } satisfies M067S04Report),
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).failing_check_id).toBe("CANDIDATE-SCHEMA-SHADOW");
    expect(stderr).toContain("verify:m067:s04 failed: CANDIDATE-SCHEMA-SHADOW");
  });
});
