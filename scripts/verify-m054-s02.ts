import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m054:s02" as const;
const PACKAGE_JSON_PATH = path.resolve(import.meta.dir, "../package.json");
const HISTORICAL_MILESTONES = [
  "M035",
  "M036",
  "M037",
  "M038",
  "M039",
  "M040",
  "M041",
  "M042",
] as const;
const BROADER_MILESTONE = "M043" as const;
const CANONICAL_SCRIPT_COMMAND = "bun scripts/verify-m054-s02.ts" as const;

const EXPECTED_HISTORICAL_FILES = [
  "CONTEXT-DRAFT.md",
  "CONTEXT.md",
  "SUMMARY.md",
] as const;
const EXPECTED_M043_FILES = [
  "CONTEXT.md",
  "ROADMAP.md",
  "SUMMARY.md",
  "VALIDATION.md",
] as const;

export const M054_S02_CHECK_IDS = [
  "M054-S02-HISTORICAL-INVENTORY-M035-M042",
  "M054-S02-HISTORICAL-INVENTORY-M043",
  "M054-S02-PACKAGE-SCRIPT-WIRING",
] as const;

export type M054S02CheckId = (typeof M054_S02_CHECK_IDS)[number];

export type Check = {
  id: M054S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M054S02CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  readTextFile?: (filePath: string) => Promise<string>;
  listTopLevelFiles?: (dirPath: string) => Promise<string[]>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

export async function evaluateM054S02HistoricalFolders(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const listTopLevelFiles = options.listTopLevelFiles ?? defaultListTopLevelFiles;

  const historicalCheck = await buildHistoricalInventoryCheck({
    milestoneIds: HISTORICAL_MILESTONES,
    checkId: "M054-S02-HISTORICAL-INVENTORY-M035-M042",
    expectedSuffixes: EXPECTED_HISTORICAL_FILES,
    readTextFile,
    listTopLevelFiles,
  });
  const m043Check = await buildHistoricalInventoryCheck({
    milestoneIds: [BROADER_MILESTONE],
    checkId: "M054-S02-HISTORICAL-INVENTORY-M043",
    expectedSuffixes: EXPECTED_M043_FILES,
    readTextFile,
    listTopLevelFiles,
  });
  const packageScriptCheck = await buildPackageScriptCheck(readTextFile);

  const checks = [historicalCheck, m043Check, packageScriptCheck];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M054_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM054S02Report(report: EvaluationReport): string {
  const lines = [
    "M054 S02 historical folder verifier",
    `Generated at: ${report.generatedAt}`,
    `Historical folder proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM054S02ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM054S02HistoricalFolders(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM054S02Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m054:s02 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM054S02Args(args: readonly string[]): { json: boolean } {
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

type InventoryCheckOptions = {
  milestoneIds: readonly string[];
  checkId: M054S02CheckId;
  expectedSuffixes: readonly string[];
  readTextFile: (filePath: string) => Promise<string>;
  listTopLevelFiles: (dirPath: string) => Promise<string[]>;
};

async function buildHistoricalInventoryCheck(
  options: InventoryCheckOptions,
): Promise<Check> {
  const driftMessages: string[] = [];
  const unreadableMessages: string[] = [];

  for (const milestoneId of options.milestoneIds) {
    const milestoneDir = path.resolve(import.meta.dir, `../.gsd/milestones/${milestoneId}`);

    let actualFiles: string[];
    try {
      actualFiles = (await options.listTopLevelFiles(milestoneDir)).sort((left, right) =>
        left.localeCompare(right),
      );
    } catch (error) {
      unreadableMessages.push(`${milestoneId}: ${normalizeDetail(error)}`);
      continue;
    }

    const expectedFiles = options.expectedSuffixes
      .map((suffix) => `${milestoneId}-${suffix}`)
      .sort((left, right) => left.localeCompare(right));
    const missing = expectedFiles.filter((fileName) => !actualFiles.includes(fileName));
    const unexpected = actualFiles.filter((fileName) => !expectedFiles.includes(fileName));

    if (missing.length > 0 || unexpected.length > 0) {
      driftMessages.push(
        [
          `${milestoneId}`,
          missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
          unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("; "),
      );
    }

    for (const fileName of expectedFiles) {
      const filePath = path.join(milestoneDir, fileName);
      try {
        const content = await options.readTextFile(filePath);
        if (content.trim().length === 0) {
          driftMessages.push(`${milestoneId}; empty: ${fileName}`);
        }
      } catch (error) {
        driftMessages.push(`${milestoneId}; unreadable: ${fileName}; ${normalizeDetail(error)}`);
      }
    }
  }

  if (unreadableMessages.length > 0) {
    return failCheck(
      options.checkId,
      "historical_inventory_unreadable",
      unreadableMessages.join(" | "),
    );
  }

  if (driftMessages.length > 0) {
    return failCheck(
      options.checkId,
      "historical_inventory_drift",
      driftMessages.join(" | "),
    );
  }

  return passCheck(
    options.checkId,
    "historical_inventory_ok",
    `Verified ${options.milestoneIds.join(", ")} top-level inventory.`,
  );
}

async function buildPackageScriptCheck(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  let packageJsonText: string;
  try {
    packageJsonText = await readTextFile(PACKAGE_JSON_PATH);
  } catch (error) {
    return failCheck(
      "M054-S02-PACKAGE-SCRIPT-WIRING",
      "package_json_unreadable",
      error,
    );
  }

  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck(
      "M054-S02-PACKAGE-SCRIPT-WIRING",
      "package_json_malformed",
      error,
    );
  }

  const actualCommand = packageJson.scripts?.[COMMAND_NAME];
  if (actualCommand == null) {
    return failCheck(
      "M054-S02-PACKAGE-SCRIPT-WIRING",
      "package_script_wiring_missing",
      `package.json is missing scripts.${COMMAND_NAME}`,
    );
  }

  if (actualCommand !== CANONICAL_SCRIPT_COMMAND) {
    return failCheck(
      "M054-S02-PACKAGE-SCRIPT-WIRING",
      "package_script_wiring_mismatch",
      `Expected ${CANONICAL_SCRIPT_COMMAND} but found ${actualCommand}`,
    );
  }

  return passCheck(
    "M054-S02-PACKAGE-SCRIPT-WIRING",
    "package_script_wiring_ok",
    `package.json scripts.${COMMAND_NAME} matches the canonical command.`,
  );
}

function passCheck(id: M054S02CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M054S02CheckId, status_code: string, detail?: unknown): Check {
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

async function defaultListTopLevelFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

if (import.meta.main) {
  try {
    const args = parseM054S02Args(process.argv.slice(2));
    const { exitCode } = await buildM054S02ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m054:s02 failed: ${message}\n`);
    process.exit(1);
  }
}
