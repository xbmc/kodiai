import { readFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations, runRollback } from "../src/db/migrate.ts";

const COMMAND_NAME = "verify:m056:s01" as const;
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m056-s01.ts";
const TARGET_ROLLBACK_VERSION = 11;
const TARGET_TABLES = [
  "wiki_staleness_run_state",
  "review_clusters",
  "review_cluster_assignments",
  "cluster_run_state",
  "issue_triage_state",
  "wiki_style_cache",
  "guardrail_audit",
] as const;
const REQUIRED_ROLLBACK_FILES = [
  path.resolve(REPO_ROOT, "src/db/migrations/012-wiki-staleness-run-state.down.sql"),
  path.resolve(REPO_ROOT, "src/db/migrations/013-review-clusters.down.sql"),
  path.resolve(REPO_ROOT, "src/db/migrations/016-issue-triage-state.down.sql"),
  path.resolve(REPO_ROOT, "src/db/migrations/025-wiki-style-cache.down.sql"),
  path.resolve(REPO_ROOT, "src/db/migrations/026-guardrail-audit.down.sql"),
] as const;

export const M056_S01_CHECK_IDS = [
  "M056-S01-ROLLBACK-FILES",
  "M056-S01-PACKAGE-WIRING",
  "M056-S01-DATABASE-ACCESS",
  "M056-S01-ROLLBACK-ROUNDTRIP",
] as const;

export type M056S01CheckId = (typeof M056_S01_CHECK_IDS)[number];

export type Check = {
  id: M056S01CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M056S01CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

export type RuntimeResult = {
  ok: boolean;
  status_code: string;
  detail?: string;
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EnvShape = Partial<Record<"TEST_DATABASE_URL" | "DATABASE_URL", string | undefined>>;

type EvaluateOptions = {
  generatedAt?: string;
  env?: EnvShape;
  readTextFile?: (filePath: string) => Promise<string>;
  runRuntimeRoundTrip?: (params: { connectionString: string }) => Promise<RuntimeResult>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

type RollbackFileState = {
  path: string;
  content: string | null;
  error: unknown;
};

export async function evaluateM056S01RollbackContract(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const sourceEnv = options.env ?? process.env;
  const env: EnvShape = {
    TEST_DATABASE_URL: sourceEnv.TEST_DATABASE_URL,
    DATABASE_URL: sourceEnv.DATABASE_URL,
  };
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const runRuntimeRoundTrip = options.runRuntimeRoundTrip ?? defaultRunRuntimeRoundTrip;

  const rollbackFileStates = await Promise.all(
    REQUIRED_ROLLBACK_FILES.map(async (filePath) => {
      try {
        const content = await readTextFile(filePath);
        return { path: filePath, content, error: null } satisfies RollbackFileState;
      } catch (error) {
        return { path: filePath, content: null, error } satisfies RollbackFileState;
      }
    }),
  );

  let packageJsonContent: string | null = null;
  let packageJsonReadError: unknown = null;
  try {
    packageJsonContent = await readTextFile(PACKAGE_JSON_PATH);
  } catch (error) {
    packageJsonReadError = error;
  }

  const connectionString = env.TEST_DATABASE_URL ?? env.DATABASE_URL;

  const rollbackFilesCheck = buildRollbackFilesCheck(rollbackFileStates);
  const packageWiringCheck =
    packageJsonContent == null
      ? failCheck("M056-S01-PACKAGE-WIRING", "package_file_unreadable", packageJsonReadError)
      : buildPackageWiringCheck(packageJsonContent);
  const databaseAccessCheck = buildDatabaseAccessCheck(env);

  let runtimeCheck: Check;
  if (!connectionString) {
    runtimeCheck = failCheck(
      "M056-S01-ROLLBACK-ROUNDTRIP",
      "database_url_missing",
      "runtime check skipped because neither TEST_DATABASE_URL nor DATABASE_URL is set.",
    );
  } else {
    try {
      const runtimeResult = await runRuntimeRoundTrip({ connectionString });
      runtimeCheck = runtimeResult.ok
        ? passCheck("M056-S01-ROLLBACK-ROUNDTRIP", runtimeResult.status_code, runtimeResult.detail)
        : failCheck("M056-S01-ROLLBACK-ROUNDTRIP", runtimeResult.status_code, runtimeResult.detail);
    } catch (error) {
      runtimeCheck = failCheck(
        "M056-S01-ROLLBACK-ROUNDTRIP",
        classifyRuntimeThrownError(error),
        error,
      );
    }
  }

  const checks = [rollbackFilesCheck, packageWiringCheck, databaseAccessCheck, runtimeCheck];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M056_S01_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM056S01Report(report: EvaluationReport): string {
  const lines = [
    "M056 S01 early rollback verifier",
    `Generated at: ${report.generatedAt}`,
    `Rollback proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM056S01ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM056S01RollbackContract(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM056S01Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m056:s01 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM056S01Args(args: readonly string[]): { json: boolean } {
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

function buildRollbackFilesCheck(states: RollbackFileState[]): Check {
  const missing = states.filter((state) => state.content == null && looksLikeMissingFileError(state.error));
  if (missing.length > 0) {
    return failCheck(
      "M056-S01-ROLLBACK-FILES",
      "rollback_files_missing",
      `Missing rollback files: ${missing.map((state) => normalizeRepoRelativePath(state.path)).join(", ")}`,
    );
  }

  const unreadable = states.filter((state) => state.content == null);
  if (unreadable.length > 0) {
    return failCheck(
      "M056-S01-ROLLBACK-FILES",
      "rollback_files_unreadable",
      unreadable
        .map((state) => `${normalizeRepoRelativePath(state.path)} (${normalizeDetail(state.error)})`)
        .join("; "),
    );
  }

  return passCheck(
    "M056-S01-ROLLBACK-FILES",
    "rollback_files_ok",
    `Resolved rollback siblings: ${states.map((state) => normalizeRepoRelativePath(state.path)).join(", ")}`,
  );
}

function buildPackageWiringCheck(packageJsonContent: string): Check {
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck("M056-S01-PACKAGE-WIRING", "package_json_invalid", error);
  }

  const actualScript = packageJson.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M056-S01-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M056-S01-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M056-S01-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function buildDatabaseAccessCheck(env: EnvShape): Check {
  if (env.TEST_DATABASE_URL) {
    return passCheck(
      "M056-S01-DATABASE-ACCESS",
      "database_url_ok",
      "Runtime round-trip will use TEST_DATABASE_URL.",
    );
  }

  if (env.DATABASE_URL) {
    return passCheck(
      "M056-S01-DATABASE-ACCESS",
      "database_url_ok",
      "Runtime round-trip will fall back to DATABASE_URL because TEST_DATABASE_URL is unset.",
    );
  }

  return failCheck(
    "M056-S01-DATABASE-ACCESS",
    "database_url_missing",
    "Neither TEST_DATABASE_URL nor DATABASE_URL is set, so the rollback round-trip cannot run.",
  );
}

async function defaultRunRuntimeRoundTrip({ connectionString }: { connectionString: string }): Promise<RuntimeResult> {
  const logger = pino({ level: "silent" });
  const client = createDbClient({ connectionString, logger });

  try {
    await resetMigrationState(client.sql);
    await runMigrations(client.sql);

    const afterUp = await readTargetTablePresence(client.sql);
    const missingAfterUp = TARGET_TABLES.filter((table) => !afterUp.has(table));
    if (missingAfterUp.length > 0) {
      return {
        ok: false,
        status_code: "rollback_roundtrip_schema_drift",
        detail: `Missing after migrate-up: ${missingAfterUp.join(", ")}`,
      };
    }

    await runRollback(client.sql, TARGET_ROLLBACK_VERSION);

    const afterRollback = await readTargetTablePresence(client.sql);
    const stillPresentAfterRollback = TARGET_TABLES.filter((table) => afterRollback.has(table));
    if (stillPresentAfterRollback.length > 0) {
      return {
        ok: false,
        status_code: "rollback_roundtrip_schema_drift",
        detail: `Still present after rollback to ${TARGET_ROLLBACK_VERSION}: ${stillPresentAfterRollback.join(", ")}`,
      };
    }

    await runMigrations(client.sql);

    const afterReapply = await readTargetTablePresence(client.sql);
    const missingAfterReapply = TARGET_TABLES.filter((table) => !afterReapply.has(table));
    if (missingAfterReapply.length > 0) {
      return {
        ok: false,
        status_code: "rollback_roundtrip_schema_drift",
        detail: `Missing after re-apply: ${missingAfterReapply.join(", ")}`,
      };
    }

    return {
      ok: true,
      status_code: "rollback_roundtrip_ok",
      detail:
        "All targeted tables existed after migrate-up, disappeared after rollback to 11, and returned after re-apply.",
    };
  } finally {
    await client.close();
  }
}

async function resetMigrationState(sql: ReturnType<typeof createDbClient>["sql"]): Promise<void> {
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO CURRENT_USER;
    GRANT ALL ON SCHEMA public TO PUBLIC;
  `);
}

async function readTargetTablePresence(sql: ReturnType<typeof createDbClient>["sql"]): Promise<Set<string>> {
  const targetList = [...TARGET_TABLES]
    .map((table) => `'${table}'`)
    .join(", ");
  const rows = await sql.unsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${targetList})
  `) as Array<{ table_name: string }>;

  return new Set(rows.map((row) => row.table_name));
}

function classifyRuntimeThrownError(error: unknown): string {
  const detail = normalizeDetail(error);
  if (detail.includes("Missing rollback file:")) {
    return "rollback_artifact_missing";
  }
  if (/timeout/i.test(detail)) {
    return "database_access_timeout";
  }
  return "database_access_failed";
}

function looksLikeMissingFileError(error: unknown): boolean {
  const detail = normalizeDetail(error);
  return detail.includes("ENOENT") || detail.includes("no such file or directory");
}

function passCheck(id: M056S01CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M056S01CheckId, status_code: string, detail?: unknown): Check {
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
  const relativePath = path.isAbsolute(filePath) ? path.relative(REPO_ROOT, filePath) : filePath;
  return relativePath.split(path.sep).join("/");
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

if (import.meta.main) {
  try {
    const args = parseM056S01Args(process.argv.slice(2));
    const { exitCode } = await buildM056S01ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m056:s01 failed: ${message}\n`);
    process.exit(1);
  }
}
