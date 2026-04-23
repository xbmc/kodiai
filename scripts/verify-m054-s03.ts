import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m054:s03" as const;
const PACKAGE_JSON_PATH = path.resolve(import.meta.dir, "../package.json");
const RECENT_TOP_LEVEL_MILESTONES = ["M048", "M049", "M050"] as const;
const RECENT_SUMMARY_MILESTONES = ["M051", "M052"] as const;
const M052_SLICE_IDS = ["S01", "S02", "S03"] as const;
const CANONICAL_SCRIPT_COMMAND = "bun scripts/verify-m054-s03.ts" as const;
const EXPECTED_RECENT_TOP_LEVEL_FILES = ["CONTEXT.md", "SUMMARY.md"] as const;

export const M054_S03_CHECK_IDS = [
  "M054-S03-RECENT-INVENTORY-M048-M050",
  "M054-S03-RECENT-SUMMARIES-M051-M052",
  "M054-S03-M052-SLICE-TASK-SUMMARIES",
  "M054-S03-PACKAGE-SCRIPT-WIRING",
] as const;

export type M054S03CheckId = (typeof M054_S03_CHECK_IDS)[number];

export type Check = {
  id: M054S03CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M054S03CheckId[];
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
  listTaskSummaryFiles?: (dirPath: string) => Promise<string[]>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

export async function evaluateM054S03RecentHistory(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const listTopLevelFiles = options.listTopLevelFiles ?? defaultListTopLevelFiles;
  const listTaskSummaryFiles = options.listTaskSummaryFiles ?? defaultListTaskSummaryFiles;

  const recentInventoryCheck = await buildRecentInventoryCheck({
    readTextFile,
    listTopLevelFiles,
  });
  const recentMilestoneSummariesCheck = await buildRecentMilestoneSummariesCheck(readTextFile);
  const m052SliceTaskSummariesCheck = await buildM052SliceTaskSummariesCheck({
    readTextFile,
    listTaskSummaryFiles,
  });
  const packageScriptCheck = await buildPackageScriptCheck(readTextFile);

  const checks = [
    recentInventoryCheck,
    recentMilestoneSummariesCheck,
    m052SliceTaskSummariesCheck,
    packageScriptCheck,
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M054_S03_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM054S03Report(report: EvaluationReport): string {
  const lines = [
    "M054 S03 recent-history verifier",
    `Generated at: ${report.generatedAt}`,
    `Recent-history proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM054S03ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM054S03RecentHistory(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM054S03Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m054:s03 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM054S03Args(args: readonly string[]): { json: boolean } {
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

type RecentInventoryCheckOptions = {
  readTextFile: (filePath: string) => Promise<string>;
  listTopLevelFiles: (dirPath: string) => Promise<string[]>;
};

async function buildRecentInventoryCheck(
  options: RecentInventoryCheckOptions,
): Promise<Check> {
  const driftMessages: string[] = [];
  const unreadableMessages: string[] = [];

  for (const milestoneId of RECENT_TOP_LEVEL_MILESTONES) {
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

    const expectedFiles = EXPECTED_RECENT_TOP_LEVEL_FILES.map(
      (suffix) => `${milestoneId}-${suffix}`,
    ).sort((left, right) => left.localeCompare(right));
    const missing = expectedFiles.filter((fileName) => !actualFiles.includes(fileName));
    const unexpected = actualFiles.filter((fileName) => !expectedFiles.includes(fileName));

    if (missing.length > 0 || unexpected.length > 0) {
      driftMessages.push(
        [
          milestoneId,
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
      "M054-S03-RECENT-INVENTORY-M048-M050",
      "recent_inventory_unreadable",
      unreadableMessages.join(" | "),
    );
  }

  if (driftMessages.length > 0) {
    return failCheck(
      "M054-S03-RECENT-INVENTORY-M048-M050",
      "recent_inventory_drift",
      driftMessages.join(" | "),
    );
  }

  return passCheck(
    "M054-S03-RECENT-INVENTORY-M048-M050",
    "recent_inventory_ok",
    `Verified strict top-level inventory for ${RECENT_TOP_LEVEL_MILESTONES.join(", ")}.`,
  );
}

async function buildRecentMilestoneSummariesCheck(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  const unreadableMessages: string[] = [];
  const driftMessages: string[] = [];

  for (const milestoneId of RECENT_SUMMARY_MILESTONES) {
    const summaryPath = path.resolve(import.meta.dir, `../.gsd/milestones/${milestoneId}/${milestoneId}-SUMMARY.md`);

    try {
      const content = await readTextFile(summaryPath);
      if (content.trim().length === 0) {
        driftMessages.push(`${milestoneId}; empty summary: ${path.basename(summaryPath)}`);
      }
    } catch (error) {
      unreadableMessages.push(`${milestoneId}: ${normalizeDetail(error)}`);
    }
  }

  if (unreadableMessages.length > 0) {
    return failCheck(
      "M054-S03-RECENT-SUMMARIES-M051-M052",
      "recent_milestone_summaries_unreadable",
      unreadableMessages.join(" | "),
    );
  }

  if (driftMessages.length > 0) {
    return failCheck(
      "M054-S03-RECENT-SUMMARIES-M051-M052",
      "recent_milestone_summaries_drift",
      driftMessages.join(" | "),
    );
  }

  return passCheck(
    "M054-S03-RECENT-SUMMARIES-M051-M052",
    "recent_milestone_summaries_ok",
    `Verified milestone summaries for ${RECENT_SUMMARY_MILESTONES.join(" and ")}.`,
  );
}

type M052SliceTaskCheckOptions = {
  readTextFile: (filePath: string) => Promise<string>;
  listTaskSummaryFiles: (dirPath: string) => Promise<string[]>;
};

async function buildM052SliceTaskSummariesCheck(
  options: M052SliceTaskCheckOptions,
): Promise<Check> {
  const driftMessages: string[] = [];

  for (const sliceId of M052_SLICE_IDS) {
    const sliceDir = path.resolve(import.meta.dir, `../.gsd/milestones/M052/slices/${sliceId}`);
    const sliceSummaryPath = path.join(sliceDir, `${sliceId}-SUMMARY.md`);

    try {
      const content = await options.readTextFile(sliceSummaryPath);
      if (content.trim().length === 0) {
        driftMessages.push(`${sliceId}; empty slice summary: ${sliceId}-SUMMARY.md`);
      }
    } catch (error) {
      driftMessages.push(`${sliceId}; unreadable slice summary: ${normalizeDetail(error)}`);
      continue;
    }

    const tasksDir = path.join(sliceDir, "tasks");
    let taskSummaryFiles: string[];
    try {
      taskSummaryFiles = (await options.listTaskSummaryFiles(tasksDir)).sort((left, right) =>
        left.localeCompare(right),
      );
    } catch (error) {
      driftMessages.push(`${sliceId}; unreadable tasks directory: ${normalizeDetail(error)}`);
      continue;
    }

    if (taskSummaryFiles.length === 0) {
      driftMessages.push(`${sliceId}; no task summary files found`);
      continue;
    }

    for (const fileName of taskSummaryFiles) {
      const taskSummaryPath = path.join(tasksDir, fileName);
      try {
        const content = await options.readTextFile(taskSummaryPath);
        if (content.trim().length === 0) {
          driftMessages.push(`${sliceId}; empty task summary: ${fileName}`);
        }
      } catch (error) {
        driftMessages.push(`${sliceId}; unreadable task summary: ${fileName}; ${normalizeDetail(error)}`);
      }
    }
  }

  if (driftMessages.length > 0) {
    return failCheck(
      "M054-S03-M052-SLICE-TASK-SUMMARIES",
      "m052_slice_task_summaries_drift",
      driftMessages.join(" | "),
    );
  }

  return passCheck(
    "M054-S03-M052-SLICE-TASK-SUMMARIES",
    "m052_slice_task_summaries_ok",
    `Verified M052 slice summaries and task summaries for ${M052_SLICE_IDS.join(", ")}.`,
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
      "M054-S03-PACKAGE-SCRIPT-WIRING",
      "package_json_unreadable",
      error,
    );
  }

  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck(
      "M054-S03-PACKAGE-SCRIPT-WIRING",
      "package_json_malformed",
      error,
    );
  }

  const actualCommand = packageJson.scripts?.[COMMAND_NAME];
  if (actualCommand == null) {
    return failCheck(
      "M054-S03-PACKAGE-SCRIPT-WIRING",
      "package_script_wiring_missing",
      `package.json is missing scripts.${COMMAND_NAME}`,
    );
  }

  if (actualCommand !== CANONICAL_SCRIPT_COMMAND) {
    return failCheck(
      "M054-S03-PACKAGE-SCRIPT-WIRING",
      "package_script_wiring_mismatch",
      `Expected ${CANONICAL_SCRIPT_COMMAND} but found ${actualCommand}`,
    );
  }

  return passCheck(
    "M054-S03-PACKAGE-SCRIPT-WIRING",
    "package_script_wiring_ok",
    `package.json scripts.${COMMAND_NAME} matches the canonical command.`,
  );
}

function passCheck(id: M054S03CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M054S03CheckId, status_code: string, detail?: unknown): Check {
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

async function defaultListTaskSummaryFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^T\d+-SUMMARY\.md$/u.test(entry.name))
    .map((entry) => entry.name);
}

if (import.meta.main) {
  try {
    const args = parseM054S03Args(process.argv.slice(2));
    const { exitCode } = await buildM054S03ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m054:s03 failed: ${message}\n`);
    process.exit(1);
  }
}
