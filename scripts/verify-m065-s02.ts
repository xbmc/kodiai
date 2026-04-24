import { parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";

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
  | "m065_s02_nested_verifier_failed"
  | "m065_s02_live_proof_pending";

export type M065S02CheckStatusCode =
  | "identity_correlated"
  | "nested_report_ok"
  | "nested_report_malformed"
  | "nested_report_failed"
  | "representative_bundle_pending";

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
    runtimeTiming: NestedReportContract | null;
    visibleReview: NestedReportContract | null;
    operatorEvidence: NestedReportContract | null;
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
      review_output_key: params.reviewOutputKey ?? null,
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

function isNestedReportContract(value: unknown, command: NestedCommand): value is NestedReportContract {
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

function buildIdentityCheck(): M065S02Check {
  return {
    id: "M065-S02-IDENTITY-CORRELATION",
    passed: true,
    skipped: false,
    status_code: "identity_correlated",
    detail: "reviewOutputKey is the authoritative proof target; explicit repo and delivery filters agree.",
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
}): { check: M065S02Check; issue: string | null; malformed: boolean; failed: boolean } {
  const drillDownCommand = `bun run ${params.command} -- --json`;

  if (!isNestedReportContract(params.report, params.command)) {
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

function buildRepresentativeBundleCheck(): M065S02Check {
  return {
    id: "M065-S02-REPRESENTATIVE-LIVE-BUNDLE",
    passed: false,
    skipped: true,
    status_code: "representative_bundle_pending",
    detail: "T01 pins the live-proof contract only; T02 must prove the bundle is representative.",
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
  const normalizedReviewOutputKey = normalizeIdentifier(options.reviewOutputKey);

  if (!normalizedReviewOutputKey) {
    issues.push("Missing required --review-output-key.");
    return { issues };
  }

  const parsedKey = parseReviewOutputKey(normalizedReviewOutputKey);
  if (!parsedKey) {
    issues.push("Malformed --review-output-key.");
    return { issues };
  }

  const normalizedDeliveryId = normalizeIdentifier(options.deliveryId);
  if (normalizedDeliveryId && normalizedDeliveryId !== parsedKey.effectiveDeliveryId) {
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
    reviewOutputKey: normalizedReviewOutputKey,
    normalizedReviewOutputKey,
    deliveryId: normalizedDeliveryId ?? parsedKey.effectiveDeliveryId,
    repo: normalizedRepo,
    baseReviewOutputKey: parsedKey.baseReviewOutputKey,
    prNumber: parsedKey.prNumber,
  };
}

export async function evaluateM065S02(params: {
  reviewOutputKey: string;
  generatedAt?: string;
  nestedReports?: Partial<M065S02Report["nested_reports"]>;
}): Promise<M065S02Report> {
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

  const nestedReports: M065S02Report["nested_reports"] = {
    runtimeTiming: (params.nestedReports?.runtimeTiming ?? null) as NestedReportContract | null,
    visibleReview: (params.nestedReports?.visibleReview ?? null) as NestedReportContract | null,
    operatorEvidence: (params.nestedReports?.operatorEvidence ?? null) as NestedReportContract | null,
  };

  const checks: M065S02Check[] = [buildIdentityCheck()];
  const issues: string[] = [];

  const runtimeCheck = buildNestedCheck({
    id: "M065-S02-RUNTIME-TIMING-EVIDENCE",
    reportKey: "nested_reports.runtimeTiming",
    command: "verify:m048:s01",
    report: nestedReports.runtimeTiming,
  });
  const visibleCheck = buildNestedCheck({
    id: "M065-S02-VISIBLE-REVIEW-PROOF",
    reportKey: "nested_reports.visibleReview",
    command: "verify:m049:s02",
    report: nestedReports.visibleReview,
  });
  const operatorCheck = buildNestedCheck({
    id: "M065-S02-CANONICAL-OPERATOR-EVIDENCE",
    reportKey: "nested_reports.operatorEvidence",
    command: "verify:m064:s03",
    report: nestedReports.operatorEvidence,
  });

  checks.push(runtimeCheck.check, visibleCheck.check, operatorCheck.check);
  for (const result of [runtimeCheck, visibleCheck, operatorCheck]) {
    if (result.issue) {
      issues.push(result.issue);
    }
  }

  const firstMalformed = [runtimeCheck, visibleCheck, operatorCheck].find((result) => result.malformed);
  if (firstMalformed) {
    const representativeCheck = buildRepresentativeBundleCheck();
    checks.push(representativeCheck);
    return createBaseReport({
      generatedAt,
      reviewOutputKey: params.reviewOutputKey,
      normalizedReviewOutputKey: params.reviewOutputKey,
      deliveryId: parsedKey.effectiveDeliveryId,
      repo: parsedKey.repoFullName,
      baseReviewOutputKey: parsedKey.baseReviewOutputKey,
      prNumber: parsedKey.prNumber,
      statusCode: "m065_s02_nested_contract_failed",
      success: false,
      checks,
      nestedReports,
      failingCheckId: firstMalformed.check.id,
      issues,
    });
  }

  const firstFailed = [runtimeCheck, visibleCheck, operatorCheck].find((result) => result.failed);
  if (firstFailed) {
    const representativeCheck = buildRepresentativeBundleCheck();
    checks.push(representativeCheck);
    return createBaseReport({
      generatedAt,
      reviewOutputKey: params.reviewOutputKey,
      normalizedReviewOutputKey: params.reviewOutputKey,
      deliveryId: parsedKey.effectiveDeliveryId,
      repo: parsedKey.repoFullName,
      baseReviewOutputKey: parsedKey.baseReviewOutputKey,
      prNumber: parsedKey.prNumber,
      statusCode: "m065_s02_nested_verifier_failed",
      success: false,
      checks,
      nestedReports,
      failingCheckId: firstFailed.check.id,
      issues,
    });
  }

  const representativeCheck = buildRepresentativeBundleCheck();
  checks.push(representativeCheck);

  return createBaseReport({
    generatedAt,
    reviewOutputKey: params.reviewOutputKey,
    normalizedReviewOutputKey: params.reviewOutputKey,
    deliveryId: parsedKey.effectiveDeliveryId,
    repo: parsedKey.repoFullName,
    baseReviewOutputKey: parsedKey.baseReviewOutputKey,
    prNumber: parsedKey.prNumber,
    statusCode: "m065_s02_live_proof_pending",
    success: false,
    checks,
    nestedReports,
    failingCheckId: representativeCheck.id,
    issues,
  });
}

export function renderM065S02Report(report: M065S02Report): string {
  const lines = [
    "# M065 S02 — Representative Live Large-PR Proof",
    "",
    `Status: ${report.status_code}`,
    `Review output key: ${report.review_output_key ?? "unavailable"}`,
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
      normalizedReviewOutputKey: normalizeIdentifier(options.reviewOutputKey),
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
