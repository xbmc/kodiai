import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CheckerReport } from "./check-migrations-have-downs.ts";
import { evaluateMigrationPairing } from "./check-migrations-have-downs.ts";

const COMMAND_NAME = "verify:m056:s03" as const;
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m056-s03.ts";
const EXPECTED_CHECKER_COMMAND = "check:migrations-have-downs" as const;
const EXPECTED_CI_STEP = "bun run verify:m056:s03";
const CI_TEST_STEP_MARKERS = [
  "bun test --max-concurrency=2 scripts",
  "bun test --max-concurrency=2 src/knowledge",
  "bunx tsc --noEmit",
] as const;

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const CI_WORKFLOW_PATH = path.resolve(REPO_ROOT, ".github/workflows/ci.yml");

export const M056_S03_CHECK_IDS = [
  "M056-S03-CHECKER-STATE",
  "M056-S03-PACKAGE-WIRING",
  "M056-S03-CI-WIRING",
] as const;

export type M056S03CheckId = (typeof M056_S03_CHECK_IDS)[number];

export type Check = {
  id: M056S03CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M056S03CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  runChecker?: () => Promise<CheckerReport>;
  readTextFile?: (filePath: string) => Promise<string>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

export async function evaluateM056S03Proof(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runChecker = options.runChecker ?? defaultRunChecker;
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  const checkerCheck = await buildCheckerStateCheck(runChecker);
  const packageContent = await readOptionalTextFile(readTextFile, PACKAGE_JSON_PATH);
  const ciContent = await readOptionalTextFile(readTextFile, CI_WORKFLOW_PATH);

  const checks: Check[] = [
    checkerCheck,
    packageContent.ok
      ? buildPackageWiringCheck(packageContent.content)
      : failCheck("M056-S03-PACKAGE-WIRING", "package_file_unreadable", packageContent.error),
    ciContent.ok
      ? buildCiWiringCheck(ciContent.content)
      : failCheck("M056-S03-CI-WIRING", "ci_file_unreadable", ciContent.error),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M056_S03_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM056S03Report(report: EvaluationReport): string {
  const lines = [
    "M056 S03 paired migration proof verifier",
    `Generated at: ${report.generatedAt}`,
    `Paired migration proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM056S03ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM056S03Proof(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM056S03Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`${COMMAND_NAME} failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM056S03Args(args: readonly string[]): { json: boolean } {
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { json };
}

async function buildCheckerStateCheck(
  runChecker: () => Promise<CheckerReport>,
): Promise<Check> {
  let report: CheckerReport;
  try {
    report = await runChecker();
  } catch (error) {
    return failCheck("M056-S03-CHECKER-STATE", "checker_invocation_failed", error);
  }

  if (!isCheckerReport(report)) {
    return failCheck(
      "M056-S03-CHECKER-STATE",
      "checker_report_invalid",
      "check:migrations-have-downs did not return the expected report envelope.",
    );
  }

  if (!report.overallPassed) {
    const failingChecks = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");

    return failCheck(
      "M056-S03-CHECKER-STATE",
      "checker_failed",
      failingChecks.length > 0
        ? `check:migrations-have-downs reported failures: ${failingChecks}`
        : "check:migrations-have-downs reported overallPassed=false.",
    );
  }

  return passCheck(
    "M056-S03-CHECKER-STATE",
    "checker_passed",
    "check:migrations-have-downs passed with a valid machine-readable report envelope.",
  );
}

function buildPackageWiringCheck(packageJsonContent: string): Check {
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck("M056-S03-PACKAGE-WIRING", "package_json_invalid", error);
  }

  const actualScript = packageJson.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M056-S03-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M056-S03-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M056-S03-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function buildCiWiringCheck(ciContent: string): Check {
  const verifyStepIndex = ciContent.indexOf(EXPECTED_CI_STEP);
  if (verifyStepIndex === -1) {
    return failCheck(
      "M056-S03-CI-WIRING",
      "ci_verify_step_missing",
      `.github/workflows/ci.yml must run ${EXPECTED_CI_STEP} before the broader Bun test steps.`,
    );
  }

  for (const marker of CI_TEST_STEP_MARKERS) {
    const markerIndex = ciContent.indexOf(marker);
    if (markerIndex !== -1 && verifyStepIndex > markerIndex) {
      return failCheck(
        "M056-S03-CI-WIRING",
        "ci_verify_step_misordered",
        `${EXPECTED_CI_STEP} must appear before ${marker} in .github/workflows/ci.yml.`,
      );
    }
  }

  return passCheck(
    "M056-S03-CI-WIRING",
    "ci_wiring_ok",
    `.github/workflows/ci.yml runs ${EXPECTED_CI_STEP} before the broader Bun test steps.`,
  );
}

function isCheckerReport(value: unknown): value is CheckerReport {
  if (typeof value !== "object" || value == null) {
    return false;
  }

  const candidate = value as Partial<CheckerReport>;
  return (
    candidate.command === EXPECTED_CHECKER_COMMAND &&
    typeof candidate.generatedAt === "string" &&
    typeof candidate.overallPassed === "boolean" &&
    Array.isArray(candidate.check_ids) &&
    Array.isArray(candidate.checks)
  );
}

function passCheck(id: M056S03CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M056S03CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: false,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function normalizeDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return detail.message;
  }
  if (typeof detail === "string") {
    return detail;
  }
  return String(detail);
}

async function readOptionalTextFile(
  readTextFile: (filePath: string) => Promise<string>,
  filePath: string,
): Promise<{ ok: true; content: string } | { ok: false; error: unknown }> {
  try {
    return { ok: true, content: await readTextFile(filePath) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function defaultRunChecker(): Promise<CheckerReport> {
  return evaluateMigrationPairing();
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

if (import.meta.main) {
  try {
    const args = parseM056S03Args(process.argv.slice(2));
    const { exitCode } = await buildM056S03ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
