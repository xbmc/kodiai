import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m053" as const;
const SRC_ROOT = path.resolve(import.meta.dir, "../src");
const REMOVED_HELPER_PATH = "src/phase28-inline-minconfidence-live-check.ts" as const;
const DECISIONS_PATH = path.resolve(import.meta.dir, "../.gsd/DECISIONS.md");
const DECISION_MARKER = "M053/S01/T02" as const;
const DECISION_TEXT_MARKER = "M053 src-tree no-dynamic-evaluator invariant" as const;

export const M053_CHECK_IDS = [
  "M053-HELPER-REMOVED",
  "M053-SRC-NEW-FUNCTION-CLEAN",
  "M053-DECISION-RECORDED",
] as const;

export type M053CheckId = (typeof M053_CHECK_IDS)[number];

export type Check = {
  id: M053CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M053CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  readTextFile?: (filePath: string) => Promise<string>;
  pathExists?: (filePath: string) => Promise<boolean>;
  walkFiles?: (dirPath: string) => Promise<string[]>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

export async function evaluateM053(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const pathExists = options.pathExists ?? defaultPathExists;
  const walkFiles = options.walkFiles ?? walkDirectoryFiles;

  const helperCheck = await buildHelperRemovedCheck(pathExists);
  const srcTreeCheck = await buildSrcTreeCheck({ walkFiles, readTextFile });
  const decisionCheck = await buildDecisionRecordedCheck(readTextFile);

  const checks = [helperCheck, srcTreeCheck, decisionCheck];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M053_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM053Report(report: EvaluationReport): string {
  const lines = [
    "M053 invariant proof harness: no src-side dynamic evaluators",
    `Generated at: ${report.generatedAt}`,
    `Proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM053ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM053(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM053Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m053 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM053Args(args: readonly string[]): { json: boolean } {
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

async function buildHelperRemovedCheck(
  pathExists: (filePath: string) => Promise<boolean>,
): Promise<Check> {
  const helperExists = await pathExists(path.resolve(import.meta.dir, `../${REMOVED_HELPER_PATH}`));

  return helperExists
    ? failCheck(
        "M053-HELPER-REMOVED",
        "removed_helper_present",
        `${REMOVED_HELPER_PATH} still exists.`,
      )
    : passCheck(
        "M053-HELPER-REMOVED",
        "removed_helper_absent",
        `${REMOVED_HELPER_PATH} is absent.`,
      );
}

async function buildSrcTreeCheck(params: {
  walkFiles: (dirPath: string) => Promise<string[]>;
  readTextFile: (filePath: string) => Promise<string>;
}): Promise<Check> {
  try {
    const files = await params.walkFiles(SRC_ROOT);
    const offenders: string[] = [];

    for (const filePath of files) {
      const content = await params.readTextFile(filePath);
      if (content.includes("new Function(")) {
        offenders.push(path.relative(path.resolve(import.meta.dir, ".."), filePath));
      }
    }

    return offenders.length === 0
      ? passCheck(
          "M053-SRC-NEW-FUNCTION-CLEAN",
          "src_tree_no_new_function",
          `scanned ${files.length} src files`,
        )
      : failCheck(
          "M053-SRC-NEW-FUNCTION-CLEAN",
          "src_tree_contains_new_function",
          `new Function() found in: ${offenders.join(", ")}`,
        );
  } catch (error) {
    return failCheck(
      "M053-SRC-NEW-FUNCTION-CLEAN",
      "src_tree_scan_failed",
      normalizeDetail(error),
    );
  }
}

async function buildDecisionRecordedCheck(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  try {
    const content = await readTextFile(DECISIONS_PATH);
    const hasDecision =
      content.includes(DECISION_MARKER) && content.includes(DECISION_TEXT_MARKER);

    return hasDecision
      ? passCheck(
          "M053-DECISION-RECORDED",
          "decision_record_present",
          `Found ${DECISION_MARKER} decision marker in .gsd/DECISIONS.md.`,
        )
      : failCheck(
          "M053-DECISION-RECORDED",
          "decision_record_missing",
          `Missing ${DECISION_MARKER} / ${DECISION_TEXT_MARKER} entry in .gsd/DECISIONS.md.`,
        );
  } catch (error) {
    return failCheck(
      "M053-DECISION-RECORDED",
      "decision_record_unreadable",
      normalizeDetail(error),
    );
  }
}

function passCheck(id: M053CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M053CheckId, status_code: string, detail?: unknown): Check {
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

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

async function defaultPathExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkDirectoryFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectoryFiles(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

if (import.meta.main) {
  try {
    const args = parseM053Args(process.argv.slice(2));
    const { exitCode } = await buildM053ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m053 failed: ${message}\n`);
    process.exit(1);
  }
}
