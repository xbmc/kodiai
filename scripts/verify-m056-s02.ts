import { readFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations, runRollback } from "../src/db/migrate.ts";

const COMMAND_NAME = "verify:m056:s02" as const;
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m056-s02.ts";
const TARGET_ROLLBACK_VERSION = 32;
const TARGET_TABLES = [
  "canonical_code_chunks",
  "canonical_corpus_backfill_state",
  "review_graph_builds",
  "review_graph_files",
  "review_graph_nodes",
  "review_graph_edges",
  "generated_rules",
  "suggestion_cluster_models",
] as const;
const REQUIRED_ROLLBACK_FILES = [
  path.resolve(REPO_ROOT, "src/db/migrations/033-canonical-code-corpus.down.sql"),
  path.resolve(REPO_ROOT, "src/db/migrations/034-review-graph.down.sql"),
  path.resolve(REPO_ROOT, "src/db/migrations/035-generated-rules.down.sql"),
  path.resolve(REPO_ROOT, "src/db/migrations/036-suggestion-cluster-models.down.sql"),
] as const;
const REQUIRED_SLOT_030_FILES = [
  path.resolve(REPO_ROOT, "src/db/migrations/030-reserved.sql"),
  path.resolve(REPO_ROOT, "src/db/migrations/030-reserved.down.sql"),
] as const;
const RESERVED_SLOT_FORBIDDEN_DDL = /\b(create|alter|drop|truncate)\b/i;

export const M056_S02_CHECK_IDS = [
  "M056-S02-ROLLBACK-FILES",
  "M056-S02-SLOT-030",
  "M056-S02-PACKAGE-WIRING",
  "M056-S02-DATABASE-ACCESS",
  "M056-S02-ROLLBACK-ROUNDTRIP",
] as const;

export type M056S02CheckId = (typeof M056_S02_CHECK_IDS)[number];

export type Check = {
  id: M056S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M056S02CheckId[];
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

type FileState = {
  path: string;
  content: string | null;
  error: unknown;
};

export async function evaluateM056S02RollbackContract(
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

  const rollbackFileStates = await Promise.all(REQUIRED_ROLLBACK_FILES.map((filePath) => readFileState(filePath, readTextFile)));
  const slot030States = await Promise.all(REQUIRED_SLOT_030_FILES.map((filePath) => readFileState(filePath, readTextFile)));
  const packageState = await readFileState(PACKAGE_JSON_PATH, readTextFile);
  const connectionString = env.TEST_DATABASE_URL ?? env.DATABASE_URL;

  const rollbackFilesCheck = buildRollbackFilesCheck(rollbackFileStates);
  const slot030Check = buildSlot030Check(slot030States);
  const packageWiringCheck =
    packageState.content == null
      ? failCheck("M056-S02-PACKAGE-WIRING", "package_file_unreadable", packageState.error)
      : buildPackageWiringCheck(packageState.content);
  const databaseAccessCheck = buildDatabaseAccessCheck(env);

  let runtimeCheck: Check;
  if (!connectionString) {
    runtimeCheck = failCheck(
      "M056-S02-ROLLBACK-ROUNDTRIP",
      "database_url_missing",
      "runtime check skipped because neither TEST_DATABASE_URL nor DATABASE_URL is set.",
    );
  } else {
    try {
      const runtimeResult = await runRuntimeRoundTrip({ connectionString });
      runtimeCheck = runtimeResult.ok
        ? passCheck("M056-S02-ROLLBACK-ROUNDTRIP", runtimeResult.status_code, runtimeResult.detail)
        : failCheck("M056-S02-ROLLBACK-ROUNDTRIP", runtimeResult.status_code, runtimeResult.detail);
    } catch (error) {
      runtimeCheck = failCheck(
        "M056-S02-ROLLBACK-ROUNDTRIP",
        classifyRuntimeThrownError(error),
        error,
      );
    }
  }

  const checks = [
    rollbackFilesCheck,
    slot030Check,
    packageWiringCheck,
    databaseAccessCheck,
    runtimeCheck,
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M056_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM056S02Report(report: EvaluationReport): string {
  const lines = [
    "M056 S02 late rollback verifier",
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

export async function buildM056S02ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM056S02RollbackContract(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM056S02Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m056:s02 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM056S02Args(args: readonly string[]): { json: boolean } {
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

function buildRollbackFilesCheck(states: FileState[]): Check {
  const missing = states.filter((state) => state.content == null && looksLikeMissingFileError(state.error));
  if (missing.length > 0) {
    return failCheck(
      "M056-S02-ROLLBACK-FILES",
      "rollback_files_missing",
      `Missing rollback files: ${missing.map((state) => normalizeRepoRelativePath(state.path)).join(", ")}`,
    );
  }

  const unreadable = states.filter((state) => state.content == null);
  if (unreadable.length > 0) {
    return failCheck(
      "M056-S02-ROLLBACK-FILES",
      "rollback_files_unreadable",
      unreadable
        .map((state) => `${normalizeRepoRelativePath(state.path)} (${normalizeDetail(state.error)})`)
        .join("; "),
    );
  }

  return passCheck(
    "M056-S02-ROLLBACK-FILES",
    "rollback_files_ok",
    `Resolved rollback siblings: ${states.map((state) => normalizeRepoRelativePath(state.path)).join(", ")}`,
  );
}

function buildSlot030Check(states: FileState[]): Check {
  const missing = states.filter((state) => state.content == null && looksLikeMissingFileError(state.error));
  if (missing.length > 0) {
    return failCheck(
      "M056-S02-SLOT-030",
      "slot_030_ambiguous",
      `Reserved migration slot 030 is ambiguous; missing files: ${missing.map((state) => normalizeRepoRelativePath(state.path)).join(", ")}`,
    );
  }

  const unreadable = states.filter((state) => state.content == null);
  if (unreadable.length > 0) {
    return failCheck(
      "M056-S02-SLOT-030",
      "slot_030_unreadable",
      unreadable
        .map((state) => `${normalizeRepoRelativePath(state.path)} (${normalizeDetail(state.error)})`)
        .join("; "),
    );
  }

  const ddlMutations = states
    .filter((state) => RESERVED_SLOT_FORBIDDEN_DDL.test(state.content ?? ""))
    .map((state) => normalizeRepoRelativePath(state.path));
  if (ddlMutations.length > 0) {
    return failCheck(
      "M056-S02-SLOT-030",
      "slot_030_not_neutral",
      `Reserved migration slot 030 must stay schema-neutral: DDL detected in ${ddlMutations.join(", ")}`,
    );
  }

  return passCheck(
    "M056-S02-SLOT-030",
    "slot_030_ok",
    `Reserved migration slot 030 resolves via ${states.map((state) => normalizeRepoRelativePath(state.path)).join(" + ")}`,
  );
}

function buildPackageWiringCheck(packageJsonContent: string): Check {
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck("M056-S02-PACKAGE-WIRING", "package_json_invalid", error);
  }

  const actualScript = packageJson.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M056-S02-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M056-S02-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M056-S02-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function buildDatabaseAccessCheck(env: EnvShape): Check {
  if (env.TEST_DATABASE_URL) {
    return passCheck(
      "M056-S02-DATABASE-ACCESS",
      "database_url_ok",
      "Runtime round-trip will use TEST_DATABASE_URL.",
    );
  }

  if (env.DATABASE_URL) {
    return passCheck(
      "M056-S02-DATABASE-ACCESS",
      "database_url_ok",
      "Runtime round-trip will fall back to DATABASE_URL because TEST_DATABASE_URL is unset.",
    );
  }

  return failCheck(
    "M056-S02-DATABASE-ACCESS",
    "database_url_missing",
    "Neither TEST_DATABASE_URL nor DATABASE_URL is set, so the rollback round-trip cannot run.",
  );
}

async function defaultRunRuntimeRoundTrip({ connectionString }: { connectionString: string }): Promise<RuntimeResult> {
  const logger = pino({ level: "silent" });
  const client = createDbClient({ connectionString, logger });

  try {
    await withSilencedConsole(async () => {
      await resetMigrationState(client.sql);
      await runMigrations(client.sql);
    });

    const afterUp = await readTargetTablePresence(client.sql);
    const missingAfterUp = TARGET_TABLES.filter((table) => !afterUp.has(table));
    if (missingAfterUp.length > 0) {
      return {
        ok: false,
        status_code: "rollback_roundtrip_schema_drift",
        detail: `Missing after migrate-up: ${missingAfterUp.join(", ")}`,
      };
    }

    const slot030MutationAfterUp = await readReservedSlotMutationCount(client.sql);
    if (slot030MutationAfterUp !== 0) {
      return {
        ok: false,
        status_code: "slot_030_not_neutral",
        detail: `Reserved migration slot 030 mutated schema state after migrate-up: observed ${slot030MutationAfterUp} unexpected public tables with 030-specific names.`,
      };
    }

    await withSilencedConsole(async () => {
      await runRollback(client.sql, TARGET_ROLLBACK_VERSION);
    });

    const afterRollback = await readTargetTablePresence(client.sql);
    const stillPresentAfterRollback = TARGET_TABLES.filter((table) => afterRollback.has(table));
    if (stillPresentAfterRollback.length > 0) {
      return {
        ok: false,
        status_code: "rollback_roundtrip_schema_drift",
        detail: `Still present after rollback to ${TARGET_ROLLBACK_VERSION}: ${stillPresentAfterRollback.join(", ")}`,
      };
    }

    const slot030MutationAfterRollback = await readReservedSlotMutationCount(client.sql);
    if (slot030MutationAfterRollback !== 0) {
      return {
        ok: false,
        status_code: "slot_030_not_neutral",
        detail: `Reserved migration slot 030 mutated schema state during rollback to ${TARGET_ROLLBACK_VERSION}: observed ${slot030MutationAfterRollback} unexpected public tables with 030-specific names.`,
      };
    }

    await withSilencedConsole(async () => {
      await runMigrations(client.sql);
    });

    const afterReapply = await readTargetTablePresence(client.sql);
    const missingAfterReapply = TARGET_TABLES.filter((table) => !afterReapply.has(table));
    if (missingAfterReapply.length > 0) {
      return {
        ok: false,
        status_code: "rollback_roundtrip_schema_drift",
        detail: `Missing after re-apply: ${missingAfterReapply.join(", ")}`,
      };
    }

    const slot030MutationAfterReapply = await readReservedSlotMutationCount(client.sql);
    if (slot030MutationAfterReapply !== 0) {
      return {
        ok: false,
        status_code: "slot_030_not_neutral",
        detail: `Reserved migration slot 030 mutated schema state after re-apply: observed ${slot030MutationAfterReapply} unexpected public tables with 030-specific names.`,
      };
    }

    return {
      ok: true,
      status_code: "rollback_roundtrip_ok",
      detail:
        "All targeted tables existed after migrate-up, disappeared after rollback to 32, and returned after re-apply.",
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
  const targetList = [...TARGET_TABLES].map((table) => `'${table}'`).join(", ");
  const rows = (await sql.unsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${targetList})
  `)) as Array<{ table_name: string }>;

  return new Set(rows.map((row) => row.table_name));
}

async function readReservedSlotMutationCount(sql: ReturnType<typeof createDbClient>["sql"]): Promise<number> {
  const rows = (await sql.unsafe(`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE '030%'
  `)) as Array<{ count: number }>;

  return rows[0]?.count ?? 0;
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

function passCheck(id: M056S02CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M056S02CheckId, status_code: string, detail?: unknown): Check {
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

async function withSilencedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};

  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
}

async function readFileState(
  filePath: string,
  readTextFile: (filePath: string) => Promise<string>,
): Promise<FileState> {
  try {
    const content = await readTextFile(filePath);
    return { path: filePath, content, error: null };
  } catch (error) {
    return { path: filePath, content: null, error };
  }
}

if (import.meta.main) {
  try {
    const args = parseM056S02Args(process.argv.slice(2));
    const { exitCode } = await buildM056S02ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m056:s02 failed: ${message}\n`);
    process.exit(1);
  }
}
