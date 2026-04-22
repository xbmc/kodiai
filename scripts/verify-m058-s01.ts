import { readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m058:s01" as const;
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m058-s01.ts";
const EXPECTED_VERIFY_STEP = "bun run verify:m056:s03";
const EXPECTED_BROAD_TEST_STEP = "bun test --max-concurrency=2 scripts src";
const EXPECTED_KNOWLEDGE_TEST_STEP = "bun test --max-concurrency=2 src/knowledge";
const REQUIRED_SPLIT_RATIONALE_MARKERS = [
  "Bun has been unstable on GitHub runners with one monolithic test process.",
  "Keep DB-backed tests on a low concurrency cap and split the suite into",
  "two shorter invocations to avoid cross-file schema interference and runner crashes.",
] as const;

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const CI_WORKFLOW_PATH = path.resolve(REPO_ROOT, ".github/workflows/ci.yml");

export const M058_S01_CHECK_IDS = [
  "M058-S01-CI-COVERAGE-BREADTH",
  "M058-S01-CI-SPLIT-PRESERVED",
  "M058-S01-PACKAGE-WIRING",
  "M058-S01-CI-ORDERING-RATIONALE",
] as const;

export type M058S01CheckId = (typeof M058_S01_CHECK_IDS)[number];

export type Check = {
  id: M058S01CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M058S01CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  readTextFile?: (filePath: string) => Promise<string>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

export async function evaluateM058S01Proof(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  const packageContent = await readOptionalTextFile(readTextFile, PACKAGE_JSON_PATH);
  const ciContent = await readOptionalTextFile(readTextFile, CI_WORKFLOW_PATH);

  const checks: Check[] = [
    ciContent.ok
      ? buildCiCoverageBreadthCheck(ciContent.content)
      : failCheck("M058-S01-CI-COVERAGE-BREADTH", "ci_file_unreadable", ciContent.error),
    ciContent.ok
      ? buildCiSplitPreservedCheck(ciContent.content)
      : failCheck("M058-S01-CI-SPLIT-PRESERVED", "ci_file_unreadable", ciContent.error),
    packageContent.ok
      ? buildPackageWiringCheck(packageContent.content)
      : failCheck("M058-S01-PACKAGE-WIRING", "package_file_unreadable", packageContent.error),
    ciContent.ok
      ? buildCiOrderingAndRationaleCheck(ciContent.content)
      : failCheck("M058-S01-CI-ORDERING-RATIONALE", "ci_file_unreadable", ciContent.error),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M058_S01_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM058S01Report(report: EvaluationReport): string {
  const lines = [
    "M058 S01 CI coverage verifier",
    `Generated at: ${report.generatedAt}`,
    `CI coverage proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM058S01ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM058S01Proof(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM058S01Report(report));
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

export function parseM058S01Args(args: readonly string[]): { json: boolean } {
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

function buildCiCoverageBreadthCheck(ciContent: string): Check {
  if (!hasExactRunStep(ciContent, EXPECTED_BROAD_TEST_STEP)) {
    return failCheck(
      "M058-S01-CI-COVERAGE-BREADTH",
      "ci_coverage_step_missing",
      `.github/workflows/ci.yml must include ${EXPECTED_BROAD_TEST_STEP} so the full src tree, including src/webhook, is exercised.`,
    );
  }

  return passCheck(
    "M058-S01-CI-COVERAGE-BREADTH",
    "ci_coverage_breadth_ok",
    `.github/workflows/ci.yml includes ${EXPECTED_BROAD_TEST_STEP}.`,
  );
}

function buildCiSplitPreservedCheck(ciContent: string): Check {
  if (!hasExactRunStep(ciContent, EXPECTED_KNOWLEDGE_TEST_STEP)) {
    return failCheck(
      "M058-S01-CI-SPLIT-PRESERVED",
      "ci_split_step_missing",
      `.github/workflows/ci.yml must retain ${EXPECTED_KNOWLEDGE_TEST_STEP} as the isolated second Bun test step.`,
    );
  }

  return passCheck(
    "M058-S01-CI-SPLIT-PRESERVED",
    "ci_split_preserved_ok",
    `.github/workflows/ci.yml retains ${EXPECTED_KNOWLEDGE_TEST_STEP} as the isolated second Bun test step.`,
  );
}

function buildPackageWiringCheck(packageJsonContent: string): Check {
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck("M058-S01-PACKAGE-WIRING", "package_json_invalid", error);
  }

  const actualScript = packageJson.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M058-S01-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M058-S01-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M058-S01-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function buildCiOrderingAndRationaleCheck(ciContent: string): Check {
  const verifyStepIndex = indexOfRunStep(ciContent, EXPECTED_VERIFY_STEP);
  if (verifyStepIndex === -1) {
    return failCheck(
      "M058-S01-CI-ORDERING-RATIONALE",
      "ci_verify_step_missing",
      `.github/workflows/ci.yml must run ${EXPECTED_VERIFY_STEP} before the broadened Bun test steps.`,
    );
  }

  const broadStepIndex = indexOfRunStep(ciContent, EXPECTED_BROAD_TEST_STEP);
  const knowledgeStepIndex = indexOfRunStep(ciContent, EXPECTED_KNOWLEDGE_TEST_STEP);

  if (broadStepIndex !== -1 && verifyStepIndex > broadStepIndex) {
    return failCheck(
      "M058-S01-CI-ORDERING-RATIONALE",
      "ci_verify_step_misordered",
      `${EXPECTED_VERIFY_STEP} must appear before ${EXPECTED_BROAD_TEST_STEP} in .github/workflows/ci.yml.`,
    );
  }

  if (knowledgeStepIndex !== -1 && verifyStepIndex > knowledgeStepIndex) {
    return failCheck(
      "M058-S01-CI-ORDERING-RATIONALE",
      "ci_verify_step_misordered",
      `${EXPECTED_VERIFY_STEP} must appear before ${EXPECTED_KNOWLEDGE_TEST_STEP} in .github/workflows/ci.yml.`,
    );
  }

  const missingRationaleMarkers = REQUIRED_SPLIT_RATIONALE_MARKERS.filter(
    (marker) => !ciContent.includes(marker),
  );
  if (missingRationaleMarkers.length > 0) {
    return failCheck(
      "M058-S01-CI-ORDERING-RATIONALE",
      "ci_split_rationale_comment_missing",
      `.github/workflows/ci.yml must preserve the split rationale comment markers: ${missingRationaleMarkers.join(", ")}`,
    );
  }

  return passCheck(
    "M058-S01-CI-ORDERING-RATIONALE",
    "ci_ordering_rationale_ok",
    `.github/workflows/ci.yml keeps ${EXPECTED_VERIFY_STEP} ahead of the split Bun test steps and preserves the split rationale comment.`,
  );
}

function hasExactRunStep(ciContent: string, command: string): boolean {
  return runStepMatch(ciContent, command) != null;
}

function indexOfRunStep(ciContent: string, command: string): number {
  return runStepMatch(ciContent, command)?.index ?? -1;
}

function runStepMatch(ciContent: string, command: string): RegExpMatchArray | null {
  return ciContent.match(new RegExp(`^\\s*- run: ${escapeForRegex(command)}\\s*$`, "m"));
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function passCheck(id: M058S01CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M058S01CheckId, status_code: string, detail?: unknown): Check {
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

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

if (import.meta.main) {
  try {
    const args = parseM058S01Args(process.argv.slice(2));
    const { exitCode } = await buildM058S01ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
