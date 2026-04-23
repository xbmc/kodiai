import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseRegistryContent, type ParsedRegistry, type RegistryRow } from "./verify-m059-s01.ts";

const COMMAND_NAME = "verify:m059:s02" as const;
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m059-s02.ts";
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const REGISTRY_PATH = path.resolve(REPO_ROOT, "scripts/REGISTRY.md");
const APPENDIX_HEADING = "## S02 Orphan Audit";
const APPENDIX_HEADER = ["path", "disposition", "rationale"] as const;

export const M059_S02_CHECK_IDS = [
  "M059-S02-APPENDIX-COVERAGE",
  "M059-S02-RETAINED-TRUTH",
  "M059-S02-REMOVAL-TRUTH",
  "M059-S02-PACKAGE-WIRING",
] as const;

export type M059S02CheckId = (typeof M059_S02_CHECK_IDS)[number];

export type Check = {
  id: M059S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M059S02CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

type StdWriter = { write: (chunk: string) => boolean | void };

type EvaluateOptions = {
  generatedAt?: string;
  readTextFile?: (filePath: string) => Promise<string>;
  listTrackedScriptFiles?: () => Promise<string[]>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

type ReadResult =
  | { ok: true; content: string }
  | { ok: false; error: unknown };

type PackageJsonShape = {
  scripts?: Record<string, string> | unknown;
};

type AppendixDisposition = "retained" | "removed";

type AppendixRow = {
  path: string;
  disposition: AppendixDisposition;
  rationale: string;
  sourceLine: number;
};

type ParsedAppendix =
  | { ok: true; rows: AppendixRow[] }
  | { ok: false; status_code: string; detail: string; rows: AppendixRow[] };

export async function evaluateM059S02Proof(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const listTrackedScriptFiles = options.listTrackedScriptFiles ?? defaultListTrackedScriptFiles;

  const [packageContent, registryContent, trackedFilesResult] = await Promise.all([
    readOptionalTextFile(readTextFile, PACKAGE_JSON_PATH),
    readOptionalTextFile(readTextFile, REGISTRY_PATH),
    readTrackedScriptFiles(listTrackedScriptFiles),
  ]);

  const parsedRegistry = parseRegistryReadResult(registryContent);
  const parsedAppendix = parseAppendixReadResult(registryContent);
  const parsedPackageJson = parsePackageJsonResult(packageContent);

  const checks: Check[] = [
    buildAppendixCoverageCheck(parsedRegistry, parsedAppendix),
    buildRetainedTruthCheck(parsedAppendix, trackedFilesResult),
    buildRemovalTruthCheck(parsedRegistry, parsedAppendix, trackedFilesResult),
    buildPackageWiringCheck(parsedPackageJson),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M059_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM059S02Report(report: EvaluationReport): string {
  const lines = [
    "M059 S02 orphan audit verifier",
    `Generated at: ${report.generatedAt}`,
    `Orphan audit proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM059S02ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM059S02Proof(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM059S02Report(report));
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

export function parseM059S02Args(args: readonly string[]): { json: boolean } {
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

function buildAppendixCoverageCheck(parsedRegistry: ParsedRegistry, parsedAppendix: ParsedAppendix): Check {
  if (!parsedRegistry.ok) {
    return failCheck("M059-S02-APPENDIX-COVERAGE", parsedRegistry.status_code, parsedRegistry.detail);
  }

  if (!parsedAppendix.ok) {
    return failCheck("M059-S02-APPENDIX-COVERAGE", parsedAppendix.status_code, parsedAppendix.detail);
  }

  const orphanRows = parsedRegistry.rows.filter(isUsageNoneRow);
  const appendixPaths = new Set(parsedAppendix.rows.map((row) => row.path));
  const missingPaths = orphanRows.map((row) => row.path).filter((filePath) => !appendixPaths.has(filePath));

  if (missingPaths.length > 0) {
    return failCheck(
      "M059-S02-APPENDIX-COVERAGE",
      "orphan_audit_missing_row",
      `Missing orphan-audit entries for usage none rows: ${missingPaths.join(", ")}`,
    );
  }

  return passCheck(
    "M059-S02-APPENDIX-COVERAGE",
    "appendix_coverage_ok",
    `Orphan audit covers ${orphanRows.length} usage none registry rows.`,
  );
}

function buildRetainedTruthCheck(
  parsedAppendix: ParsedAppendix,
  trackedFilesResult: Awaited<ReturnType<typeof readTrackedScriptFiles>>,
): Check {
  if (!trackedFilesResult.ok) {
    return failCheck("M059-S02-RETAINED-TRUTH", "tracked_files_unreadable", trackedFilesResult.error);
  }

  if (!parsedAppendix.ok) {
    return failCheck("M059-S02-RETAINED-TRUTH", parsedAppendix.status_code, parsedAppendix.detail);
  }

  const trackedFiles = new Set(trackedFilesResult.files);
  const missingRetained = parsedAppendix.rows
    .filter((row) => row.disposition === "retained")
    .map((row) => row.path)
    .filter((filePath) => !trackedFiles.has(filePath));

  if (missingRetained.length > 0) {
    return failCheck(
      "M059-S02-RETAINED-TRUTH",
      "orphan_retained_missing_file",
      `Retained orphan-audit entries must point to live tracked files: ${missingRetained.join(", ")}`,
    );
  }

  return passCheck(
    "M059-S02-RETAINED-TRUTH",
    "retained_truth_ok",
    `Validated ${parsedAppendix.rows.filter((row) => row.disposition === "retained").length} retained orphan entries.`,
  );
}

function buildRemovalTruthCheck(
  parsedRegistry: ParsedRegistry,
  parsedAppendix: ParsedAppendix,
  trackedFilesResult: Awaited<ReturnType<typeof readTrackedScriptFiles>>,
): Check {
  if (!trackedFilesResult.ok) {
    return failCheck("M059-S02-REMOVAL-TRUTH", "tracked_files_unreadable", trackedFilesResult.error);
  }

  if (!parsedRegistry.ok) {
    return failCheck("M059-S02-REMOVAL-TRUTH", parsedRegistry.status_code, parsedRegistry.detail);
  }

  if (!parsedAppendix.ok) {
    return failCheck("M059-S02-REMOVAL-TRUTH", parsedAppendix.status_code, parsedAppendix.detail);
  }

  const trackedFiles = new Set(trackedFilesResult.files);
  const removedStillTracked = parsedAppendix.rows
    .filter((row) => row.disposition === "removed")
    .map((row) => row.path)
    .filter((filePath) => trackedFiles.has(filePath));

  if (removedStillTracked.length > 0) {
    return failCheck(
      "M059-S02-REMOVAL-TRUTH",
      "orphan_removed_file_still_exists",
      `Removed orphan-audit entries must not point to live tracked files: ${removedStillTracked.join(", ")}`,
    );
  }

  const removedRegistryRows = new Set(
    parsedAppendix.rows
      .filter((row) => row.disposition === "removed")
      .map((row) => row.path),
  );
  const staleRows = parsedRegistry.rows
    .filter((row) => removedRegistryRows.has(row.path))
    .map((row) => row.path);

  if (staleRows.length > 0) {
    return failCheck(
      "M059-S02-REMOVAL-TRUTH",
      "orphan_removal_stale_registry_row",
      `Removed orphan-audit entries must not remain in the main registry table: ${staleRows.join(", ")}`,
    );
  }

  return passCheck(
    "M059-S02-REMOVAL-TRUTH",
    "removal_truth_ok",
    `Validated ${parsedAppendix.rows.filter((row) => row.disposition === "removed").length} removed orphan entries.`,
  );
}

function buildPackageWiringCheck(parsedPackageJson: ReturnType<typeof parsePackageJsonResult>): Check {
  if (!parsedPackageJson.ok) {
    return failCheck("M059-S02-PACKAGE-WIRING", "package_json_invalid", parsedPackageJson.error);
  }

  const scripts = normalizeScriptsMap(parsedPackageJson.value);
  if (!scripts.ok) {
    return failCheck("M059-S02-PACKAGE-WIRING", "package_json_invalid", scripts.error);
  }

  const actualScript = scripts.value[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M059-S02-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M059-S02-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M059-S02-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function parseRegistryReadResult(result: ReadResult): ParsedRegistry {
  if (!result.ok) {
    const detail = normalizeDetail(result.error);
    if (/ENOENT/i.test(detail)) {
      return { ok: false, status_code: "registry_missing", detail, scopeDeclarationPresent: false };
    }
    return { ok: false, status_code: "registry_file_unreadable", detail, scopeDeclarationPresent: false };
  }

  return parseRegistryContent(result.content);
}

function parseAppendixReadResult(result: ReadResult): ParsedAppendix {
  if (!result.ok) {
    const detail = normalizeDetail(result.error);
    if (/ENOENT/i.test(detail)) {
      return { ok: false, status_code: "registry_missing", detail, rows: [] };
    }
    return { ok: false, status_code: "registry_file_unreadable", detail, rows: [] };
  }

  return parseAppendixContent(result.content);
}

function parseAppendixContent(content: string): ParsedAppendix {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === APPENDIX_HEADING);
  if (headingIndex < 0) {
    return {
      ok: false,
      status_code: "orphan_audit_missing",
      detail: `${APPENDIX_HEADING} heading is required next to the main registry table.`,
      rows: [],
    };
  }

  let headerIndex = headingIndex + 1;
  while (headerIndex < lines.length && !(lines[headerIndex] ?? "").trim()) {
    headerIndex += 1;
  }
  const dividerIndex = headerIndex + 1;
  const headerCells = splitTableRow(lines[headerIndex] ?? "");
  if (headerCells.length !== APPENDIX_HEADER.length || !APPENDIX_HEADER.every((cell, index) => headerCells[index] === cell)) {
    return {
      ok: false,
      status_code: "orphan_audit_malformed",
      detail: `Orphan audit header must be exactly: ${APPENDIX_HEADER.join(", ")}`,
      rows: [],
    };
  }

  if (!/^\|\s*---/.test((lines[dividerIndex] ?? "").trim())) {
    return {
      ok: false,
      status_code: "orphan_audit_malformed",
      detail: "Orphan audit table must include a divider row.",
      rows: [],
    };
  }

  const rows: AppendixRow[] = [];
  for (let index = dividerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      break;
    }
    if (!trimmed.startsWith("|")) {
      break;
    }

    const cells = splitTableRow(line);
    if (cells.length !== APPENDIX_HEADER.length) {
      return {
        ok: false,
        status_code: "orphan_audit_malformed",
        detail: `Line ${index + 1} must contain ${APPENDIX_HEADER.length} orphan-audit cells; found ${cells.length}.`,
        rows,
      };
    }

    const [filePath, dispositionRaw, rationale] = cells;
    if (!filePath || !dispositionRaw || !rationale) {
      return {
        ok: false,
        status_code: "orphan_audit_malformed",
        detail: `Line ${index + 1} must provide non-empty path, disposition, and rationale values.`,
        rows,
      };
    }

    if (dispositionRaw !== "retained" && dispositionRaw !== "removed") {
      return {
        ok: false,
        status_code: "orphan_audit_malformed",
        detail: `Line ${index + 1} uses unknown disposition ${dispositionRaw}; allowed values: retained, removed.`,
        rows,
      };
    }

    rows.push({
      path: filePath,
      disposition: dispositionRaw,
      rationale,
      sourceLine: index + 1,
    });
  }

  return { ok: true, rows };
}

function isUsageNoneRow(row: RegistryRow): boolean {
  return row.usageRefs.length === 1 && row.usageRefs[0]?.kind === "none";
}

function parsePackageJsonResult(result: ReadResult):
  | { ok: true; value: PackageJsonShape }
  | { ok: false; error: unknown } {
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  try {
    return { ok: true, value: JSON.parse(result.content) as PackageJsonShape };
  } catch (error) {
    return { ok: false, error };
  }
}

function normalizeScriptsMap(packageJson: PackageJsonShape):
  | { ok: true; value: Record<string, string> }
  | { ok: false; error: unknown } {
  if (typeof packageJson.scripts !== "object" || packageJson.scripts == null || Array.isArray(packageJson.scripts)) {
    return { ok: true, value: {} };
  }

  const scripts: Record<string, string> = {};
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    if (typeof command !== "string") {
      return { ok: false, error: `package.json scripts.${name} must be a string command.` };
    }
    scripts[name] = command;
  }

  return { ok: true, value: scripts };
}

async function readOptionalTextFile(
  readTextFile: (filePath: string) => Promise<string>,
  filePath: string,
): Promise<ReadResult> {
  try {
    return { ok: true, content: await readTextFile(filePath) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function readTrackedScriptFiles(
  listTrackedScriptFiles: () => Promise<string[]>,
): Promise<{ ok: true; files: string[] } | { ok: false; error: unknown }> {
  try {
    const files = (await listTrackedScriptFiles())
      .filter((filePath) => filePath.startsWith("scripts/"))
      .filter((filePath) => filePath.endsWith(".ts") || filePath.endsWith(".sh"))
      .sort();
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error };
  }
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function passCheck(id: M059S02CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M059S02CheckId, status_code: string, detail?: unknown): Check {
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

async function defaultListTrackedScriptFiles(): Promise<string[]> {
  const entries = await Array.fromAsync(new Bun.Glob("scripts/**/*").scan({
    cwd: REPO_ROOT,
    onlyFiles: true,
    absolute: false,
  }));

  return entries.sort();
}

if (import.meta.main) {
  try {
    const args = parseM059S02Args(process.argv.slice(2));
    const { exitCode } = await buildM059S02ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
