import { readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m058:s03" as const;
const EXPECTED_VERIFY_SCRIPT = "bun scripts/verify-m058-s03.ts";
const EXPECTED_LINT_SCRIPT = "eslint src scripts";
const EXPECTED_LINT_STEP = "bun run lint";
const EXPECTED_MIGRATION_VERIFY_STEP = "bun run verify:m056:s03";
const EXPECTED_ORPHANED_TEST_STEP = "bun run check:orphaned-tests";
const EXPECTED_BROAD_TEST_STEP = "bun test --max-concurrency=2 scripts src";
const EXPECTED_KNOWLEDGE_TEST_STEP = "bun test --max-concurrency=2 src/knowledge";
const REQUIRED_SPLIT_RATIONALE_MARKERS = [
  "Bun has been unstable on GitHub runners with one monolithic test process.",
  "Keep DB-backed tests on a low concurrency cap and split the suite into",
  "two shorter invocations to avoid cross-file schema interference and runner crashes.",
] as const;
const DECISION_MARKER = "M058-S03-LINT-TOOL-CONTRACT";
const DECISION_REQUIRED_TEXT =
  "Adopt ESLint as the repo-owned linter for src/ and scripts/, with an explicit carve-out for operator-facing migration CLI console output.";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const CI_WORKFLOW_PATH = path.resolve(REPO_ROOT, ".github/workflows/ci.yml");
const DECISIONS_PATH = path.resolve(REPO_ROOT, ".gsd/DECISIONS.md");

export const M058_S03_CHECK_IDS = [
  "M058-S03-PACKAGE-WIRING",
  "M058-S03-CI-WIRING",
  "M058-S03-CI-RATIONALE",
  "M058-S03-DECISION-RECORD",
] as const;

export type M058S03CheckId = (typeof M058_S03_CHECK_IDS)[number];

export type Check = {
  id: M058S03CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M058S03CheckId[];
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

type PackageJsonShape = {
  scripts?: Record<string, string> | unknown;
};

export async function evaluateM058S03Proof(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  const packageContent = await readOptionalTextFile(readTextFile, PACKAGE_JSON_PATH);
  const ciContent = await readOptionalTextFile(readTextFile, CI_WORKFLOW_PATH);
  const decisionsContent = await readOptionalTextFile(readTextFile, DECISIONS_PATH);

  const parsedPackageJson = packageContent.ok
    ? parsePackageJson(packageContent.content)
    : { ok: false as const, error: packageContent.error };

  const checks: Check[] = [
    packageContent.ok
      ? buildPackageWiringCheck(parsedPackageJson)
      : failCheck("M058-S03-PACKAGE-WIRING", "package_file_unreadable", packageContent.error),
    ciContent.ok
      ? buildCiWiringCheck(ciContent.content)
      : failCheck("M058-S03-CI-WIRING", "ci_file_unreadable", ciContent.error),
    ciContent.ok
      ? buildCiRationaleCheck(ciContent.content)
      : failCheck("M058-S03-CI-RATIONALE", "ci_file_unreadable", ciContent.error),
    decisionsContent.ok
      ? buildDecisionRecordCheck(decisionsContent.content)
      : failCheck(
          "M058-S03-DECISION-RECORD",
          "decision_file_unreadable",
          decisionsContent.error,
        ),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M058_S03_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM058S03Report(report: EvaluationReport): string {
  const lines = [
    "M058 S03 CI gate contract verifier",
    `Generated at: ${report.generatedAt}`,
    `CI gate proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM058S03ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM058S03Proof(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM058S03Report(report));
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

export function parseM058S03Args(args: readonly string[]): { json: boolean } {
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

function buildPackageWiringCheck(parsedPackageJson: ReturnType<typeof parsePackageJson>): Check {
  if (!parsedPackageJson.ok) {
    return failCheck("M058-S03-PACKAGE-WIRING", "package_json_invalid", parsedPackageJson.error);
  }

  const scripts = parsedPackageJson.value.scripts;
  if (typeof scripts !== "object" || scripts == null || Array.isArray(scripts)) {
    return failCheck(
      "M058-S03-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.lint=${EXPECTED_LINT_SCRIPT} and scripts.${COMMAND_NAME}=${EXPECTED_VERIFY_SCRIPT}`,
    );
  }

  const scriptMap = scripts as Record<string, unknown>;
  const lintScript = scriptMap.lint;
  const verifyScript = scriptMap[COMMAND_NAME];

  if (lintScript == null || verifyScript == null) {
    return failCheck(
      "M058-S03-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.lint=${EXPECTED_LINT_SCRIPT} and scripts.${COMMAND_NAME}=${EXPECTED_VERIFY_SCRIPT}`,
    );
  }

  if (lintScript !== EXPECTED_LINT_SCRIPT) {
    return failCheck(
      "M058-S03-PACKAGE-WIRING",
      "lint_script_incorrect",
      `Expected scripts.lint=${EXPECTED_LINT_SCRIPT} but found ${lintScript}`,
    );
  }

  if (verifyScript !== EXPECTED_VERIFY_SCRIPT) {
    return failCheck(
      "M058-S03-PACKAGE-WIRING",
      "verify_script_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_VERIFY_SCRIPT} but found ${verifyScript}`,
    );
  }

  return passCheck(
    "M058-S03-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires lint to ${EXPECTED_LINT_SCRIPT} and ${COMMAND_NAME} to ${EXPECTED_VERIFY_SCRIPT}`,
  );
}

function buildCiWiringCheck(ciContent: string): Check {
  const lintStepIndex = indexOfRunStep(ciContent, EXPECTED_LINT_STEP);
  if (lintStepIndex === -1) {
    return failCheck(
      "M058-S03-CI-WIRING",
      "ci_lint_step_missing",
      `.github/workflows/ci.yml must include ${EXPECTED_LINT_STEP} before the heavier Bun test steps.`,
    );
  }

  const migrationVerifyIndex = indexOfRunStep(ciContent, EXPECTED_MIGRATION_VERIFY_STEP);
  if (migrationVerifyIndex === -1) {
    return failCheck(
      "M058-S03-CI-WIRING",
      "ci_migration_verify_step_missing",
      `.github/workflows/ci.yml must include ${EXPECTED_MIGRATION_VERIFY_STEP} in the structural gate bundle.`,
    );
  }

  const orphanedTestIndex = indexOfRunStep(ciContent, EXPECTED_ORPHANED_TEST_STEP);
  if (orphanedTestIndex === -1) {
    return failCheck(
      "M058-S03-CI-WIRING",
      "ci_orphaned_test_step_missing",
      `.github/workflows/ci.yml must include ${EXPECTED_ORPHANED_TEST_STEP} before the heavier Bun test steps.`,
    );
  }

  if (lintStepIndex > migrationVerifyIndex) {
    return failCheck(
      "M058-S03-CI-WIRING",
      "ci_gate_steps_misordered",
      `${EXPECTED_LINT_STEP} must appear before ${EXPECTED_MIGRATION_VERIFY_STEP} in .github/workflows/ci.yml.`,
    );
  }

  if (migrationVerifyIndex > orphanedTestIndex) {
    return failCheck(
      "M058-S03-CI-WIRING",
      "ci_gate_steps_misordered",
      `${EXPECTED_MIGRATION_VERIFY_STEP} must appear before ${EXPECTED_ORPHANED_TEST_STEP} in .github/workflows/ci.yml.`,
    );
  }

  for (const marker of [EXPECTED_BROAD_TEST_STEP, EXPECTED_KNOWLEDGE_TEST_STEP] as const) {
    const markerIndex = indexOfRunStep(ciContent, marker);
    if (markerIndex !== -1 && orphanedTestIndex > markerIndex) {
      return failCheck(
        "M058-S03-CI-WIRING",
        "ci_gate_steps_misordered",
        `${EXPECTED_ORPHANED_TEST_STEP} must appear before ${marker} in .github/workflows/ci.yml.`,
      );
    }
  }

  return passCheck(
    "M058-S03-CI-WIRING",
    "ci_wiring_ok",
    `.github/workflows/ci.yml runs ${EXPECTED_LINT_STEP}, ${EXPECTED_MIGRATION_VERIFY_STEP}, and ${EXPECTED_ORPHANED_TEST_STEP} before the heavier Bun test steps.`,
  );
}

function buildCiRationaleCheck(ciContent: string): Check {
  const missingRationaleMarkers = REQUIRED_SPLIT_RATIONALE_MARKERS.filter(
    (marker) => !ciContent.includes(marker),
  );
  if (missingRationaleMarkers.length > 0) {
    return failCheck(
      "M058-S03-CI-RATIONALE",
      "ci_split_rationale_comment_missing",
      `.github/workflows/ci.yml must preserve the split rationale comment markers: ${missingRationaleMarkers.join(", ")}`,
    );
  }

  if (!hasExactRunStep(ciContent, EXPECTED_BROAD_TEST_STEP)) {
    return failCheck(
      "M058-S03-CI-RATIONALE",
      "ci_broad_test_step_missing",
      `.github/workflows/ci.yml must retain ${EXPECTED_BROAD_TEST_STEP} as the broadened test step.`,
    );
  }

  if (!hasExactRunStep(ciContent, EXPECTED_KNOWLEDGE_TEST_STEP)) {
    return failCheck(
      "M058-S03-CI-RATIONALE",
      "ci_knowledge_test_step_missing",
      `.github/workflows/ci.yml must retain ${EXPECTED_KNOWLEDGE_TEST_STEP} as the isolated knowledge test step.`,
    );
  }

  return passCheck(
    "M058-S03-CI-RATIONALE",
    "ci_rationale_ok",
    `.github/workflows/ci.yml preserves the split Bun-test rationale comment plus both split test steps.`,
  );
}

function buildDecisionRecordCheck(decisionsContent: string): Check {
  if (!decisionsContent.includes(DECISION_MARKER)) {
    return failCheck(
      "M058-S03-DECISION-RECORD",
      "decision_marker_missing",
      `.gsd/DECISIONS.md must include the ${DECISION_MARKER} marker alongside the lint-tool rationale.`,
    );
  }

  if (!decisionsContent.includes(DECISION_REQUIRED_TEXT)) {
    return failCheck(
      "M058-S03-DECISION-RECORD",
      "decision_contract_text_missing",
      `.gsd/DECISIONS.md must record: ${DECISION_REQUIRED_TEXT}`,
    );
  }

  return passCheck(
    "M058-S03-DECISION-RECORD",
    "decision_record_ok",
    `.gsd/DECISIONS.md records the lint-tool contract with marker ${DECISION_MARKER}.`,
  );
}

function parsePackageJson(content: string):
  | { ok: true; value: PackageJsonShape }
  | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(content) as PackageJsonShape };
  } catch (error) {
    return { ok: false, error };
  }
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

function passCheck(id: M058S03CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M058S03CheckId, status_code: string, detail?: unknown): Check {
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
    const args = parseM058S03Args(process.argv.slice(2));
    const { exitCode } = await buildM058S03ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
