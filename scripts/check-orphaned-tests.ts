import { readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "check:orphaned-tests" as const;
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/check-orphaned-tests.ts";
const TRACKED_SCAN_PREFIXES = ["src/", "scripts/"] as const;

export const CHECK_ORPHANED_TESTS_CHECK_IDS = [
  "TRACKED-FILE-DISCOVERY",
  "TARGET-MAP-STATE",
  "ORPHANED-TESTS",
  "PACKAGE-WIRING",
] as const;

export type OrphanedTestsCheckId =
  (typeof CHECK_ORPHANED_TESTS_CHECK_IDS)[number];

export type OrphanedTestCheckerCheck = {
  id: OrphanedTestsCheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type OrphanedTestCheckerReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly OrphanedTestsCheckId[];
  overallPassed: boolean;
  checks: OrphanedTestCheckerCheck[];
};

export const EXPLICIT_TEST_TARGET_MAP = {
  "scripts/deploy.test.ts": "deploy.sh",
  "scripts/deploy-timeout-alignment.test.ts": "deploy.sh",
  "src/execution/prepare-agent-workspace.test.ts": "src/execution/executor.ts",
  "src/slack/v1-safety-contract.test.ts": "src/slack/safety-rails.ts",
} as const satisfies Record<string, string>;

const EXPLICIT_TARGET_PATHS = [...new Set(Object.values(EXPLICIT_TEST_TARGET_MAP))].sort();
const EXPLICIT_TARGET_LOOKUP_PATHS = EXPLICIT_TARGET_PATHS.filter(
  (targetPath) => !TRACKED_SCAN_PREFIXES.some((prefix) => targetPath.startsWith(prefix)),
);

const EXPLICIT_TEST_TARGET_MAP_ENTRIES = Object.entries(EXPLICIT_TEST_TARGET_MAP).sort(
  ([left], [right]) => left.localeCompare(right),
);

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  listTrackedFiles?: () => Promise<string[]>;
  readPackageJson?: () => Promise<string>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

type FileSetResult =
  | { ok: true; entries: string[] }
  | { ok: false; error: unknown };

export async function evaluateOrphanedTests(
  options: EvaluateOptions = {},
): Promise<OrphanedTestCheckerReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const listTrackedFiles = options.listTrackedFiles ?? defaultListTrackedFiles;
  const readPackageJson = options.readPackageJson ?? defaultReadPackageJson;

  const trackedFileState = await readTrackedFileState(listTrackedFiles);
  const trackedFiles = trackedFileState.ok ? [...trackedFileState.entries].sort() : [];
  const trackedFileSet = new Set(trackedFiles);
  const trackedTestFiles = trackedFiles.filter(isTrackedTestPath).sort();

  const discoveryCheck = buildTrackedFileDiscoveryCheck(trackedFileState, trackedFiles, trackedTestFiles);
  const targetMapCheck = buildTargetMapCheck(trackedFileSet);
  const orphanCheck = buildOrphanedTestsCheck({
    trackedFileState,
    trackedFileSet,
    trackedTestFiles,
    targetMapUsable: targetMapCheck.passed,
  });
  const packageCheck = await buildPackageCheck(readPackageJson);

  const checks = [discoveryCheck, targetMapCheck, orphanCheck, packageCheck];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: CHECK_ORPHANED_TESTS_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderCheckOrphanedTestsReport(
  report: OrphanedTestCheckerReport,
): string {
  const lines = [
    "Orphaned test ownership gate",
    `Generated at: ${report.generatedAt}`,
    `Orphaned test ownership gate: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildCheckOrphanedTestsHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: OrphanedTestCheckerReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateOrphanedTests(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderCheckOrphanedTestsReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`${COMMAND_NAME} failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1, report };
}

export function parseCheckOrphanedTestsArgs(
  args: readonly string[],
): { json: boolean } {
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

function buildTrackedFileDiscoveryCheck(
  trackedFileState: FileSetResult,
  trackedFiles: string[],
  trackedTestFiles: string[],
): OrphanedTestCheckerCheck {
  if (!trackedFileState.ok) {
    return failCheck(
      "TRACKED-FILE-DISCOVERY",
      "tracked_files_unreadable",
      normalizeDetail(trackedFileState.error),
    );
  }

  return passCheck(
    "TRACKED-FILE-DISCOVERY",
    "tracked_files_ok",
    `Scanned ${trackedFiles.length} tracked files under ${TRACKED_SCAN_PREFIXES.join(", ")} and discovered ${trackedTestFiles.length} tracked test suites.`,
  );
}

function buildTargetMapCheck(
  trackedFileSet: ReadonlySet<string>,
): OrphanedTestCheckerCheck {
  const missingMappings: string[] = [];

  for (const [testPath, targetPath] of EXPLICIT_TEST_TARGET_MAP_ENTRIES) {
    if (!trackedFileSet.has(testPath) || !trackedFileSet.has(targetPath)) {
      missingMappings.push(`${testPath} -> ${targetPath}`);
    }
  }

  if (missingMappings.length > 0) {
    return failCheck(
      "TARGET-MAP-STATE",
      "mapped_target_missing",
      `Explicit ownership mappings must resolve tracked tests and targets: ${missingMappings.join(", ")}`,
    );
  }

  return passCheck(
    "TARGET-MAP-STATE",
    "target_map_ok",
    `Verified explicit ownership mappings: ${EXPLICIT_TEST_TARGET_MAP_ENTRIES.map(([testPath, targetPath]) => `${testPath} -> ${targetPath}`).join(", ")}`,
  );
}

function buildOrphanedTestsCheck({
  trackedFileState,
  trackedFileSet,
  trackedTestFiles,
  targetMapUsable,
}: {
  trackedFileState: FileSetResult;
  trackedFileSet: ReadonlySet<string>;
  trackedTestFiles: string[];
  targetMapUsable: boolean;
}): OrphanedTestCheckerCheck {
  if (!trackedFileState.ok) {
    return failCheck(
      "ORPHANED-TESTS",
      "test_scan_unavailable",
      `Cannot evaluate orphaned tests because tracked-file discovery failed: ${normalizeDetail(trackedFileState.error)}`,
    );
  }

  if (!targetMapUsable) {
    return failCheck(
      "ORPHANED-TESTS",
      "ownership_map_unusable",
      "Cannot evaluate orphaned tests until explicit target mappings resolve tracked tests and targets.",
    );
  }

  const resolvedPairs: string[] = [];
  const orphanedTests: string[] = [];

  for (const testPath of trackedTestFiles) {
    const targetPath = resolveOwnedTarget(testPath);
    if (!trackedFileSet.has(targetPath)) {
      orphanedTests.push(`${testPath} -> ${targetPath}`);
      continue;
    }
    resolvedPairs.push(`${testPath} -> ${targetPath}`);
  }

  if (orphanedTests.length > 0) {
    return failCheck(
      "ORPHANED-TESTS",
      "orphaned_tests_found",
      `Tracked tests without an owning target: ${orphanedTests.join(", ")}`,
    );
  }

  return passCheck(
    "ORPHANED-TESTS",
    "all_tests_resolved",
    resolvedPairs.length === 0
      ? "No tracked src/scripts test suites found."
      : `Resolved tracked test ownership: ${resolvedPairs.join(", ")}`,
  );
}

async function buildPackageCheck(
  readPackageJson: () => Promise<string>,
): Promise<OrphanedTestCheckerCheck> {
  let packageJsonContent: string;
  try {
    packageJsonContent = await readPackageJson();
  } catch (error) {
    return failCheck(
      "PACKAGE-WIRING",
      "package_file_unreadable",
      normalizeDetail(error),
    );
  }

  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck("PACKAGE-WIRING", "package_json_invalid", error);
  }

  const actualScript = packageJson.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function resolveOwnedTarget(testPath: string): string {
  const explicitTarget = EXPLICIT_TEST_TARGET_MAP[testPath as keyof typeof EXPLICIT_TEST_TARGET_MAP];
  if (explicitTarget) {
    return explicitTarget;
  }

  if (testPath.endsWith(".e2e.test.ts")) {
    return testPath.replace(/\.e2e\.test\.ts$/, ".ts");
  }

  return testPath.replace(/\.test\.ts$/, ".ts");
}

function isTrackedTestPath(filePath: string): boolean {
  return (
    TRACKED_SCAN_PREFIXES.some((prefix) => filePath.startsWith(prefix)) &&
    (filePath.endsWith(".test.ts") || filePath.endsWith(".e2e.test.ts"))
  );
}

function passCheck(
  id: OrphanedTestsCheckId,
  status_code: string,
  detail?: unknown,
): OrphanedTestCheckerCheck {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(
  id: OrphanedTestsCheckId,
  status_code: string,
  detail?: unknown,
): OrphanedTestCheckerCheck {
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

async function readTrackedFileState(
  listTrackedFiles: () => Promise<string[]>,
): Promise<FileSetResult> {
  try {
    const entries = await listTrackedFiles();
    return { ok: true, entries };
  } catch (error) {
    return { ok: false, error };
  }
}

async function defaultListTrackedFiles(): Promise<string[]> {
  const process = Bun.spawn([
    "git",
    "ls-files",
    "--",
    ...TRACKED_SCAN_PREFIXES,
    ...EXPLICIT_TARGET_LOOKUP_PATHS,
  ], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderrText.trim() || `git ls-files exited with code ${exitCode}`);
  }

  return stdoutText
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
}

async function defaultReadPackageJson(): Promise<string> {
  return readFile(PACKAGE_JSON_PATH, "utf8");
}

if (import.meta.main) {
  try {
    const args = parseCheckOrphanedTestsArgs(process.argv.slice(2));
    const { exitCode } = await buildCheckOrphanedTestsHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
