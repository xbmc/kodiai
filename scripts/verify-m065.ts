import { evaluateM062S03 } from "./verify-m062-s03.ts";
import { evaluateM063S03 } from "./verify-m063-s03.ts";
import { evaluateM064S03 } from "./verify-m064-s03.ts";
import { evaluateM065S02 } from "./verify-m065-s02.ts";
import { evaluateM065S03 } from "./verify-m065-s03.ts";

export const M065_CHECK_IDS = [
  "M065-M062-PREREQUISITE",
  "M065-M063-PREREQUISITE",
  "M065-M064-PREREQUISITE",
  "M065-LIVE-LARGE-PR-PROOF",
  "M065-FRESH-REGRESSION-PROOF",
] as const;

export type M065CheckId = (typeof M065_CHECK_IDS)[number];

export type M065StatusCode =
  | "m065_ok"
  | "m065_invalid_arg"
  | "m065_nested_contract_failed"
  | "m065_nested_verifier_failed"
  | "m065_rollout_proof_pending";

export type M065CheckStatusCode =
  | "nested_report_ok"
  | "nested_report_malformed"
  | "nested_report_failed"
  | "pending_live_large_pr_proof"
  | "pending_fresh_regression_proof"
  | "rollout_obligation_satisfied";

type PrerequisiteCommand = "verify:m062:s03" | "verify:m063:s03" | "verify:m064:s03";
type PrerequisiteReportKey = "nested_reports.m062" | "nested_reports.m063" | "nested_reports.m064";
type RolloutState = "pending" | "satisfied" | "failed";

type NestedReportContract = {
  command: PrerequisiteCommand;
  generated_at: string;
  success: boolean;
  status_code: string;
  issues: string[];
  [key: string]: unknown;
};

type S02NestedReportContract = {
  command: "verify:m065:s02";
  generated_at: string;
  success: boolean;
  status_code: string;
  issues: string[];
  check_ids: string[];
  checks: unknown[];
  failing_check_id: string | null;
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
  [key: string]: unknown;
};

type S03NestedReportContract = {
  command: "verify:m065:s03";
  generated_at: string;
  success: boolean;
  status_code: string;
  issues: string[];
  check_ids: string[];
  checks: unknown[];
  failing_check_id: string | null;
  rollout_obligation: {
    state: "satisfied" | "failed";
    source: string | null;
    detail: string;
    drill_down_command: string;
  };
  [key: string]: unknown;
};

export type M065Check = {
  id: M065CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: M065CheckStatusCode;
  detail?: string;
  drill_down: {
    command: string;
    report_key: string;
    nested_status_code?: string;
  };
};

export type M065RolloutObligation = {
  state: RolloutState;
  source: string | null;
  detail: string;
  drill_down_command: string;
};

export type M065Report = {
  command: "verify:m065";
  generated_at: string;
  success: boolean;
  status_code: M065StatusCode;
  check_ids: M065CheckId[];
  checks: M065Check[];
  nested_reports: {
    m062: NestedReportContract | null;
    m063: NestedReportContract | null;
    m064: NestedReportContract | null;
    s02: S02NestedReportContract | null;
    s03: S03NestedReportContract | null;
  };
  rollout_obligations: {
    liveLargePrProof: M065RolloutObligation;
    freshRegressionProof: M065RolloutObligation;
  };
  failing_check_id: M065CheckId | null;
  issues: string[];
};

type VerifyM065Args = {
  help: boolean;
  json: boolean;
};

const ROLLOUT_DRILL_DOWN_COMMAND = "bun run verify:m065 -- --json";
const S02_DRILL_DOWN_COMMAND = "bun run verify:m065:s02 -- --json";
const S03_DRILL_DOWN_COMMAND = "bun run verify:m065:s03 -- --json";
const REQUIRED_NESTED_FIELDS = "command, generated_at, success, status_code, and issues";
const REQUIRED_S02_FIELDS = `${REQUIRED_NESTED_FIELDS}, check_ids, checks, failing_check_id, review_output_key, normalized_review_output_key, delivery_id, repo, and proof_target`;
const REQUIRED_S03_FIELDS = `${REQUIRED_NESTED_FIELDS}, check_ids, checks, failing_check_id, and rollout_obligation`;
const REPRESENTATIVE_REVIEW_OUTPUT_KEY = "kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-review:delivery-delivery-101:head-head-101";

function buildInvalidArgReport(params: { generatedAt?: string; issue: string }): M065Report {
  return {
    command: "verify:m065",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: false,
    status_code: "m065_invalid_arg",
    check_ids: [...M065_CHECK_IDS],
    checks: [],
    nested_reports: { m062: null, m063: null, m064: null, s02: null, s03: null },
    rollout_obligations: buildRolloutObligations(),
    failing_check_id: null,
    issues: [params.issue],
  };
}

function buildRolloutObligations(params?: { s02?: S02NestedReportContract | null; s03?: unknown }): M065Report["rollout_obligations"] {
  const s02 = params?.s02 ?? null;
  const s03 = params?.s03;
  const liveLargePrProof = s02 && s02.success
    ? {
      state: "satisfied" as const,
      source: "nested_reports.s02",
      detail: "Representative live large-PR proof is satisfied by authoritative verify:m065:s02 evidence.",
      drill_down_command: S02_DRILL_DOWN_COMMAND,
    }
    : {
      state: "pending" as const,
      source: null,
      detail: "Reserved for live large-PR proof from S02.",
      drill_down_command: ROLLOUT_DRILL_DOWN_COMMAND,
    };

  const freshRegressionProof = typeof s03 === "undefined" || s03 === null
    ? {
      state: "pending" as const,
      source: null,
      detail: "Reserved for fresh non-large regression proof from S03.",
      drill_down_command: ROLLOUT_DRILL_DOWN_COMMAND,
    }
    : !isS03NestedReportContract(s03)
      ? {
        state: "failed" as const,
        source: null,
        detail: "Fresh non-large regression proof is malformed and cannot be trusted.",
        drill_down_command: S03_DRILL_DOWN_COMMAND,
      }
      : {
        state: s03.rollout_obligation.state,
        source: s03.success ? "nested_reports.s03" : s03.rollout_obligation.source,
        detail: s03.rollout_obligation.detail,
        drill_down_command: S03_DRILL_DOWN_COMMAND,
      };

  return {
    liveLargePrProof,
    freshRegressionProof,
  };
}

function isNestedReportContract(value: unknown, command: PrerequisiteCommand): value is NestedReportContract {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.command === command
    && typeof record.generated_at === "string"
    && typeof record.success === "boolean"
    && typeof record.status_code === "string"
    && Array.isArray(record.issues)
    && record.issues.every((item) => typeof item === "string");
}

function isS02NestedReportContract(value: unknown): value is S02NestedReportContract {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.command !== "verify:m065:s02"
    || typeof record.generated_at !== "string"
    || typeof record.success !== "boolean"
    || typeof record.status_code !== "string"
    || !Array.isArray(record.issues)
    || !record.issues.every((item) => typeof item === "string")
    || !Array.isArray(record.check_ids)
    || !record.check_ids.every((item) => typeof item === "string")
    || !Array.isArray(record.checks)
    || !(typeof record.failing_check_id === "string" || record.failing_check_id === null)
    || !(typeof record.review_output_key === "string" || record.review_output_key === null)
    || !(typeof record.normalized_review_output_key === "string" || record.normalized_review_output_key === null)
    || !(typeof record.delivery_id === "string" || record.delivery_id === null)
    || !(typeof record.repo === "string" || record.repo === null)
    || !record.proof_target
    || typeof record.proof_target !== "object") {
    return false;
  }

  const proofTarget = record.proof_target as Record<string, unknown>;
  return (typeof proofTarget.review_output_key === "string" || proofTarget.review_output_key === null)
    && (typeof proofTarget.base_review_output_key === "string" || proofTarget.base_review_output_key === null)
    && (typeof proofTarget.delivery_id === "string" || proofTarget.delivery_id === null)
    && (typeof proofTarget.repo === "string" || proofTarget.repo === null)
    && (typeof proofTarget.pr_number === "number" || proofTarget.pr_number === null);
}

function isS03NestedReportContract(value: unknown): value is S03NestedReportContract {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.command !== "verify:m065:s03"
    || typeof record.generated_at !== "string"
    || typeof record.success !== "boolean"
    || typeof record.status_code !== "string"
    || !Array.isArray(record.issues)
    || !record.issues.every((item) => typeof item === "string")
    || !Array.isArray(record.check_ids)
    || !record.check_ids.every((item) => typeof item === "string")
    || !Array.isArray(record.checks)
    || !(typeof record.failing_check_id === "string" || record.failing_check_id === null)
    || !record.rollout_obligation
    || typeof record.rollout_obligation !== "object") {
    return false;
  }

  const rollout = record.rollout_obligation as Record<string, unknown>;
  return (rollout.state === "satisfied" || rollout.state === "failed")
    && (typeof rollout.source === "string" || rollout.source === null)
    && typeof rollout.detail === "string"
    && typeof rollout.drill_down_command === "string";
}

function buildNestedCheck(params: {
  id: Extract<M065CheckId, "M065-M062-PREREQUISITE" | "M065-M063-PREREQUISITE" | "M065-M064-PREREQUISITE">;
  nestedName: PrerequisiteCommand;
  reportKey: PrerequisiteReportKey;
  report: unknown;
}): { check: M065Check; issue: string | null; malformed: boolean; failed: boolean } {
  const drillDownCommand = `bun run ${params.nestedName} -- --json`;

  if (!isNestedReportContract(params.report, params.nestedName)) {
    return {
      check: {
        id: params.id,
        passed: false,
        skipped: false,
        status_code: "nested_report_malformed",
        detail: `${params.nestedName} omitted one or more required fields: ${REQUIRED_NESTED_FIELDS}.`,
        drill_down: {
          command: drillDownCommand,
          report_key: params.reportKey,
        },
      },
      issue: `${params.id}: malformed nested report from ${params.nestedName}`,
      malformed: true,
      failed: false,
    };
  }

  if (!params.report.success) {
    return {
      check: {
        id: params.id,
        passed: false,
        skipped: false,
        status_code: "nested_report_failed",
        detail: `${params.nestedName} failed with status_code=${params.report.status_code}. Run ${drillDownCommand} for drill-down.`,
        drill_down: {
          command: drillDownCommand,
          report_key: params.reportKey,
          nested_status_code: params.report.status_code,
        },
      },
      issue: `${params.id}: ${params.nestedName} returned ${params.report.status_code}`,
      malformed: false,
      failed: true,
    };
  }

  return {
    check: {
      id: params.id,
      passed: true,
      skipped: false,
      status_code: "nested_report_ok",
      detail: `Preserved authoritative ${params.nestedName} report.`,
      drill_down: {
        command: drillDownCommand,
        report_key: params.reportKey,
        nested_status_code: params.report.status_code,
      },
    },
    issue: null,
    malformed: false,
    failed: false,
  };
}

function buildLiveProofCheck(params: {
  report: unknown;
}): { check: M065Check; issue: string | null; malformed: boolean; failed: boolean } {
  if (!isS02NestedReportContract(params.report)) {
    return {
      check: {
        id: "M065-LIVE-LARGE-PR-PROOF",
        passed: false,
        skipped: false,
        status_code: "nested_report_malformed",
        detail: `verify:m065:s02 omitted one or more required fields: ${REQUIRED_S02_FIELDS}.`,
        drill_down: {
          command: S02_DRILL_DOWN_COMMAND,
          report_key: "nested_reports.s02",
        },
      },
      issue: "M065-LIVE-LARGE-PR-PROOF: malformed nested report from verify:m065:s02",
      malformed: true,
      failed: false,
    };
  }

  if (!params.report.success) {
    return {
      check: {
        id: "M065-LIVE-LARGE-PR-PROOF",
        passed: false,
        skipped: false,
        status_code: "nested_report_failed",
        detail: `verify:m065:s02 failed with status_code=${params.report.status_code}. Run ${S02_DRILL_DOWN_COMMAND} for drill-down.`,
        drill_down: {
          command: S02_DRILL_DOWN_COMMAND,
          report_key: "nested_reports.s02",
          nested_status_code: params.report.status_code,
        },
      },
      issue: `M065-LIVE-LARGE-PR-PROOF: verify:m065:s02 returned ${params.report.status_code}`,
      malformed: false,
      failed: true,
    };
  }

  return {
    check: {
      id: "M065-LIVE-LARGE-PR-PROOF",
      passed: true,
      skipped: false,
      status_code: "rollout_obligation_satisfied",
      detail: "Representative live large-PR proof is satisfied by authoritative verify:m065:s02 evidence.",
      drill_down: {
        command: S02_DRILL_DOWN_COMMAND,
        report_key: "nested_reports.s02",
        nested_status_code: params.report.status_code,
      },
    },
    issue: null,
    malformed: false,
    failed: false,
  };
}

function buildFreshRegressionCheck(params: {
  report: unknown;
}): { check: M065Check; issue: string | null; malformed: boolean; failed: boolean; pending: boolean } {
  if (params.report == null) {
    return {
      check: {
        id: "M065-FRESH-REGRESSION-PROOF",
        passed: true,
        skipped: true,
        status_code: "pending_fresh_regression_proof",
        detail: "M065 still needs fresh non-large regression proof before milestone closeout.",
        drill_down: {
          command: ROLLOUT_DRILL_DOWN_COMMAND,
          report_key: "rollout_obligations.freshRegressionProof",
        },
      },
      issue: null,
      malformed: false,
      failed: false,
      pending: true,
    };
  }

  if (!isS03NestedReportContract(params.report)) {
    return {
      check: {
        id: "M065-FRESH-REGRESSION-PROOF",
        passed: false,
        skipped: false,
        status_code: "nested_report_malformed",
        detail: `verify:m065:s03 omitted one or more required fields: ${REQUIRED_S03_FIELDS}.`,
        drill_down: {
          command: S03_DRILL_DOWN_COMMAND,
          report_key: "nested_reports.s03",
        },
      },
      issue: "M065-FRESH-REGRESSION-PROOF: malformed nested report from verify:m065:s03",
      malformed: true,
      failed: false,
      pending: false,
    };
  }

  if (!params.report.success) {
    return {
      check: {
        id: "M065-FRESH-REGRESSION-PROOF",
        passed: false,
        skipped: false,
        status_code: "nested_report_failed",
        detail: `verify:m065:s03 failed with status_code=${params.report.status_code}. Run ${S03_DRILL_DOWN_COMMAND} for drill-down.`,
        drill_down: {
          command: S03_DRILL_DOWN_COMMAND,
          report_key: "nested_reports.s03",
          nested_status_code: params.report.status_code,
        },
      },
      issue: `M065-FRESH-REGRESSION-PROOF: verify:m065:s03 returned ${params.report.status_code}`,
      malformed: false,
      failed: true,
      pending: false,
    };
  }

  return {
    check: {
      id: "M065-FRESH-REGRESSION-PROOF",
      passed: true,
      skipped: false,
      status_code: "rollout_obligation_satisfied",
      detail: "Fresh non-large regression proof is satisfied by authoritative verify:m065:s03 evidence.",
      drill_down: {
        command: S03_DRILL_DOWN_COMMAND,
        report_key: "nested_reports.s03",
        nested_status_code: params.report.status_code,
      },
    },
    issue: null,
    malformed: false,
    failed: false,
    pending: false,
  };
}

function deriveOverallStatus(checks: M065Check[]): Pick<M065Report, "success" | "status_code" | "failing_check_id" | "issues"> {
  const firstMalformed = checks.find((check) => check.status_code === "nested_report_malformed");
  if (firstMalformed) {
    return {
      success: false,
      status_code: "m065_nested_contract_failed",
      failing_check_id: firstMalformed.id,
      issues: [firstMalformed.detail ?? `${firstMalformed.id} failed.`],
    };
  }

  const firstFailedNested = checks.find((check) => check.status_code === "nested_report_failed");
  if (firstFailedNested) {
    return {
      success: false,
      status_code: "m065_nested_verifier_failed",
      failing_check_id: firstFailedNested.id,
      issues: [firstFailedNested.detail ?? `${firstFailedNested.id} failed.`],
    };
  }

  const firstPending = checks.find((check) => check.skipped);
  if (firstPending) {
    return {
      success: false,
      status_code: "m065_rollout_proof_pending",
      failing_check_id: firstPending.id,
      issues: [firstPending.detail ?? `${firstPending.id} remains pending.`],
    };
  }

  return {
    success: true,
    status_code: "m065_ok",
    failing_check_id: null,
    issues: [],
  };
}

export function parseVerifyM065Args(args: string[]): VerifyM065Args {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m065 -- [--json]",
    "",
    "Composes the authoritative M062, M063, M064, M065 S02, and M065 S03 verifier families without flattening nested evidence.",
    "",
    "Options:",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

type EvaluateM065Fns = {
  evaluateM062S03Fn: typeof evaluateM062S03;
  evaluateM063S03Fn: typeof evaluateM063S03;
  evaluateM064S03Fn: typeof evaluateM064S03;
  evaluateM065S02Fn: typeof evaluateM065S02;
  evaluateM065S03Fn: typeof evaluateM065S03;
};

function resolveEvaluateFns(overrides?: Partial<EvaluateM065Fns>): EvaluateM065Fns {
  return {
    evaluateM062S03Fn: overrides?.evaluateM062S03Fn ?? evaluateM062S03,
    evaluateM063S03Fn: overrides?.evaluateM063S03Fn ?? evaluateM063S03,
    evaluateM064S03Fn: overrides?.evaluateM064S03Fn ?? evaluateM064S03,
    evaluateM065S02Fn: overrides?.evaluateM065S02Fn ?? evaluateM065S02,
    evaluateM065S03Fn: overrides?.evaluateM065S03Fn ?? evaluateM065S03,
  };
}

export async function evaluateM065(
  params?: { generatedAt?: string },
  fns?: Partial<EvaluateM065Fns>,
): Promise<M065Report> {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const {
    evaluateM062S03Fn,
    evaluateM063S03Fn,
    evaluateM064S03Fn,
    evaluateM065S02Fn,
    evaluateM065S03Fn,
  } = resolveEvaluateFns(fns);
  const [m062, m063, m064, s02, s03] = await Promise.all([
    evaluateM062S03Fn({ generatedAt }),
    Promise.resolve(evaluateM063S03Fn({ generatedAt })),
    evaluateM064S03Fn({ generatedAt }),
    evaluateM065S02Fn({
      generatedAt,
      reviewOutputKey: REPRESENTATIVE_REVIEW_OUTPUT_KEY,
    }),
    evaluateM065S03Fn({ generatedAt }),
  ]);

  const nested_reports = {
    m062: isNestedReportContract(m062, "verify:m062:s03") ? m062 : null,
    m063: isNestedReportContract(m063, "verify:m063:s03") ? m063 : null,
    m064: isNestedReportContract(m064, "verify:m064:s03") ? m064 : null,
    s02: isS02NestedReportContract(s02) ? s02 : null,
    s03: isS03NestedReportContract(s03) ? s03 : null,
  };
  const prerequisiteChecks = [
    buildNestedCheck({
      id: "M065-M062-PREREQUISITE",
      nestedName: "verify:m062:s03",
      reportKey: "nested_reports.m062",
      report: m062,
    }).check,
    buildNestedCheck({
      id: "M065-M063-PREREQUISITE",
      nestedName: "verify:m063:s03",
      reportKey: "nested_reports.m063",
      report: m063,
    }).check,
    buildNestedCheck({
      id: "M065-M064-PREREQUISITE",
      nestedName: "verify:m064:s03",
      reportKey: "nested_reports.m064",
      report: m064,
    }).check,
  ];
  const liveProofCheck = buildLiveProofCheck({ report: s02 }).check;
  const freshRegressionCheck = buildFreshRegressionCheck({ report: s03 }).check;
  const checks = [...prerequisiteChecks, liveProofCheck, freshRegressionCheck];
  const overall = deriveOverallStatus(checks);

  return {
    command: "verify:m065",
    generated_at: generatedAt,
    success: overall.success,
    status_code: overall.status_code,
    check_ids: [...M065_CHECK_IDS],
    checks,
    nested_reports,
    rollout_obligations: buildRolloutObligations({ s02: nested_reports.s02, s03 }),
    failing_check_id: overall.failing_check_id,
    issues: overall.issues,
  };
}

export function renderM065Report(report: M065Report): string {
  const lines = [
    "# M065 — Composed Rollout Verifier",
    "",
    `Status: ${report.status_code}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Overall success: ${String(report.success)}`,
    "",
    "Nested verifier status:",
    `- verify:m062:s03: ${report.nested_reports.m062?.success ? "PASS" : "FAIL"} (${report.nested_reports.m062?.status_code ?? "missing"})`,
    `- verify:m063:s03: ${report.nested_reports.m063?.success ? "PASS" : "FAIL"} (${report.nested_reports.m063?.status_code ?? "missing"})`,
    `- verify:m064:s03: ${report.nested_reports.m064?.success ? "PASS" : "FAIL"} (${report.nested_reports.m064?.status_code ?? "missing"})`,
    `- verify:m065:s02: ${report.nested_reports.s02?.success ? "PASS" : "FAIL"} (${report.nested_reports.s02?.status_code ?? "missing"})`,
    `- verify:m065:s03: ${report.nested_reports.s03?.success ? "PASS" : "FAIL"} (${report.nested_reports.s03?.status_code ?? "missing"})`,
    "",
    "Top-level checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.status_code} (passed=${String(check.passed)} skipped=${String(check.skipped)})`);
    if (check.detail) {
      lines.push(`  - ${check.detail}`);
    }
    lines.push(`  - Next drill-down: ${check.drill_down.command}`);
    lines.push(`  - Report key: ${check.drill_down.report_key}`);
    if (check.drill_down.nested_status_code) {
      lines.push(`  - Nested status: ${check.drill_down.nested_status_code}`);
    }
  }

  lines.push("", "Rollout obligations:");
  lines.push(
    `- liveLargePrProof: ${report.rollout_obligations.liveLargePrProof.state} — ${report.rollout_obligations.liveLargePrProof.detail}`,
  );
  lines.push(
    `- freshRegressionProof: ${report.rollout_obligations.freshRegressionProof.state} — ${report.rollout_obligations.freshRegressionProof.detail}`,
  );

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluateFn?: typeof evaluateM065;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const evaluateFn = deps?.evaluateFn ?? evaluateM065;

  try {
    const options = parseVerifyM065Args(args);

    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const report = await evaluateFn();
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM065Report(report));

    if (!report.success && report.status_code !== "m065_rollout_proof_pending") {
      const failingCheck = report.checks.find((check) => check.id === report.failing_check_id);
      if (failingCheck) {
        stderr.write(`verify:m065 failed: ${failingCheck.id}:${failingCheck.status_code}\n`);
      }
    }

    return report.status_code === "m065_rollout_proof_pending"
      ? 0
      : report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = buildInvalidArgReport({ issue: message });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
