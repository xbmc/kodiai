import { readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m055:s01" as const;
const README_PATH = path.resolve(import.meta.dir, "../README.md");
const CHANGELOG_PATH = path.resolve(import.meta.dir, "../CHANGELOG.md");
const PACKAGE_JSON_PATH = path.resolve(import.meta.dir, "../package.json");
const EXPECTED_SHIPPED_COUNT_LINE = "38 milestones shipped (v0.1 through v0.38).";
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m055-s01.ts";
const REQUIRED_RECENT_FEATURE_MARKERS = [
  "M074",
  "validation truth",
  "xbmc/xbmc#28172",
  "M073",
  "review-budget",
  "M066",
  "same-PR formatter suggestions",
  "M051",
  "@kodiai review",
  "M052",
  "Slack webhook relay",
  "M053",
  "new Function()",
  "verify:m053",
  "M054",
  "verify:m054:s01",
  "verify:m054:s04",
] as const;
const REQUIRED_NIGHTLY_WORKFLOW_MARKERS = [
  "nightly-issue-sync",
  "bun scripts/backfill-issues.ts --sync",
  "nightly-reaction-sync",
  "bun scripts/sync-triage-reactions.ts",
  "workflow_dispatch",
  "GitHub Actions workflow run status",
] as const;
const REQUIRED_CHANGELOG_RELEASE_MARKERS = ["## v0.38", "## v0.37", "## v0.36", "## v0.31", "## v0.30", "## v0.29"] as const;

export const M055_S01_CHECK_IDS = [
  "M055-S01-README-SHIPPED-COUNT",
  "M055-S01-README-RECENT-FEATURES",
  "M055-S01-README-NIGHTLY-WORKFLOWS",
  "M055-S01-CHANGELOG-RECENT-RELEASES",
  "M055-S01-PACKAGE-WIRING",
] as const;

export type M055S01CheckId = (typeof M055_S01_CHECK_IDS)[number];

export type Check = {
  id: M055S01CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M055S01CheckId[];
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

export async function evaluateM055S01DocsTruth(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  let readmeContent: string | null = null;
  let readmeReadError: unknown = null;
  try {
    readmeContent = await readTextFile(README_PATH);
  } catch (error) {
    readmeReadError = error;
  }

  let changelogContent: string | null = null;
  let changelogReadError: unknown = null;
  try {
    changelogContent = await readTextFile(CHANGELOG_PATH);
  } catch (error) {
    changelogReadError = error;
  }

  let packageJsonContent: string | null = null;
  let packageJsonReadError: unknown = null;
  try {
    packageJsonContent = await readTextFile(PACKAGE_JSON_PATH);
  } catch (error) {
    packageJsonReadError = error;
  }

  const checks: Check[] = [
    readmeContent == null
      ? failCheck(
          "M055-S01-README-SHIPPED-COUNT",
          "readme_file_unreadable",
          readmeReadError,
        )
      : buildReadmeShippedCountCheck(readmeContent),
    readmeContent == null
      ? failCheck(
          "M055-S01-README-RECENT-FEATURES",
          "readme_file_unreadable",
          readmeReadError,
        )
      : buildReadmeRecentFeaturesCheck(readmeContent),
    readmeContent == null
      ? failCheck(
          "M055-S01-README-NIGHTLY-WORKFLOWS",
          "readme_file_unreadable",
          readmeReadError,
        )
      : buildReadmeNightlyWorkflowCheck(readmeContent),
    changelogContent == null
      ? failCheck(
          "M055-S01-CHANGELOG-RECENT-RELEASES",
          "changelog_file_unreadable",
          changelogReadError,
        )
      : buildChangelogRecentReleasesCheck(changelogContent),
    packageJsonContent == null
      ? failCheck(
          "M055-S01-PACKAGE-WIRING",
          "package_file_unreadable",
          packageJsonReadError,
        )
      : buildPackageWiringCheck(packageJsonContent),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M055_S01_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM055S01Report(report: EvaluationReport): string {
  const lines = [
    "M055 S01 docs truth verifier",
    `Generated at: ${report.generatedAt}`,
    `Docs truth proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM055S01ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM055S01DocsTruth(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM055S01Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m055:s01 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM055S01Args(args: readonly string[]): { json: boolean } {
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

function buildReadmeShippedCountCheck(readmeContent: string): Check {
  const actualLine = readmeContent.match(/\b\d+ milestones shipped \(v0\.1 through v0\.\d+\)\./)?.[0];

  if (actualLine == null) {
    return failCheck(
      "M055-S01-README-SHIPPED-COUNT",
      "readme_shipped_count_missing",
      `README.md must include the shipped-count line: ${EXPECTED_SHIPPED_COUNT_LINE}`,
    );
  }

  if (actualLine !== EXPECTED_SHIPPED_COUNT_LINE) {
    return failCheck(
      "M055-S01-README-SHIPPED-COUNT",
      "readme_shipped_count_stale",
      `Expected '${EXPECTED_SHIPPED_COUNT_LINE}' but found '${actualLine}'.`,
    );
  }

  return passCheck(
    "M055-S01-README-SHIPPED-COUNT",
    "readme_shipped_count_ok",
    EXPECTED_SHIPPED_COUNT_LINE,
  );
}

function buildReadmeRecentFeaturesCheck(readmeContent: string): Check {
  const missingMarkers = REQUIRED_RECENT_FEATURE_MARKERS.filter(
    (marker) => !readmeContent.includes(marker),
  );

  if (missingMarkers.length > 0) {
    return failCheck(
      "M055-S01-README-RECENT-FEATURES",
      "readme_recent_features_missing",
      `README.md is missing recent shipped feature markers: ${missingMarkers.join(", ")}`,
    );
  }

  return passCheck(
    "M055-S01-README-RECENT-FEATURES",
    "readme_recent_features_ok",
    `README.md covers recent milestones M073-M074 and retains M051-M054/M066 shipped feature markers.`,
  );
}

function buildReadmeNightlyWorkflowCheck(readmeContent: string): Check {
  const missingMarkers = REQUIRED_NIGHTLY_WORKFLOW_MARKERS.filter(
    (marker) => !readmeContent.includes(marker),
  );

  if (missingMarkers.length > 0) {
    return failCheck(
      "M055-S01-README-NIGHTLY-WORKFLOWS",
      "readme_nightly_workflows_missing",
      `README.md is missing nightly workflow markers: ${missingMarkers.join(", ")}`,
    );
  }

  return passCheck(
    "M055-S01-README-NIGHTLY-WORKFLOWS",
    "readme_nightly_workflows_ok",
    "README.md documents both nightly workflows, their commands, workflow_dispatch support, and Actions status visibility.",
  );
}

function buildChangelogRecentReleasesCheck(changelogContent: string): Check {
  const missingMarkers = REQUIRED_CHANGELOG_RELEASE_MARKERS.filter(
    (marker) => !changelogContent.includes(marker),
  );

  if (missingMarkers.length > 0) {
    return failCheck(
      "M055-S01-CHANGELOG-RECENT-RELEASES",
      "changelog_recent_releases_missing",
      `CHANGELOG.md must retain post-v0.29 release entries: ${missingMarkers.join(", ")}`,
    );
  }

  return passCheck(
    "M055-S01-CHANGELOG-RECENT-RELEASES",
    "changelog_recent_releases_ok",
    "CHANGELOG.md includes v0.29 through v0.31 and current v0.36 through v0.38 release entries.",
  );
}

function buildPackageWiringCheck(packageJsonContent: string): Check {
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck(
      "M055-S01-PACKAGE-WIRING",
      "package_json_invalid",
      error,
    );
  }

  const actualScript = packageJson.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M055-S01-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M055-S01-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M055-S01-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function passCheck(id: M055S01CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M055S01CheckId, status_code: string, detail?: unknown): Check {
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

if (import.meta.main) {
  try {
    const args = parseM055S01Args(process.argv.slice(2));
    const { exitCode } = await buildM055S01ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m055:s01 failed: ${message}\n`);
    process.exit(1);
  }
}
