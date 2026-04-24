import { afterEach, describe, expect, mock, test } from "bun:test";

type NestedCheck = {
  id: string;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

type PrerequisiteReport = {
  command: "verify:m062:s03" | "verify:m063:s03" | "verify:m064:s03";
  generated_at: string;
  success: boolean;
  status_code: string;
  issues: string[];
  [key: string]: unknown;
};

type S02Report = {
  command: "verify:m065:s02";
  generated_at: string;
  success: boolean;
  status_code: string;
  review_output_key: string | null;
  normalized_review_output_key: string | null;
  delivery_id: string | null;
  repo: string | null;
  proof_target: {
    review_output_key: string | null;
    base_review_output_key: string | null;
    delivery_id: string | null;
    repo: string | null;
    pr_number: number | null;
  };
  check_ids: string[];
  checks: NestedCheck[];
  failing_check_id: string | null;
  issues: string[];
  [key: string]: unknown;
};

type TopLevelCheck = {
  id:
    | "M065-M062-PREREQUISITE"
    | "M065-M063-PREREQUISITE"
    | "M065-M064-PREREQUISITE"
    | "M065-LIVE-LARGE-PR-PROOF"
    | "M065-FRESH-REGRESSION-PROOF";
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
  drill_down: {
    command: string;
    report_key: string;
    nested_status_code?: string;
  };
};

type JsonReport = {
  command: "verify:m065";
  generated_at: string;
  success: boolean;
  status_code: string;
  check_ids: TopLevelCheck["id"][];
  checks: TopLevelCheck[];
  nested_reports: {
    m062: PrerequisiteReport | null;
    m063: PrerequisiteReport | null;
    m064: PrerequisiteReport | null;
    s02: S02Report | null;
  };
  rollout_obligations: {
    liveLargePrProof: {
      state: "pending" | "satisfied";
      source: string | null;
      detail: string;
      drill_down_command: string;
    };
    freshRegressionProof: {
      state: "pending" | "satisfied";
      source: string | null;
      detail: string;
      drill_down_command: string;
    };
  };
  failing_check_id: string | null;
  issues: string[];
};

const FIXED_TIME = "2026-04-24T09:30:00.000Z";
const REVIEW_OUTPUT_KEY = "acme/widgets/pull/42#review-1712345678901-dliveproof";
const DELIVERY_ID = "dliveproof";
const REPO = "acme/widgets";
const BASE_REVIEW_OUTPUT_KEY = "acme/widgets/pull/42#review";

function buildNestedCheck(overrides: Partial<NestedCheck> & Pick<NestedCheck, "id">): NestedCheck {
  return {
    id: overrides.id,
    passed: overrides.passed ?? true,
    skipped: overrides.skipped ?? false,
    status_code: overrides.status_code ?? "nested_ok",
    ...(overrides.detail ? { detail: overrides.detail } : {}),
  };
}

function buildM062Report(overrides: Partial<PrerequisiteReport> = {}): PrerequisiteReport {
  return {
    command: "verify:m062:s03",
    generated_at: FIXED_TIME,
    success: true,
    status_code: "m062_s03_ok",
    scenario_count: 4,
    scenarios: [],
    issues: [],
    ...overrides,
  };
}

function buildM063Report(overrides: Partial<PrerequisiteReport> = {}): PrerequisiteReport {
  return {
    command: "verify:m063:s03",
    generated_at: FIXED_TIME,
    success: true,
    status_code: "m063_s03_ok",
    scenario_count: 2,
    summary:
      "This verifier proves bounded continuation stayed materially narrower than the first pass and remained sufficient for the shipped retry scope.",
    scenarios: [],
    issues: [],
    ...overrides,
  };
}

function buildM064Report(overrides: Partial<PrerequisiteReport> = {}): PrerequisiteReport {
  return {
    command: "verify:m064:s03",
    generated_at: FIXED_TIME,
    success: true,
    status_code: "m064_s03_ok",
    mode: "fixture-matrix",
    record_count: 6,
    records: [],
    issues: [],
    ...overrides,
  };
}

function buildS02Report(overrides: Partial<S02Report> = {}): S02Report {
  return {
    command: "verify:m065:s02",
    generated_at: FIXED_TIME,
    success: true,
    status_code: "m065_s02_ok",
    review_output_key: REVIEW_OUTPUT_KEY,
    normalized_review_output_key: BASE_REVIEW_OUTPUT_KEY,
    delivery_id: DELIVERY_ID,
    repo: REPO,
    proof_target: {
      review_output_key: BASE_REVIEW_OUTPUT_KEY,
      base_review_output_key: BASE_REVIEW_OUTPUT_KEY,
      delivery_id: DELIVERY_ID,
      repo: REPO,
      pr_number: 42,
    },
    check_ids: [
      "M065-S02-IDENTITY-CORRELATION",
      "M065-S02-RUNTIME-TIMING-EVIDENCE",
      "M065-S02-VISIBLE-REVIEW-PROOF",
      "M065-S02-CANONICAL-OPERATOR-EVIDENCE",
      "M065-S02-REPRESENTATIVE-LIVE-BUNDLE",
    ],
    checks: [
      buildNestedCheck({ id: "M065-S02-IDENTITY-CORRELATION", status_code: "identity_correlated" }),
      buildNestedCheck({ id: "M065-S02-RUNTIME-TIMING-EVIDENCE", status_code: "nested_report_ok" }),
      buildNestedCheck({ id: "M065-S02-VISIBLE-REVIEW-PROOF", status_code: "nested_report_ok" }),
      buildNestedCheck({ id: "M065-S02-CANONICAL-OPERATOR-EVIDENCE", status_code: "nested_report_ok" }),
      buildNestedCheck({ id: "M065-S02-REPRESENTATIVE-LIVE-BUNDLE", status_code: "representative_bundle_ok" }),
    ],
    failing_check_id: null,
    issues: [],
    ...overrides,
  };
}

async function loadModuleWithNestedReports(params?: {
  m062?: PrerequisiteReport | unknown;
  m063?: PrerequisiteReport | unknown;
  m064?: PrerequisiteReport | unknown;
  s02?: S02Report | unknown;
}) {
  const evaluateM062S03 = mock(async () => params?.m062 ?? buildM062Report());
  const evaluateM063S03 = mock(() => params?.m063 ?? buildM063Report());
  const evaluateM064S03 = mock(async () => params?.m064 ?? buildM064Report());
  const evaluateM065S02 = mock(async () => params?.s02 ?? buildS02Report());

  mock.module("./verify-m062-s03.ts", () => ({ evaluateM062S03 }));
  mock.module("./verify-m063-s03.ts", () => ({ evaluateM063S03 }));
  mock.module("./verify-m064-s03.ts", () => ({ evaluateM064S03 }));
  mock.module("./verify-m065-s02.ts", () => ({ evaluateM065S02 }));

  const module = await import(`./verify-m065.ts?case=${Math.random()}`);
  return {
    ...module,
    nestedMocks: {
      evaluateM062S03,
      evaluateM063S03,
      evaluateM064S03,
      evaluateM065S02,
    },
  };
}

afterEach(() => {
  mock.restore();
});

describe("verify-m065", () => {
  test("parse args accepts --json and rejects unknown flags", async () => {
    const { parseVerifyM065Args } = await loadModuleWithNestedReports();

    expect(parseVerifyM065Args(["--json"])).toEqual({ help: false, json: true });
    expect(() => parseVerifyM065Args(["--wat"])).toThrow(
      "invalid_cli_args: Unknown argument: --wat",
    );
  });

  test("stable top-level check ids stay pinned to nested prerequisites plus rollout obligations", async () => {
    const { M065_CHECK_IDS } = await loadModuleWithNestedReports();

    expect(M065_CHECK_IDS).toEqual([
      "M065-M062-PREREQUISITE",
      "M065-M063-PREREQUISITE",
      "M065-M064-PREREQUISITE",
      "M065-LIVE-LARGE-PR-PROOF",
      "M065-FRESH-REGRESSION-PROOF",
    ]);
  });

  test("evaluate preserves authoritative nested reports intact and leaves only S03 pending when S02 passes", async () => {
    const m062 = buildM062Report({
      scenarios: [{ scenarioId: "large-pr-bounded", statusCode: "bounded-parity-ok" }],
    });
    const m063 = buildM063Report({
      scenarios: [{ scenarioId: "large-pr-continuation", statusCode: "bounded-continuation-proved" }],
    });
    const m064 = buildM064Report({
      records: [{ recordId: "canonical-authority", statusCode: "canonical" }],
    });
    const s02 = buildS02Report();

    const { evaluateM065, nestedMocks } = await loadModuleWithNestedReports({ m062, m063, m064, s02 });

    const report = await evaluateM065({ generatedAt: FIXED_TIME });

    expect(nestedMocks.evaluateM062S03).toHaveBeenCalledTimes(1);
    expect(nestedMocks.evaluateM063S03).toHaveBeenCalledTimes(1);
    expect(nestedMocks.evaluateM064S03).toHaveBeenCalledTimes(1);
    expect(nestedMocks.evaluateM065S02).toHaveBeenCalledTimes(1);

    expect(report).toMatchObject({
      command: "verify:m065",
      generated_at: FIXED_TIME,
      success: false,
      status_code: "m065_rollout_proof_pending",
      check_ids: [
        "M065-M062-PREREQUISITE",
        "M065-M063-PREREQUISITE",
        "M065-M064-PREREQUISITE",
        "M065-LIVE-LARGE-PR-PROOF",
        "M065-FRESH-REGRESSION-PROOF",
      ],
      failing_check_id: "M065-FRESH-REGRESSION-PROOF",
    } satisfies Partial<JsonReport>);

    expect(report.nested_reports.m062).toBe(m062);
    expect(report.nested_reports.m063).toBe(m063);
    expect(report.nested_reports.m064).toBe(m064);
    expect(report.nested_reports.s02).toBe(s02);

    expect(report.checks).toEqual([
      {
        id: "M065-M062-PREREQUISITE",
        passed: true,
        skipped: false,
        status_code: "nested_report_ok",
        detail: "Preserved authoritative verify:m062:s03 report.",
        drill_down: {
          command: "bun run verify:m062:s03 -- --json",
          report_key: "nested_reports.m062",
          nested_status_code: "m062_s03_ok",
        },
      },
      {
        id: "M065-M063-PREREQUISITE",
        passed: true,
        skipped: false,
        status_code: "nested_report_ok",
        detail: "Preserved authoritative verify:m063:s03 report.",
        drill_down: {
          command: "bun run verify:m063:s03 -- --json",
          report_key: "nested_reports.m063",
          nested_status_code: "m063_s03_ok",
        },
      },
      {
        id: "M065-M064-PREREQUISITE",
        passed: true,
        skipped: false,
        status_code: "nested_report_ok",
        detail: "Preserved authoritative verify:m064:s03 report.",
        drill_down: {
          command: "bun run verify:m064:s03 -- --json",
          report_key: "nested_reports.m064",
          nested_status_code: "m064_s03_ok",
        },
      },
      {
        id: "M065-LIVE-LARGE-PR-PROOF",
        passed: true,
        skipped: false,
        status_code: "rollout_obligation_satisfied",
        detail: "Representative live large-PR proof is satisfied by authoritative verify:m065:s02 evidence.",
        drill_down: {
          command: "bun run verify:m065:s02 -- --json",
          report_key: "nested_reports.s02",
          nested_status_code: "m065_s02_ok",
        },
      },
      {
        id: "M065-FRESH-REGRESSION-PROOF",
        passed: true,
        skipped: true,
        status_code: "pending_fresh_regression_proof",
        detail: "M065 still needs fresh non-large regression proof before milestone closeout.",
        drill_down: {
          command: "bun run verify:m065 -- --json",
          report_key: "rollout_obligations.freshRegressionProof",
        },
      },
    ]);

    expect(report.rollout_obligations).toEqual({
      liveLargePrProof: {
        state: "satisfied",
        source: "nested_reports.s02",
        detail: "Representative live large-PR proof is satisfied by authoritative verify:m065:s02 evidence.",
        drill_down_command: "bun run verify:m065:s02 -- --json",
      },
      freshRegressionProof: {
        state: "pending",
        source: null,
        detail: "Reserved for fresh non-large regression proof from S03.",
        drill_down_command: "bun run verify:m065 -- --json",
      },
    });
  });

  test("evaluate fails loudly when the S02 report is malformed instead of inventing authority", async () => {
    const { evaluateM065 } = await loadModuleWithNestedReports({
      s02: {
        command: "verify:m065:s02",
        generated_at: FIXED_TIME,
        success: true,
        issues: [],
      },
    });

    const report = await evaluateM065({ generatedAt: FIXED_TIME });
    const failingCheck = report.checks.find(
      (check: TopLevelCheck) => check.id === "M065-LIVE-LARGE-PR-PROOF",
    );

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m065_nested_contract_failed");
    expect(report.failing_check_id).toBe("M065-LIVE-LARGE-PR-PROOF");
    expect(failingCheck).toMatchObject({
      passed: false,
      skipped: false,
      status_code: "nested_report_malformed",
      detail:
        "verify:m065:s02 omitted one or more required fields: command, generated_at, success, status_code, and issues, check_ids, checks, failing_check_id, review_output_key, normalized_review_output_key, delivery_id, repo, and proof_target.",
      drill_down: {
        command: "bun run verify:m065:s02 -- --json",
        report_key: "nested_reports.s02",
      },
    });
  });

  test("evaluate surfaces a failing S02 verifier by id and nested status code", async () => {
    const s02 = buildS02Report({
      success: false,
      status_code: "m065_s02_nested_verifier_failed",
      failing_check_id: "M065-S02-VISIBLE-REVIEW-PROOF",
      issues: ["M065-S02-VISIBLE-REVIEW-PROOF: verify:m049:s02 returned m049_s02_review_missing"],
    });

    const { evaluateM065 } = await loadModuleWithNestedReports({ s02 });

    const report = await evaluateM065({ generatedAt: FIXED_TIME });
    const failingCheck = report.checks.find(
      (check: TopLevelCheck) => check.id === "M065-LIVE-LARGE-PR-PROOF",
    );

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m065_nested_verifier_failed");
    expect(report.failing_check_id).toBe("M065-LIVE-LARGE-PR-PROOF");
    expect(failingCheck).toMatchObject({
      passed: false,
      skipped: false,
      status_code: "nested_report_failed",
      detail:
        "verify:m065:s02 failed with status_code=m065_s02_nested_verifier_failed. Run bun run verify:m065:s02 -- --json for drill-down.",
      drill_down: {
        command: "bun run verify:m065:s02 -- --json",
        report_key: "nested_reports.s02",
        nested_status_code: "m065_s02_nested_verifier_failed",
      },
    });
  });

  test("evaluate keeps first failing check on prerequisites when S02 passes but an earlier verifier fails", async () => {
    const m063 = buildM063Report({
      success: false,
      status_code: "m063_s03_verifier_failed",
      issues: ["large-pr-continuation: Continuation lost required section(s): review-knowledge-context."],
    });

    const { evaluateM065 } = await loadModuleWithNestedReports({ m063, s02: buildS02Report() });

    const report = await evaluateM065({ generatedAt: FIXED_TIME });

    expect(report.status_code).toBe("m065_nested_verifier_failed");
    expect(report.failing_check_id).toBe("M065-M063-PREREQUISITE");
    expect(report.checks.find((check: TopLevelCheck) => check.id === "M065-LIVE-LARGE-PR-PROOF")).toMatchObject({
      passed: true,
      skipped: false,
      status_code: "rollout_obligation_satisfied",
    });
  });

  test("render report names the S02 live proof and points operators to the drill-down command", async () => {
    const { evaluateM065, renderM065Report } = await loadModuleWithNestedReports({
      s02: buildS02Report({
        success: false,
        status_code: "m065_s02_nested_verifier_failed",
        issues: ["M065-S02-REPRESENTATIVE-LIVE-BUNDLE: operator evidence missing canonical record"],
      }),
    });

    const report = await evaluateM065({ generatedAt: FIXED_TIME });
    const human = renderM065Report(report);

    expect(human).toContain("# M065 — Composed Rollout Verifier");
    expect(human).toContain("Status: m065_nested_verifier_failed");
    expect(human).toContain("Failing check: M065-LIVE-LARGE-PR-PROOF");
    expect(human).toContain("verify:m065:s02: FAIL (m065_s02_nested_verifier_failed)");
    expect(human).toContain("Next drill-down: bun run verify:m065:s02 -- --json");
    expect(human).toContain("liveLargePrProof: pending — Reserved for live large-PR proof from S02.");
  });

  test("main emits json with nested S02 evidence and returns exit 0 while only S03 remains pending", async () => {
    const m062 = buildM062Report({ checks: [buildNestedCheck({ id: "m062-check" })] });
    const m063 = buildM063Report({ checks: [buildNestedCheck({ id: "m063-check" })] });
    const m064 = buildM064Report({ records: [{ recordId: "canonical-authority", statusCode: "canonical" }] });
    const s02 = buildS02Report();

    const { main } = await loadModuleWithNestedReports({ m062, m063, m064, s02 });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
    });

    const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
    expect(exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    expect(report.command).toBe("verify:m065");
    expect(report.nested_reports.m062).toEqual(m062);
    expect(report.nested_reports.m063).toEqual(m063);
    expect(report.nested_reports.m064).toEqual(m064);
    expect(report.nested_reports.s02).toEqual(s02);
    expect(report.rollout_obligations.liveLargePrProof.state).toBe("satisfied");
    expect(report.rollout_obligations.freshRegressionProof.state).toBe("pending");
    expect(report.failing_check_id).toBe("M065-FRESH-REGRESSION-PROOF");
  });

  test("package.json wires verify:m065 to the composed verifier script", async () => {
    const packageJson = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m065"]).toBe("bun scripts/verify-m065.ts");
  });
});
