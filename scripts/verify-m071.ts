import { readFileSync } from "node:fs";

import {
  ISSUE_131_CHECK_IDS,
  ISSUE_131_SOURCE_PATHS,
  evaluateIssue131EvidenceMatrix,
  findForbiddenReportFields,
  type Issue131Check,
  type Issue131CheckId,
  type Issue131EvidenceMatrixReport,
  type Issue131IssueCategory,
  type Issue131MatrixRow,
  type Issue131SourcePath,
} from "../src/issue-131/evidence-matrix.ts";

export const COMMAND_NAME = "verify:m071" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m071.ts" as const;

export const M071_STATUS_CODES = [
  "m071_issue_131_matrix_ok",
  "m071_issue_131_matrix_failed",
  "m071_invalid_arg",
] as const;

export type M071StatusCode = typeof M071_STATUS_CODES[number];

export type M071Args = {
  readonly json: boolean;
  readonly help: boolean;
  readonly expectStatus: M071StatusCode | null;
};

export type M071PackageWiring = {
  readonly scriptName: typeof COMMAND_NAME;
  readonly expected: typeof EXPECTED_PACKAGE_SCRIPT;
  readonly present: boolean;
  readonly matches: boolean;
};

export type M071VerifierCheck = Omit<Issue131Check, "status"> & {
  readonly status: "pass" | "fail";
  readonly status_code: M071StatusCode;
};

export type M071VerifierReport = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "repo-source-evidence-matrix";
  readonly success: boolean;
  readonly status_code: M071StatusCode;
  readonly check_ids: readonly Issue131CheckId[];
  readonly checks: readonly M071VerifierCheck[];
  readonly failing_check_id: Issue131CheckId | null;
  readonly rows: readonly Issue131MatrixRow[];
  readonly counts: Issue131EvidenceMatrixReport["counts"];
  readonly packageWiring: M071PackageWiring;
  readonly issue_categories: readonly Issue131IssueCategory[];
  readonly issues: readonly string[];
};

export type M071MainDeps = {
  readonly stdout?: { write(chunk: string): void };
  readonly stderr?: { write(chunk: string): void };
  readonly generatedAt?: string;
  readonly readFileText?: (path: Issue131SourcePath) => string | undefined;
  readonly readPackageJsonText?: () => string | undefined;
  readonly evaluate?: typeof evaluateM071VerifierContract;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeLine(writer: { write(chunk: string): void } | undefined, chunk: string): void {
  writer?.write(chunk);
}

function boundedIssue(message: string): string {
  if (message.startsWith("invalid_cli_args:")) return message.slice(0, 240);
  if (message.includes("package.json")) return message.slice(0, 240);
  return "m071 verifier dependency failed.";
}

export function parseM071Args(argv: readonly string[]): M071Args {
  let json = false;
  let help = false;
  let expectStatus: M071StatusCode | null = null;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--expect-status") {
      const value = argv[index + 1];
      if (!M071_STATUS_CODES.includes(value as M071StatusCode)) {
        throw new Error(`invalid_cli_args: --expect-status must be one of ${M071_STATUS_CODES.join(",")}`);
      }
      expectStatus = value as M071StatusCode;
      index++;
    } else {
      throw new Error(`invalid_cli_args: unsupported argument ${arg}`);
    }
  }

  return { json, help, expectStatus };
}

function readSourceFile(path: Issue131SourcePath): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function parsePackageWiring(packageJsonText: string | undefined): M071PackageWiring {
  if (typeof packageJsonText !== "string") {
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false };
  }
  try {
    const parsed = JSON.parse(packageJsonText) as unknown;
    const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
    const script = scripts[COMMAND_NAME];
    return {
      scriptName: COMMAND_NAME,
      expected: EXPECTED_PACKAGE_SCRIPT,
      present: typeof script === "string",
      matches: script === EXPECTED_PACKAGE_SCRIPT,
    };
  } catch {
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false };
  }
}

function normalizeChecks(report: Issue131EvidenceMatrixReport, packageWiring: M071PackageWiring): M071VerifierCheck[] {
  return report.checks.map((check) => {
    const passed = check.id === "M071-ISSUE-131-PACKAGE-WIRING" ? check.passed && packageWiring.matches : check.passed;
    return {
      ...check,
      passed,
      status: passed ? "pass" : "fail",
      status_code: passed ? "m071_issue_131_matrix_ok" : "m071_issue_131_matrix_failed",
      detail: check.id === "M071-ISSUE-131-PACKAGE-WIRING" && !packageWiring.matches
        ? `package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`
        : check.detail,
    };
  });
}

function collectIssueCategories(checks: readonly M071VerifierCheck[], rows: readonly Issue131MatrixRow[]): Issue131IssueCategory[] {
  return [...new Set([...rows.flatMap((row) => row.issueCategories), ...checks.flatMap((check) => check.issueCategories)])].sort();
}

export function evaluateM071VerifierContract(options: {
  readonly generatedAt?: string;
  readonly readFileText?: (path: Issue131SourcePath) => string | undefined;
  readonly readPackageJsonText?: () => string | undefined;
} = {}): M071VerifierReport {
  const readFileText = options.readFileText ?? readSourceFile;
  let packageJsonText: string | undefined;
  try {
    packageJsonText = (options.readPackageJsonText ?? (() => readFileSync("package.json", "utf8")))();
  } catch {
    packageJsonText = undefined;
  }

  const evaluatorReport = evaluateIssue131EvidenceMatrix({
    generatedAt: options.generatedAt,
    readFileText: (path) => ISSUE_131_SOURCE_PATHS.includes(path) ? readFileText(path) : undefined,
    readPackageJsonText: () => packageJsonText,
  });
  const packageWiring = parsePackageWiring(packageJsonText);
  const checks = normalizeChecks(evaluatorReport, packageWiring);
  const safetyFindings = findForbiddenReportFields({ rows: evaluatorReport.rows, packageWiring });
  const issues = [...evaluatorReport.issues];
  if (!packageWiring.matches) {
    issues.push(`package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`);
  }
  if (safetyFindings.length > 0) {
    issues.push(`Forbidden raw report fields detected: ${safetyFindings.join(", ")}.`);
  }
  const finalChecks = safetyFindings.length === 0
    ? checks
    : checks.map((check) => check.id === "M071-ISSUE-131-REPORT-SAFETY"
      ? { ...check, passed: false, status: "fail" as const, status_code: "m071_issue_131_matrix_failed" as const, detail: `Forbidden raw report fields detected: ${safetyFindings.join(", ")}.` }
      : check);
  const failingCheck = finalChecks.find((check) => !check.passed) ?? null;
  const success = failingCheck === null;

  return {
    command: COMMAND_NAME,
    generated_at: evaluatorReport.generatedAt,
    proofMode: "repo-source-evidence-matrix",
    success,
    status_code: success ? "m071_issue_131_matrix_ok" : "m071_issue_131_matrix_failed",
    check_ids: ISSUE_131_CHECK_IDS,
    checks: finalChecks,
    failing_check_id: failingCheck?.id ?? null,
    rows: evaluatorReport.rows,
    counts: evaluatorReport.counts,
    packageWiring,
    issue_categories: collectIssueCategories(finalChecks, evaluatorReport.rows),
    issues,
  };
}

function helpText(): string {
  return `Usage: bun run verify:m071 [--json] [--expect-status ${M071_STATUS_CODES.join("|")}]

Builds the repo-source issue #131 evidence matrix from bounded checked-in source files.
Success means the matrix contract is well-formed and fail-closed; rows may still be missing, partial, or deferred.
`;
}

function renderHuman(report: M071VerifierReport): string {
  return [
    `${COMMAND_NAME} ${report.status_code} success=${report.success}`,
    `package: ${report.packageWiring.matches ? "wired" : "unwired"}`,
    "rows:",
    ...report.rows.map((row) => `- ${row.id}: ${row.status}`),
    ...(report.issues.length > 0 ? ["issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

function buildInvalidArgReport(issue: string): M071VerifierReport {
  const detail = boundedIssue(issue);
  const check: M071VerifierCheck = {
    id: "M071-ISSUE-131-STATUS-TAXONOMY",
    passed: false,
    status: "fail",
    status_code: "m071_invalid_arg",
    issueCategories: ["weak_evidence"],
    detail: "CLI argument parsing failed.",
  };
  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    proofMode: "repo-source-evidence-matrix",
    success: false,
    status_code: "m071_invalid_arg",
    check_ids: ISSUE_131_CHECK_IDS,
    checks: [check],
    failing_check_id: check.id,
    rows: [],
    counts: { complete: 0, partial: 0, missing: 0, deferred: 0 },
    packageWiring: { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false },
    issue_categories: ["weak_evidence"],
    issues: [detail],
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2), deps: M071MainDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: M071Args;
  try {
    args = parseM071Args(argv);
  } catch (error) {
    const report = buildInvalidArgReport(error instanceof Error ? error.message : String(error));
    writeLine(stdout, `${JSON.stringify(report, null, 2)}\n`);
    writeLine(stderr, `${report.issues[0]}\n`);
    return 2;
  }

  if (args.help) {
    writeLine(stdout, helpText());
    return 0;
  }

  const evaluate = deps.evaluate ?? evaluateM071VerifierContract;
  const report = evaluate({
    generatedAt: deps.generatedAt,
    readFileText: deps.readFileText,
    readPackageJsonText: deps.readPackageJsonText,
  });

  if (args.json) {
    writeLine(stdout, `${JSON.stringify(report, null, 2)}\n`);
  } else {
    writeLine(stdout, renderHuman(report));
  }

  const expectedStatusMatched = args.expectStatus !== null && report.status_code === args.expectStatus;
  if (!report.success && !expectedStatusMatched) {
    writeLine(stderr, `${COMMAND_NAME} failed: ${report.failing_check_id ?? "unknown"}\n`);
  }
  if (args.expectStatus !== null) {
    if (!expectedStatusMatched) {
      writeLine(stderr, `${COMMAND_NAME} expected status ${args.expectStatus} but got ${report.status_code}\n`);
    }
    return expectedStatusMatched ? 0 : 1;
  }
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
