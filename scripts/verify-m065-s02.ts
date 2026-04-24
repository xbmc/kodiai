import { parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import { evaluateM048S01, type M048S01Report } from "./verify-m048-s01.ts";
import { evaluateM049S02, type M049S02Report } from "./verify-m049-s02.ts";
import { evaluateM064S03, type M064S03Report } from "./verify-m064-s03.ts";

export const M065_S02_CHECK_IDS = [
  "M065-S02-IDENTITY-CORRELATION",
  "M065-S02-RUNTIME-TIMING-EVIDENCE",
  "M065-S02-VISIBLE-REVIEW-PROOF",
  "M065-S02-CANONICAL-OPERATOR-EVIDENCE",
  "M065-S02-REPRESENTATIVE-LIVE-BUNDLE",
] as const;

export type M065S02CheckId = (typeof M065_S02_CHECK_IDS)[number];

export type M065S02StatusCode =
  | "m065_s02_ok"
  | "m065_s02_invalid_arg"
  | "m065_s02_nested_contract_failed"
  | "m065_s02_nested_verifier_failed";

export type M065S02CheckStatusCode =
  | "identity_correlated"
  | "identity_mismatch"
  | "nested_report_ok"
  | "nested_report_malformed"
  | "nested_report_failed"
  | "representative_bundle_ok"
  | "representative_bundle_insufficient";

type NestedCommand = "verify:m048:s01" | "verify:m049:s02" | "verify:m064:s03";
type NestedReportKey = "nested_reports.runtimeTiming" | "nested_reports.visibleReview" | "nested_reports.operatorEvidence";

type NestedReportContract = {
  command: NestedCommand;
  generated_at: string;
  success: boolean;
  status_code: string;
  issues: string[];
  [key: string]: unknown;
};

export type M065S02Check = {
  id: M065S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: M065S02CheckStatusCode;
  detail?: string;
  drill_down: {
    command: string;
    report_key: string;
    nested_status_code?: string;
  };
};

export type M065S02Report = {
  command: "verify:m065:s02";
  generated_at: string;
  success: boolean;
  status_code: M065S02StatusCode;
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
  check_ids: M065S02CheckId[];
  checks: M065S02Check[];
  nested_reports: {
    runtimeTiming: M048S01Report | null;
    visibleReview: M049S02Report | null;
    operatorEvidence: M064S03Report | null;
  };
  failing_check_id: M065S02CheckId | null;
  issues: string[];
};

type VerifyM065S02Args = {
  help: boolean;
  json: boolean;
  reviewOutputKey: string | null;
  deliveryId: string | null;
  repo: string | null;
  invalidArg: string | null;
};

type EvaluateRuntimeTiming = (params: { reviewOutputKey: string; deliveryId: string }) => Promise<M048S01Report>;
type EvaluateVisibleReview = (params: { repo: string; reviewOutputKey: string }) => Promise<M049S02Report>;
type EvaluateOperatorEvidence = (params: { reviewOutputKey: string }) => Promise<M064S03Report>;

type EvaluateParams = {
  reviewOutputKey: string;
  generatedAt?: string;
  runtimeTimingEvaluator?: EvaluateRuntimeTiming;
  visibleReviewEvaluator?: EvaluateVisibleReview;
  operatorEvidenceEvaluator?: EvaluateOperatorEvidence;
};

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRepo(repo: string | null | undefined): string | null {
  const normalized = normalizeIdentifier(repo);
  if (!normalized) {
    return null;
  }

  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  return `${parts[0]}/${parts[1]}`;
}

function readOptionValue(args: string[], index: number): { value: string | null; consumed: boolean } {
  const candidate = args[index + 1];
  if (typeof candidate !== "string" || candidate.startsWith("--")) {
    return { value: null, consumed: false };
  }

  return { value: candidate, consumed: true };
}

export function parseVerifyM065S02Args(args: string[]): VerifyM065S02Args {
  let reviewOutputKey: string | null = null;
  let deliveryId: string | null = null;
  let repo: string | null = null;
  let invalidArg: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }

    if (arg === "--review-output-key") {
      const { value, consumed } = readOptionValue(args, index);
      reviewOutputKey = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    if (arg === "--delivery-id") {
      const { value, consumed } = readOptionValue(args, index);
      if (!value) {
        invalidArg = "Missing value for --delivery-id.";
        break;
      }
      deliveryId = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    if (arg === "--repo") {
      const { value, consumed } = readOptionValue(args, index);
      if (!value) {
        invalidArg = "Missing value for --repo.";
        break;
      }
      repo = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    invalidArg = `Unknown argument: ${arg}.`;
    break;
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    reviewOutputKey,
    deliveryId,
    repo,
    invalidArg,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m065:s02 -- --review-output-key <key> [--delivery-id <id>] [--repo <owner/repo>] [--json]",
    "",
    "Options:",
    "  --review-output-key  Required captured reviewOutputKey for the representative live proof target",
    "  --delivery-id        Optional delivery id cross-check; must match the encoded key when provided",
    "  --repo               Optional repo cross-check; must match the encoded key when provided",
    "  --json               Print machine-readable JSON output",
    "  --help               Show this help",
  ].join("\n");
}

function createBaseReport(params: {
  generatedAt?: string;
  reviewOutputKey?: string | null;
  normalizedReviewOutputKey?: string | null;
  deliveryId?: string | null;
  repo?: string | null;
  baseReviewOutputKey?: string | null;
  prNumber?: number | null;
  statusCode: M065S02StatusCode;
  success: boolean;
  checks?: M065S02Check[];
  nestedReports?: M065S02Report["nested_reports"];
  failingCheckId?: M065S02CheckId | null;
  issues?: string[];
}): M065S02Report {
  return {
    command: "verify:m065:s02",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: params.success,
    status_code: params.statusCode,
    review_output_key: params.reviewOutputKey ?? null,
    normalized_review_output_key: params.normalizedReviewOutputKey ?? null,
    delivery_id: params.deliveryId ?? null,
    repo: params.repo ?? null,
    proof_target: {
      review_output_key: params.normalizedReviewOutputKey ?? null,
      base_review_output_key: params.baseReviewOutputKey ?? null,
      delivery_id: params.deliveryId ?? null,
      repo: params.repo ?? null,
      pr_number: params.prNumber ?? null,
    },
    check_ids: [...M065_S02_CHECK_IDS],
    checks: params.checks ?? [],
    nested_reports: params.nestedReports ?? {
      runtimeTiming: null,
      visibleReview: null,
      operatorEvidence: null,
    },
    failing_check_id: params.failingCheckId ?? null,
    issues: params.issues ?? [],
  };
}

function isBaseNestedReportContract(value: unknown, command: NestedCommand): value is NestedReportContract {
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

function isRuntimeTimingReport(value: unknown): value is M048S01Report {
  return isBaseNestedReportContract(value, "verify:m048:s01")
    && typeof (value as Record<string, unknown>).review_output_key !== "undefined"
    && typeof (value as Record<string, unknown>).delivery_id !== "undefined";
}

function isVisibleReviewReport(value: unknown): value is M049S02Report {
  return isBaseNestedReportContract(value, "verify:m049:s02")
    && typeof (value as Record<string, unknown>).repo === "string"
    && typeof (value as Record<string, unknown>).review_output_key !== "undefined"
    && typeof (value as Record<string, unknown>).delivery_id !== "undefined";
}

function isOperatorEvidenceReport(value: unknown): value is M064S03Report {
  return isBaseNestedReportContract(value, "verify:m064:s03")
    && typeof (value as Record<string, unknown>).record_count === "number"
    && Array.isArray((value as Record<string, unknown>).records);
}

function buildIdentityCheck(params?: { issues?: string[] }): M065S02Check {
  const issues = params?.issues ?? [];
  if (issues.length === 0) {
    return {
      id: "M065-S02-IDENTITY-CORRELATION",
      passed: true,
      skipped: false,
      status_code: "identity_correlated",
      detail: "reviewOutputKey is normalized to the captured base identity and all explicit or nested identities agree.",
      drill_down: {
        command: "bun run verify:m065:s02 -- --json",
        report_key: "proof_target",
      },
    };
  }

  return {
    id: "M065-S02-IDENTITY-CORRELATION",
    passed: false,
    skipped: false,
    status_code: "identity_mismatch",
    detail: issues.join(" "),
    drill_down: {
      command: "bun run verify:m065:s02 -- --json",
      report_key: "proof_target",
    },
  };
}

function buildNestedCheck(params: {
  id: Extract<M065S02CheckId, "M065-S02-RUNTIME-TIMING-EVIDENCE" | "M065-S02-VISIBLE-REVIEW-PROOF" | "M065-S02-CANONICAL-OPERATOR-EVIDENCE">;
  reportKey: NestedReportKey;
  command: NestedCommand;
  report: unknown;
  validator: (value: unknown) => boolean;
}): { check: M065S02Check; issue: string | null; malformed: boolean; failed: boolean } {
  const drillDownCommand = `bun run ${params.command} -- --json`;

  if (!params.validator(params.report)) {
    return {
      check: {
        id: params.id,
        passed: false,
        skipped: false,
        status_code: "nested_report_malformed",
        detail: `${params.command} omitted one or more required fields: command, generated_at, success, status_code, and issues.`,
        drill_down: {
          command: drillDownCommand,
          report_key: params.reportKey,
        },
      },
      issue: `${params.id}: malformed nested report from ${params.command}`,
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
        detail: `${params.command} failed with status_code=${params.report.status_code}. Run ${drillDownCommand} for drill-down.`,
        drill_down: {
          command: drillDownCommand,
          report_key: params.reportKey,
          nested_status_code: params.report.status_code,
        },
      },
      issue: `${params.id}: ${params.command} returned ${params.report.status_code}`,
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
      detail: `Preserved authoritative ${params.command} report.`,
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

function buildRepresentativeBundleCheck(params: { issues?: string[] }): M065S02Check {
  const issues = params.issues ?? [];
  if (issues.length === 0) {
    return {
      id: "M065-S02-REPRESENTATIVE-LIVE-BUNDLE",
      passed: true,
      skipped: false,
      status_code: "representative_bundle_ok",
      detail: "Runtime timing, visible review proof, and canonical operator evidence describe the same captured live large-PR run.",
      drill_down: {
        command: "bun run verify:m065:s02 -- --json",
        report_key: "checks[4]",
      },
    };
  }

  return {
    id: "M065-S02-REPRESENTATIVE-LIVE-BUNDLE",
    passed: false,
    skipped: false,
    status_code: "representative_bundle_insufficient",
    detail: issues.join(" "),
    drill_down: {
      command: "bun run verify:m065:s02 -- --json",
      report_key: "checks[4]",
    },
  };
}

function validateArgs(options: VerifyM065S02Args): {
  reviewOutputKey: string;
  normalizedReviewOutputKey: string;
  deliveryId: string;
  repo: string;
  baseReviewOutputKey: string;
  prNumber: number;
} | { issues: string[] } {
  const issues: string[] = [];
  const rawReviewOutputKey = normalizeIdentifier(options.reviewOutputKey);

  if (!rawReviewOutputKey) {
    issues.push("Missing required --review-output-key.");
    return { issues };
  }

  const parsedKey = parseReviewOutputKey(rawReviewOutputKey);
  if (!parsedKey) {
    issues.push("Malformed --review-output-key.");
    return { issues };
  }

  const normalizedDeliveryId = normalizeIdentifier(options.deliveryId);
  if (normalizedDeliveryId && normalizedDeliveryId !== parsedKey.deliveryId) {
    issues.push("Provided --delivery-id does not match the delivery id encoded in --review-output-key.");
  }

  let normalizedRepo = parsedKey.repoFullName;
  if (options.repo !== null) {
    const explicitRepo = normalizeRepo(options.repo);
    if (!explicitRepo) {
      issues.push(`Invalid repo '${options.repo}'. Expected owner/repo.`);
    } else if (explicitRepo !== parsedKey.repoFullName) {
      issues.push("Provided --repo does not match the repository encoded in --review-output-key.");
    } else {
      normalizedRepo = explicitRepo;
    }
  }

  if (issues.length > 0) {
    return { issues };
  }

  return {
    reviewOutputKey: rawReviewOutputKey,
    normalizedReviewOutputKey: parsedKey.baseReviewOutputKey,
    deliveryId: parsedKey.deliveryId,
    repo: normalizedRepo,
    baseReviewOutputKey: parsedKey.baseReviewOutputKey,
    prNumber: parsedKey.prNumber,
  };
}

function collectIdentityIssues(params: {
  expectedReviewOutputKey: string;
  expectedDeliveryId: string;
  expectedRepo: string;
  expectedPrNumber: number;
  runtimeReport: M048S01Report | null;
  visibleReport: M049S02Report | null;
  operatorReport: M064S03Report | null;
}): string[] {
  const issues: string[] = [];

  const runtimeKey = parseReviewOutputKey(normalizeIdentifier(params.runtimeReport?.review_output_key) ?? "")?.baseReviewOutputKey;
  if (runtimeKey && runtimeKey !== params.expectedReviewOutputKey) {
    issues.push(`runtime timing evidence review_output_key mismatch: expected ${params.expectedReviewOutputKey}, got ${runtimeKey}.`);
  }

  const runtimeDeliveryId = normalizeIdentifier(params.runtimeReport?.delivery_id);
  if (runtimeDeliveryId && runtimeDeliveryId !== params.expectedDeliveryId) {
    issues.push(`runtime timing evidence delivery_id mismatch: expected ${params.expectedDeliveryId}, got ${runtimeDeliveryId}.`);
  }

  const visibleKey = parseReviewOutputKey(normalizeIdentifier(params.visibleReport?.review_output_key) ?? "")?.baseReviewOutputKey;
  if (visibleKey && visibleKey !== params.expectedReviewOutputKey) {
    issues.push(`visible review proof review_output_key mismatch: expected ${params.expectedReviewOutputKey}, got ${visibleKey}.`);
  }

  const visibleDeliveryId = normalizeIdentifier(params.visibleReport?.delivery_id);
  if (visibleDeliveryId && visibleDeliveryId !== params.expectedDeliveryId) {
    issues.push(`visible review proof delivery_id mismatch: expected ${params.expectedDeliveryId}, got ${visibleDeliveryId}.`);
  }

  const visibleRepo = normalizeRepo(params.visibleReport?.repo);
  if (visibleRepo && visibleRepo !== params.expectedRepo) {
    issues.push(`visible review proof repo mismatch: expected ${params.expectedRepo}, got ${visibleRepo}.`);
  }

  const visiblePrNumber = params.visibleReport?.artifact?.prNumber;
  if (typeof visiblePrNumber === "number" && visiblePrNumber !== params.expectedPrNumber) {
    issues.push(`visible review proof pr_number mismatch: expected ${params.expectedPrNumber}, got ${visiblePrNumber}.`);
  }

  const operatorRecord = params.operatorReport?.records?.[0] ?? null;
  const operatorBaseKey = parseReviewOutputKey(normalizeIdentifier(operatorRecord?.baseReviewOutputKey) ?? "")?.baseReviewOutputKey;
  if (operatorBaseKey && operatorBaseKey !== params.expectedReviewOutputKey) {
    issues.push(`operator evidence base_review_output_key mismatch: expected ${params.expectedReviewOutputKey}, got ${operatorBaseKey}.`);
  }

  const operatorRepo = normalizeRepo(operatorRecord?.repoFullName);
  if (operatorRepo && operatorRepo !== params.expectedRepo) {
    issues.push(`operator evidence repo mismatch: expected ${params.expectedRepo}, got ${operatorRepo}.`);
  }

  const operatorPrNumber = operatorRecord?.prNumber;
  if (typeof operatorPrNumber === "number" && operatorPrNumber !== params.expectedPrNumber) {
    issues.push(`operator evidence pr_number mismatch: expected ${params.expectedPrNumber}, got ${operatorPrNumber}.`);
  }

  return issues;
}

function collectRepresentativeBundleIssues(params: {
  runtimeReport: M048S01Report | null;
  visibleReport: M049S02Report | null;
  operatorReport: M064S03Report | null;
}): string[] {
  const issues: string[] = [];

  if (params.runtimeReport?.evidence?.conclusion !== "success" || params.runtimeReport?.evidence?.published !== true) {
    issues.push("runtime timing evidence must show a successful published review lifecycle.");
  }

  if (params.visibleReport?.artifact?.source !== "review") {
    issues.push("visible review proof must resolve to the canonical review surface.");
  }

  if (params.visibleReport?.artifact?.reviewState !== "APPROVED") {
    issues.push("visible review proof must show APPROVED review state.");
  }

  if (params.visibleReport?.bodyContract?.valid !== true) {
    issues.push("visible review proof body contract must validate.");
  }

  const operatorRecord = params.operatorReport?.records?.[0] ?? null;
  if (!operatorRecord) {
    issues.push("canonical operator evidence did not return a resolved operator record.");
  } else if (operatorRecord.statusCode !== "canonical") {
    issues.push(`operator evidence status ${operatorRecord.statusCode} is not sufficient for representative live proof.`);
  }

  return issues;
}

function deriveOverallStatus(checks: M065S02Check[]): Pick<M065S02Report, "success" | "status_code" | "failing_check_id"> {
  const firstMalformed = checks.find((check) => check.status_code === "nested_report_malformed");
  if (firstMalformed) {
    return {
      success: false,
      status_code: "m065_s02_nested_contract_failed",
      failing_check_id: firstMalformed.id,
    };
  }

  const firstFailed = checks.find((check) => !check.passed);
  if (firstFailed) {
    return {
      success: false,
      status_code: "m065_s02_nested_verifier_failed",
      failing_check_id: firstFailed.id,
    };
  }

  return {
    success: true,
    status_code: "m065_s02_ok",
    failing_check_id: null,
  };
}

export async function evaluateM065S02(params: EvaluateParams): Promise<M065S02Report> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const parsedKey = parseReviewOutputKey(params.reviewOutputKey);
  if (!parsedKey) {
    return createBaseReport({
      generatedAt,
      reviewOutputKey: params.reviewOutputKey,
      normalizedReviewOutputKey: normalizeIdentifier(params.reviewOutputKey),
      statusCode: "m065_s02_invalid_arg",
      success: false,
      issues: ["Malformed --review-output-key."],
    });
  }

  const baseReviewOutputKey = parsedKey.baseReviewOutputKey;
  const deliveryId = parsedKey.deliveryId;
  const repo = parsedKey.repoFullName;

  const runtimeTiming = await (params.runtimeTimingEvaluator ?? ((runtimeParams) => evaluateM048S01(runtimeParams)))({
    reviewOutputKey: baseReviewOutputKey,
    deliveryId,
  });
  const visibleReview = await (params.visibleReviewEvaluator ?? ((visibleParams) => evaluateM049S02(visibleParams)))({
    repo,
    reviewOutputKey: baseReviewOutputKey,
  });
  const operatorEvidence = await (params.operatorEvidenceEvaluator ?? ((operatorParams) => evaluateM064S03(operatorParams)))({
    reviewOutputKey: baseReviewOutputKey,
  });

  const nestedReports: M065S02Report["nested_reports"] = {
    runtimeTiming: isRuntimeTimingReport(runtimeTiming) ? runtimeTiming : null,
    visibleReview: isVisibleReviewReport(visibleReview) ? visibleReview : null,
    operatorEvidence: isOperatorEvidenceReport(operatorEvidence) ? operatorEvidence : null,
  };

  const runtimeCheck = buildNestedCheck({
    id: "M065-S02-RUNTIME-TIMING-EVIDENCE",
    reportKey: "nested_reports.runtimeTiming",
    command: "verify:m048:s01",
    report: runtimeTiming,
    validator: isRuntimeTimingReport,
  });
  const visibleCheck = buildNestedCheck({
    id: "M065-S02-VISIBLE-REVIEW-PROOF",
    reportKey: "nested_reports.visibleReview",
    command: "verify:m049:s02",
    report: visibleReview,
    validator: isVisibleReviewReport,
  });
  const operatorCheck = buildNestedCheck({
    id: "M065-S02-CANONICAL-OPERATOR-EVIDENCE",
    reportKey: "nested_reports.operatorEvidence",
    command: "verify:m064:s03",
    report: operatorEvidence,
    validator: isOperatorEvidenceReport,
  });

  const issues: string[] = [];
  for (const result of [runtimeCheck, visibleCheck, operatorCheck]) {
    if (result.issue) {
      issues.push(result.issue);
    }
  }

  const safeRuntimeReport = isRuntimeTimingReport(runtimeTiming) ? runtimeTiming : null;
  const safeVisibleReport = isVisibleReviewReport(visibleReview) ? visibleReview : null;
  const safeOperatorReport = isOperatorEvidenceReport(operatorEvidence) ? operatorEvidence : null;

  const identityIssues = collectIdentityIssues({
    expectedReviewOutputKey: baseReviewOutputKey,
    expectedDeliveryId: deliveryId,
    expectedRepo: repo,
    expectedPrNumber: parsedKey.prNumber,
    runtimeReport: safeRuntimeReport,
    visibleReport: safeVisibleReport,
    operatorReport: safeOperatorReport,
  });
  issues.push(...identityIssues.map((issue) => `M065-S02-IDENTITY-CORRELATION: ${issue}`));

  const representativeBundleIssues = collectRepresentativeBundleIssues({
    runtimeReport: safeRuntimeReport,
    visibleReport: safeVisibleReport,
    operatorReport: safeOperatorReport,
  });
  issues.push(...representativeBundleIssues.map((issue) => `M065-S02-REPRESENTATIVE-LIVE-BUNDLE: ${issue}`));

  const checks: M065S02Check[] = [
    buildIdentityCheck({ issues: identityIssues }),
    runtimeCheck.check,
    visibleCheck.check,
    operatorCheck.check,
    buildRepresentativeBundleCheck({ issues: representativeBundleIssues }),
  ];

  const overall = deriveOverallStatus(checks);

  return createBaseReport({
    generatedAt,
    reviewOutputKey: params.reviewOutputKey,
    normalizedReviewOutputKey: baseReviewOutputKey,
    deliveryId,
    repo,
    baseReviewOutputKey,
    prNumber: parsedKey.prNumber,
    statusCode: overall.status_code,
    success: overall.success,
    checks,
    nestedReports,
    failingCheckId: overall.failing_check_id,
    issues,
  });
}

export function renderM065S02Report(report: M065S02Report): string {
  const lines = [
    "# M065 S02 — Representative Live Large-PR Proof",
    "",
    `Status: ${report.status_code}`,
    `Review output key: ${report.review_output_key ?? "unavailable"}`,
    `Normalized review output key: ${report.normalized_review_output_key ?? "unavailable"}`,
    `Delivery id: ${report.delivery_id ?? "unavailable"}`,
    `Repo: ${report.repo ?? "unavailable"}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    "",
    "Checks:",
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
    evaluate?: (params: { reviewOutputKey: string; deliveryId?: string; repo?: string }) => Promise<M065S02Report>;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const options = parseVerifyM065S02Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.invalidArg) {
    const report = createBaseReport({
      reviewOutputKey: normalizeIdentifier(options.reviewOutputKey),
      normalizedReviewOutputKey: normalizeIdentifier(options.reviewOutputKey),
      deliveryId: normalizeIdentifier(options.deliveryId),
      repo: normalizeRepo(options.repo) ?? normalizeIdentifier(options.repo),
      statusCode: "m065_s02_invalid_arg",
      success: false,
      issues: [options.invalidArg],
    });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM065S02Report(report));
    return 1;
  }

  const validated = validateArgs(options);
  if ("issues" in validated) {
    const report = createBaseReport({
      reviewOutputKey: normalizeIdentifier(options.reviewOutputKey),
      normalizedReviewOutputKey: parseReviewOutputKey(normalizeIdentifier(options.reviewOutputKey) ?? "")?.baseReviewOutputKey ?? normalizeIdentifier(options.reviewOutputKey),
      deliveryId: normalizeIdentifier(options.deliveryId),
      repo: normalizeRepo(options.repo) ?? normalizeIdentifier(options.repo),
      statusCode: "m065_s02_invalid_arg",
      success: false,
      issues: validated.issues,
    });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM065S02Report(report));
    return 1;
  }

  const report = await (deps?.evaluate ?? ((evaluateParams) => evaluateM065S02({
    reviewOutputKey: evaluateParams.reviewOutputKey,
  })))({
    reviewOutputKey: validated.reviewOutputKey,
    deliveryId: validated.deliveryId,
    repo: validated.repo,
  });

  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM065S02Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
