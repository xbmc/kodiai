import { readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m059:s01" as const;
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m059-s01.ts";
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const REGISTRY_PATH = path.resolve(REPO_ROOT, "scripts/REGISTRY.md");
const WORKFLOW_PATHS = [
  ".github/workflows/ci.yml",
  ".github/workflows/nightly-issue-sync.yml",
  ".github/workflows/nightly-reaction-sync.yml",
] as const;
const ALLOWED_LIFECYCLES = ["active", "internal", "deprecated", "sunset"] as const;
export const REGISTRY_HEADER = ["path", "purpose", "owner", "lifecycle", "usage"] as const;
const TRACKED_SCRIPT_EXTENSIONS = [".ts", ".sh"] as const;

export const M059_S01_CHECK_IDS = [
  "M059-S01-REGISTRY-COVERAGE",
  "M059-S01-REGISTRY-DUPLICATES",
  "M059-S01-REGISTRY-USAGE-TRUTH",
  "M059-S01-SCOPE-CONTRACT",
  "M059-S01-PACKAGE-WIRING",
] as const;

export type M059S01CheckId = (typeof M059_S01_CHECK_IDS)[number];

export type Check = {
  id: M059S01CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M059S01CheckId[];
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

type UsageRef =
  | { kind: "none" }
  | { kind: "package"; name: string }
  | { kind: "workflow"; workflowPath: string; command: string };

export type RegistryRow = {
  path: string;
  purpose: string;
  owner: string;
  lifecycle: string;
  usageRaw: string;
  usageRefs: UsageRef[];
  sourceLine: number;
};

export type ParsedRegistry =
  | { ok: true; rows: RegistryRow[]; scopeDeclarationPresent: boolean }
  | { ok: false; status_code: string; detail: string; scopeDeclarationPresent: boolean };

export async function evaluateM059S01Proof(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const listTrackedScriptFiles = options.listTrackedScriptFiles ?? defaultListTrackedScriptFiles;

  const [packageContent, registryContent, workflowContents, trackedFilesResult] = await Promise.all([
    readOptionalTextFile(readTextFile, PACKAGE_JSON_PATH),
    readOptionalTextFile(readTextFile, REGISTRY_PATH),
    Promise.all(
      WORKFLOW_PATHS.map(async (relativePath) => ({
        relativePath,
        result: await readOptionalTextFile(readTextFile, path.resolve(REPO_ROOT, relativePath)),
      })),
    ),
    readTrackedScriptFiles(listTrackedScriptFiles),
  ]);

  const parsedRegistry = parseRegistryReadResult(registryContent);
  const parsedPackageJson = parsePackageJsonResult(packageContent);

  const checks: Check[] = [
    buildRegistryCoverageCheck(parsedRegistry, trackedFilesResult),
    buildRegistryDuplicatesCheck(parsedRegistry),
    buildRegistryUsageTruthCheck(parsedRegistry, parsedPackageJson, workflowContents),
    buildScopeContractCheck(parsedRegistry, trackedFilesResult),
    buildPackageWiringCheck(parsedPackageJson),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M059_S01_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM059S01Report(report: EvaluationReport): string {
  const lines = [
    "M059 S01 script registry verifier",
    `Generated at: ${report.generatedAt}`,
    `Script registry proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM059S01ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM059S01Proof(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM059S01Report(report));
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

export function parseM059S01Args(args: readonly string[]): { json: boolean } {
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

function buildRegistryCoverageCheck(parsedRegistry: ParsedRegistry, trackedFilesResult: Awaited<ReturnType<typeof readTrackedScriptFiles>>): Check {
  if (!trackedFilesResult.ok) {
    return failCheck(
      "M059-S01-REGISTRY-COVERAGE",
      "tracked_files_unreadable",
      trackedFilesResult.error,
    );
  }

  if (!parsedRegistry.ok) {
    return failCheck("M059-S01-REGISTRY-COVERAGE", parsedRegistry.status_code, parsedRegistry.detail);
  }

  const trackedFiles = trackedFilesResult.files;
  const rowPaths = new Set(parsedRegistry.rows.map((row) => row.path));
  const missingPaths = trackedFiles.filter((filePath) => !rowPaths.has(filePath));
  const extraPaths = parsedRegistry.rows
    .map((row) => row.path)
    .filter((filePath) => !trackedFiles.includes(filePath));

  if (missingPaths.length > 0 || extraPaths.length > 0) {
    const detailParts: string[] = [];
    if (missingPaths.length > 0) {
      detailParts.push(`Missing rows for tracked scripts: ${missingPaths.join(", ")}`);
    }
    if (extraPaths.length > 0) {
      detailParts.push(`Registry rows without tracked files: ${extraPaths.join(", ")}`);
    }
    return failCheck("M059-S01-REGISTRY-COVERAGE", "registry_rows_missing", detailParts.join(". "));
  }

  return passCheck(
    "M059-S01-REGISTRY-COVERAGE",
    "registry_coverage_ok",
    `Registry covers ${trackedFiles.length} tracked scripts with no stale rows.`,
  );
}

function buildRegistryDuplicatesCheck(parsedRegistry: ParsedRegistry): Check {
  if (!parsedRegistry.ok) {
    return failCheck("M059-S01-REGISTRY-DUPLICATES", parsedRegistry.status_code, parsedRegistry.detail);
  }

  const seen = new Map<string, number[]>();
  for (const row of parsedRegistry.rows) {
    const lines = seen.get(row.path) ?? [];
    lines.push(row.sourceLine);
    seen.set(row.path, lines);
  }

  const duplicates = [...seen.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([filePath, lines]) => `${filePath} (lines ${lines.join(", ")})`);

  if (duplicates.length > 0) {
    return failCheck("M059-S01-REGISTRY-DUPLICATES", "duplicate_row", duplicates.join("; "));
  }

  return passCheck(
    "M059-S01-REGISTRY-DUPLICATES",
    "registry_duplicates_ok",
    `Registry paths are unique across ${parsedRegistry.rows.length} rows.`,
  );
}

function buildRegistryUsageTruthCheck(
  parsedRegistry: ParsedRegistry,
  parsedPackageJson: ReturnType<typeof parsePackageJsonResult>,
  workflowContents: Array<{ relativePath: (typeof WORKFLOW_PATHS)[number]; result: ReadResult }>,
): Check {
  for (const workflow of workflowContents) {
    if (!workflow.result.ok) {
      return failCheck(
        "M059-S01-REGISTRY-USAGE-TRUTH",
        "workflow_file_unreadable",
        `${workflow.relativePath}: ${normalizeDetail(workflow.result.error)}`,
      );
    }
  }

  if (!parsedRegistry.ok) {
    if (parsedRegistry.status_code === "registry_missing" || parsedRegistry.status_code === "registry_file_unreadable") {
      return failCheck("M059-S01-REGISTRY-USAGE-TRUTH", parsedRegistry.status_code, parsedRegistry.detail);
    }
    return failCheck("M059-S01-REGISTRY-USAGE-TRUTH", "registry_schema_invalid", parsedRegistry.detail);
  }

  if (!parsedPackageJson.ok) {
    return failCheck("M059-S01-REGISTRY-USAGE-TRUTH", "package_json_invalid", parsedPackageJson.error);
  }

  const scripts = normalizeScriptsMap(parsedPackageJson.value);
  if (!scripts.ok) {
    return failCheck("M059-S01-REGISTRY-USAGE-TRUTH", "package_json_invalid", scripts.error);
  }

  const workflowMap = new Map(
    workflowContents
      .filter((workflow): workflow is { relativePath: (typeof WORKFLOW_PATHS)[number]; result: { ok: true; content: string } } => workflow.result.ok)
      .map((workflow) => [workflow.relativePath, workflow.result.content]),
  );

  const problems: string[] = [];

  for (const row of parsedRegistry.rows) {
    if (row.usageRefs.length === 1 && row.usageRefs[0]?.kind === "none") {
      const actualPackageRefs = Object.entries(scripts.value)
        .filter(([, command]) => command.includes(row.path))
        .map(([name]) => `package:${name}`);
      const actualWorkflowRefs = [...workflowMap.entries()]
        .filter(([, content]) => content.includes(row.path))
        .map(([workflowPath]) => `workflow:${workflowPath}`);
      const actualRefs = [...actualPackageRefs, ...actualWorkflowRefs];
      if (actualRefs.length > 0) {
        problems.push(`${row.path} declares usage none but actual references exist: ${actualRefs.join(", ")}`);
      }
      continue;
    }

    for (const usageRef of row.usageRefs) {
      if (usageRef.kind === "none") {
        problems.push(`${row.path} mixes usage none with real references.`);
        continue;
      }

      if (usageRef.kind === "package") {
        const scriptCommand = scripts.value[usageRef.name];
        if (scriptCommand == null) {
          problems.push(`${row.path} references missing package script ${`package:${usageRef.name}`}.`);
          continue;
        }
        if (!scriptCommand.includes(row.path)) {
          problems.push(`${row.path} package:${usageRef.name} does not reference ${row.path}; found ${scriptCommand}`);
        }
        continue;
      }

      const workflowContent = workflowMap.get(usageRef.workflowPath);
      if (workflowContent == null) {
        problems.push(`${row.path} references unknown workflow ${usageRef.workflowPath}.`);
        continue;
      }
      if (!workflowContent.includes(usageRef.command)) {
        problems.push(`${row.path} workflow reference invalid: ${usageRef.workflowPath} is missing command ${usageRef.command}.`);
        continue;
      }
      if (!workflowCommandReferencesPath(usageRef.command, row.path, scripts.value)) {
        problems.push(`${row.path} workflow reference ${usageRef.workflowPath}#${usageRef.command} does not reference ${row.path}.`);
      }
    }
  }

  if (problems.length > 0) {
    return failCheck("M059-S01-REGISTRY-USAGE-TRUTH", "usage_reference_invalid", problems.join(" "));
  }

  return passCheck(
    "M059-S01-REGISTRY-USAGE-TRUTH",
    "registry_usage_truth_ok",
    `Validated package/workflow references and explicit none semantics for ${parsedRegistry.rows.length} registry rows.`,
  );
}

function buildScopeContractCheck(parsedRegistry: ParsedRegistry, trackedFilesResult: Awaited<ReturnType<typeof readTrackedScriptFiles>>): Check {
  if (!trackedFilesResult.ok) {
    return failCheck("M059-S01-SCOPE-CONTRACT", "tracked_files_unreadable", trackedFilesResult.error);
  }

  const trackedShellFiles = trackedFilesResult.files.filter((filePath) => filePath.endsWith(".sh"));

  if (!parsedRegistry.ok) {
    if (parsedRegistry.status_code === "registry_missing" || parsedRegistry.status_code === "registry_file_unreadable") {
      return failCheck("M059-S01-SCOPE-CONTRACT", parsedRegistry.status_code, parsedRegistry.detail);
    }
    return failCheck("M059-S01-SCOPE-CONTRACT", "registry_schema_invalid", parsedRegistry.detail);
  }

  const rowPaths = new Set(parsedRegistry.rows.map((row) => row.path));
  const missingShellRows = trackedShellFiles.filter((filePath) => !rowPaths.has(filePath));

  if (missingShellRows.length > 0 && !parsedRegistry.scopeDeclarationPresent) {
    return failCheck(
      "M059-S01-SCOPE-CONTRACT",
      "scope_contract_missing",
      `Tracked shell helpers are omitted without an explicit scope declaration: ${missingShellRows.join(", ")}`,
    );
  }

  return passCheck(
    "M059-S01-SCOPE-CONTRACT",
    "scope_contract_ok",
    trackedShellFiles.length === 0
      ? "No tracked shell helpers under scripts/."
      : `Scope declaration present=${parsedRegistry.scopeDeclarationPresent}; tracked shell helpers=${trackedShellFiles.length}.`,
  );
}

function buildPackageWiringCheck(parsedPackageJson: ReturnType<typeof parsePackageJsonResult>): Check {
  if (!parsedPackageJson.ok) {
    return failCheck("M059-S01-PACKAGE-WIRING", "package_json_invalid", parsedPackageJson.error);
  }

  const scripts = normalizeScriptsMap(parsedPackageJson.value);
  if (!scripts.ok) {
    return failCheck("M059-S01-PACKAGE-WIRING", "package_json_invalid", scripts.error);
  }

  const actualScript = scripts.value[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M059-S01-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M059-S01-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M059-S01-PACKAGE-WIRING",
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

export function parseRegistryContent(content: string): ParsedRegistry {
  const lines = content.split(/\r?\n/);
  const scopeDeclarationPresent = /scope:/i.test(content);
  const dividerIndex = lines.findIndex((line) => /^\|\s*---/.test(line.trim()));
  if (dividerIndex <= 0) {
    return {
      ok: false,
      status_code: "registry_schema_invalid",
      detail: "scripts/REGISTRY.md must contain a markdown table with a header and divider row.",
      scopeDeclarationPresent,
    };
  }

  const headerCells = splitTableRow(lines[dividerIndex - 1] ?? "");
  if (headerCells.length !== REGISTRY_HEADER.length || !REGISTRY_HEADER.every((cell, index) => headerCells[index] === cell)) {
    return {
      ok: false,
      status_code: "registry_schema_invalid",
      detail: `Registry header must be exactly: ${REGISTRY_HEADER.join(", ")}`,
      scopeDeclarationPresent,
    };
  }

  const rows: RegistryRow[] = [];
  for (let index = dividerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      if (rows.length > 0 && /^##\s+/.test(trimmed)) {
        break;
      }
      continue;
    }

    const cells = splitTableRow(line);
    if (cells.length !== REGISTRY_HEADER.length) {
      return {
        ok: false,
        status_code: "registry_schema_invalid",
        detail: `Line ${index + 1} must contain ${REGISTRY_HEADER.length} table cells; found ${cells.length}.`,
        scopeDeclarationPresent,
      };
    }

    const [filePath, purpose, owner, lifecycle, usageRaw] = cells;
    if (!filePath || !purpose || !owner || !lifecycle || !usageRaw) {
      return {
        ok: false,
        status_code: "registry_schema_invalid",
        detail: `Line ${index + 1} must provide non-empty path, purpose, owner, lifecycle, and usage values.`,
        scopeDeclarationPresent,
      };
    }

    if (!ALLOWED_LIFECYCLES.includes(lifecycle as (typeof ALLOWED_LIFECYCLES)[number])) {
      return {
        ok: false,
        status_code: "registry_schema_invalid",
        detail: `Line ${index + 1} uses unknown lifecycle ${lifecycle}; allowed values: ${ALLOWED_LIFECYCLES.join(", ")}.`,
        scopeDeclarationPresent,
      };
    }

    const parsedUsage = parseUsageField(usageRaw, index + 1);
    if (!parsedUsage.ok) {
      return {
        ok: false,
        status_code: "registry_schema_invalid",
        detail: parsedUsage.detail,
        scopeDeclarationPresent,
      };
    }

    rows.push({
      path: filePath,
      purpose,
      owner,
      lifecycle,
      usageRaw,
      usageRefs: parsedUsage.usageRefs,
      sourceLine: index + 1,
    });
  }

  if (rows.length === 0) {
    return {
      ok: false,
      status_code: "registry_schema_invalid",
      detail: "Registry table must contain at least one data row.",
      scopeDeclarationPresent,
    };
  }

  return { ok: true, rows, scopeDeclarationPresent };
}

function parseUsageField(usageRaw: string, lineNumber: number): { ok: true; usageRefs: UsageRef[] } | { ok: false; detail: string } {
  const parts = usageRaw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, detail: `Line ${lineNumber} must declare at least one usage value.` };
  }

  if (parts.includes("none") && parts.length > 1) {
    return { ok: false, detail: `Line ${lineNumber} may not mix usage none with package/workflow references.` };
  }

  const usageRefs: UsageRef[] = [];
  for (const part of parts) {
    if (part === "none") {
      usageRefs.push({ kind: "none" });
      continue;
    }

    if (part.startsWith("package:")) {
      const name = part.slice("package:".length).trim();
      if (!name) {
        return { ok: false, detail: `Line ${lineNumber} has invalid package usage syntax: ${part}` };
      }
      usageRefs.push({ kind: "package", name });
      continue;
    }

    if (part.startsWith("workflow:")) {
      const payload = part.slice("workflow:".length);
      const hashIndex = payload.indexOf("#");
      if (hashIndex <= 0 || hashIndex === payload.length - 1) {
        return { ok: false, detail: `Line ${lineNumber} has invalid workflow usage syntax: ${part}` };
      }
      const workflowPath = payload.slice(0, hashIndex).trim();
      const command = payload.slice(hashIndex + 1).trim();
      if (!workflowPath || !command) {
        return { ok: false, detail: `Line ${lineNumber} has invalid workflow usage syntax: ${part}` };
      }
      usageRefs.push({ kind: "workflow", workflowPath, command });
      continue;
    }

    return { ok: false, detail: `Line ${lineNumber} has unknown usage syntax: ${part}` };
  }

  return { ok: true, usageRefs };
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function workflowCommandReferencesPath(
  command: string,
  filePath: string,
  packageScripts: Record<string, string>,
): boolean {
  if (command.includes(filePath)) {
    return true;
  }

  const bunRunMatch = command.match(/\bbun\s+run\s+([a-z0-9:_-]+)/i);
  if (!bunRunMatch) {
    return false;
  }

  const packageScriptName = bunRunMatch[1];
  if (!packageScriptName) {
    return false;
  }

  const packageCommand = packageScripts[packageScriptName];
  return typeof packageCommand === "string" && packageCommand.includes(filePath);
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
      .filter((filePath) => TRACKED_SCRIPT_EXTENSIONS.some((extension) => filePath.endsWith(extension)))
      .sort();
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error };
  }
}

function passCheck(id: M059S01CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M059S01CheckId, status_code: string, detail?: unknown): Check {
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
    const args = parseM059S01Args(process.argv.slice(2));
    const { exitCode } = await buildM059S01ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
