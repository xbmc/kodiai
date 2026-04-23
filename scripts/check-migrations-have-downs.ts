import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "check:migrations-have-downs" as const;
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const MIGRATIONS_DIR = path.resolve(REPO_ROOT, "src/db/migrations");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/check-migrations-have-downs.ts";

export const CHECK_MIGRATIONS_HAVE_DOWNS_CHECK_IDS = [
  "MIGRATIONS-DIR-STATE",
  "MIGRATION-ALLOWLIST-STATE",
  "MIGRATION-PAIRS",
  "PACKAGE-WIRING",
] as const;

export type CheckMigrationsHaveDownsCheckId =
  (typeof CHECK_MIGRATIONS_HAVE_DOWNS_CHECK_IDS)[number];

export type MigrationAllowlistEntry = {
  migration: string;
  rationale: string;
};

export type CheckerCheck = {
  id: CheckMigrationsHaveDownsCheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type CheckerReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly CheckMigrationsHaveDownsCheckId[];
  overallPassed: boolean;
  checks: CheckerCheck[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  allowlistEntries?: readonly MigrationAllowlistEntry[];
  readDir?: (dirPath: string) => Promise<string[]>;
  readTextFile?: (filePath: string) => Promise<string>;
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

export const MIGRATION_PAIR_ALLOWLIST: readonly MigrationAllowlistEntry[] = [];

export async function evaluateMigrationPairing(
  options: EvaluateOptions = {},
): Promise<CheckerReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const allowlistEntries = [...(options.allowlistEntries ?? MIGRATION_PAIR_ALLOWLIST)];
  const readDirImpl = options.readDir ?? defaultReadDir;
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const readPackageJson = options.readPackageJson ?? defaultReadPackageJson;

  const dirState = await readMigrationDirState(readDirImpl);
  const migrationFiles = dirState.ok ? [...dirState.entries].sort() : [];
  const forwardMigrations = migrationFiles
    .filter((fileName) => fileName.endsWith(".sql") && !fileName.endsWith(".down.sql"))
    .sort();
  const forwardMigrationSet = new Set(forwardMigrations);

  const dirCheck = buildDirCheck(dirState, migrationFiles, forwardMigrations);
  const allowlistCheck = buildAllowlistCheck(allowlistEntries, forwardMigrationSet);
  const pairsCheck = await buildPairsCheck({
    dirState,
    migrationFiles,
    forwardMigrations,
    allowlistEntries,
    allowlistUsable: allowlistCheck.passed,
    readTextFile,
  });
  const packageCheck = await buildPackageCheck(readPackageJson);

  const checks = [dirCheck, allowlistCheck, pairsCheck, packageCheck];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: CHECK_MIGRATIONS_HAVE_DOWNS_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderCheckMigrationsHaveDownsReport(report: CheckerReport): string {
  const lines = [
    "Migration rollback sibling gate",
    `Generated at: ${report.generatedAt}`,
    `Migration rollback sibling gate: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildCheckMigrationsHaveDownsHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: CheckerReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateMigrationPairing(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderCheckMigrationsHaveDownsReport(report));
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

export function parseCheckMigrationsHaveDownsArgs(
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

function buildDirCheck(
  dirState: FileSetResult,
  migrationFiles: string[],
  forwardMigrations: string[],
): CheckerCheck {
  if (!dirState.ok) {
    return failCheck(
      "MIGRATIONS-DIR-STATE",
      "migrations_dir_unreadable",
      normalizeDetail(dirState.error),
    );
  }

  return passCheck(
    "MIGRATIONS-DIR-STATE",
    "migrations_dir_ok",
    `Scanned ${migrationFiles.length} entries and discovered ${forwardMigrations.length} forward migrations in ${normalizeRepoRelativePath(MIGRATIONS_DIR)}.`,
  );
}

function buildAllowlistCheck(
  allowlistEntries: readonly MigrationAllowlistEntry[],
  forwardMigrationSet: ReadonlySet<string>,
): CheckerCheck {
  if (allowlistEntries.length === 0) {
    return passCheck(
      "MIGRATION-ALLOWLIST-STATE",
      "allowlist_empty",
      "No migration pairing exceptions are allowlisted.",
    );
  }

  const seen = new Set<string>();
  for (const entry of allowlistEntries) {
    if (typeof entry.migration !== "string" || !entry.migration.endsWith(".sql")) {
      return failCheck(
        "MIGRATION-ALLOWLIST-STATE",
        "allowlist_entry_invalid_migration",
        `Allowlist migration entries must be forward *.sql filenames: ${JSON.stringify(entry)}`,
      );
    }

    if (entry.migration.endsWith(".down.sql")) {
      return failCheck(
        "MIGRATION-ALLOWLIST-STATE",
        "allowlist_entry_invalid_migration",
        `Allowlist cannot target rollback files: ${entry.migration}`,
      );
    }

    if (typeof entry.rationale !== "string" || entry.rationale.trim().length === 0) {
      return failCheck(
        "MIGRATION-ALLOWLIST-STATE",
        "allowlist_rationale_invalid",
        `Allowlist entry for ${entry.migration} must include a non-empty rationale.`,
      );
    }

    if (seen.has(entry.migration)) {
      return failCheck(
        "MIGRATION-ALLOWLIST-STATE",
        "allowlist_duplicate_migration",
        `Allowlist must not repeat forward migrations: ${entry.migration}`,
      );
    }
    seen.add(entry.migration);

    if (!forwardMigrationSet.has(entry.migration)) {
      return failCheck(
        "MIGRATION-ALLOWLIST-STATE",
        "allowlist_entry_missing_forward_migration",
        `Allowlist references a nonexistent forward migration: ${entry.migration}`,
      );
    }
  }

  return passCheck(
    "MIGRATION-ALLOWLIST-STATE",
    "allowlist_entries_ok",
    `Allowlisted migrations: ${allowlistEntries.map((entry) => `${entry.migration} (${entry.rationale.trim()})`).join(", ")}`,
  );
}

async function buildPairsCheck({
  dirState,
  migrationFiles,
  forwardMigrations,
  allowlistEntries,
  allowlistUsable,
  readTextFile,
}: {
  dirState: FileSetResult;
  migrationFiles: string[];
  forwardMigrations: string[];
  allowlistEntries: readonly MigrationAllowlistEntry[];
  allowlistUsable: boolean;
  readTextFile: (filePath: string) => Promise<string>;
}): Promise<CheckerCheck> {
  if (!dirState.ok) {
    return failCheck(
      "MIGRATION-PAIRS",
      "migrations_scan_unavailable",
      `Cannot evaluate rollback siblings because ${normalizeRepoRelativePath(MIGRATIONS_DIR)} could not be read: ${normalizeDetail(dirState.error)}`,
    );
  }

  const allowlistSet = allowlistUsable
    ? new Set(allowlistEntries.map((entry) => entry.migration))
    : new Set<string>();
  const downFiles = new Set(migrationFiles.filter((fileName) => fileName.endsWith(".down.sql")));
  const resolvedPairs: string[] = [];

  for (const migration of forwardMigrations) {
    const rollback = migration.replace(/\.sql$/, ".down.sql");

    if (!downFiles.has(rollback)) {
      if (allowlistSet.has(migration)) {
        resolvedPairs.push(`${migration} -> allowlisted`);
        continue;
      }

      return failCheck(
        "MIGRATION-PAIRS",
        "rollback_missing",
        `Missing rollback sibling for ${migration}: expected ${rollback}`,
      );
    }

    try {
      await readTextFile(path.resolve(MIGRATIONS_DIR, rollback));
    } catch (error) {
      return failCheck(
        "MIGRATION-PAIRS",
        "rollback_file_unreadable",
        `${normalizeRepoRelativePath(path.resolve(MIGRATIONS_DIR, rollback))} (${normalizeDetail(error)})`,
      );
    }

    resolvedPairs.push(`${migration} -> ${rollback}`);
  }

  return passCheck(
    "MIGRATION-PAIRS",
    "all_rollbacks_present",
    resolvedPairs.length === 0
      ? "No forward migrations found."
      : `Verified rollback siblings: ${resolvedPairs.join(", ")}`,
  );
}

async function buildPackageCheck(
  readPackageJson: () => Promise<string>,
): Promise<CheckerCheck> {
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

function passCheck(
  id: CheckMigrationsHaveDownsCheckId,
  status_code: string,
  detail?: unknown,
): CheckerCheck {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(
  id: CheckMigrationsHaveDownsCheckId,
  status_code: string,
  detail?: unknown,
): CheckerCheck {
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

function normalizeRepoRelativePath(filePath: string): string {
  const relativePath = path.isAbsolute(filePath)
    ? path.relative(REPO_ROOT, filePath)
    : filePath;
  return relativePath.split(path.sep).join("/");
}

async function readMigrationDirState(
  readDirImpl: (dirPath: string) => Promise<string[]>,
): Promise<FileSetResult> {
  try {
    const entries = await readDirImpl(MIGRATIONS_DIR);
    return { ok: true, entries };
  } catch (error) {
    return { ok: false, error };
  }
}

async function defaultReadDir(dirPath: string): Promise<string[]> {
  return readdir(dirPath);
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

async function defaultReadPackageJson(): Promise<string> {
  return readFile(PACKAGE_JSON_PATH, "utf8");
}

if (import.meta.main) {
  try {
    const args = parseCheckMigrationsHaveDownsArgs(process.argv.slice(2));
    const { exitCode } = await buildCheckMigrationsHaveDownsHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
