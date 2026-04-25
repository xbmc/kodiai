import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  M060_S01_RUNTIME_TARGETS,
  M060_S01_TYPE_ONLY_EXEMPTIONS,
} from "../src/knowledge/test-coverage-exemptions.ts";

const COMMAND_NAME = "verify:m060:s01" as const;
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m060-s01.ts";
const REGISTRY_PATH = path.resolve(import.meta.dir, "REGISTRY.md");
const PACKAGE_JSON_PATH = path.resolve(import.meta.dir, "../package.json");
const REQUIRED_RUNTIME_TARGETS = [...M060_S01_RUNTIME_TARGETS].sort();
const REQUIRED_TYPE_ONLY_EXEMPTIONS = [...M060_S01_TYPE_ONLY_EXEMPTIONS].sort();
const EXPECTED_REGISTRY_ROWS = [
  "| scripts/verify-m060-s01.test.ts | Regression tests for the M060 S01 direct-test coverage verifier. | M060 | internal | none |",
  "| scripts/verify-m060-s01.ts | Verification CLI for the M060 S01 knowledge direct-test coverage contract. | M060 | active | package:verify:m060:s01 |",
] as const;

export const M060_S01_CHECK_IDS = [
  "M060-S01-PACKAGE-WIRING",
  "M060-S01-REGISTRY-WIRING",
  "M060-S01-RUNTIME-TARGET-MANIFEST",
  "M060-S01-DIRECT-TEST-COVERAGE",
  "M060-S01-TYPE-ONLY-EXEMPTIONS",
] as const;

export type M060S01CheckId = (typeof M060_S01_CHECK_IDS)[number];

export type Check = {
  id: M060S01CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M060S01CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type ManifestShape = {
  runtimeTargets?: readonly string[];
  typeOnlyExemptions?: readonly string[];
};

type EvaluateOptions = {
  generatedAt?: string;
  readTextFile?: (filePath: string) => Promise<string>;
  listTrackedFiles?: () => Promise<string[]>;
  loadManifest?: () => Promise<ManifestShape>;
  fileExists?: (filePath: string) => Promise<boolean>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

export async function evaluateM060S01CoverageContract(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const listTrackedFiles = options.listTrackedFiles ?? defaultListTrackedFiles;
  const loadManifest = options.loadManifest ?? defaultLoadManifest;
  const fileExists = options.fileExists ?? defaultFileExists;

  const trackedFilesState = await readTrackedFileState(listTrackedFiles);
  const manifestState = await readManifestState(loadManifest);

  const packageCheck = await buildPackageCheck(readTextFile);
  const registryCheck = await buildRegistryCheck(readTextFile);
  const runtimeManifestCheck = buildRuntimeTargetManifestCheck(manifestState, trackedFilesState);
  const directTestCoverageCheck = await buildDirectTestCoverageCheck(manifestState, fileExists);
  const typeOnlyExemptionsCheck = await buildTypeOnlyExemptionsCheck({
    manifestState,
    trackedFilesState,
    readTextFile,
    fileExists,
  });

  const checks = [
    packageCheck,
    registryCheck,
    runtimeManifestCheck,
    directTestCoverageCheck,
    typeOnlyExemptionsCheck,
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M060_S01_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM060S01Report(report: EvaluationReport): string {
  const lines = [
    "M060 S01 direct-test coverage verifier",
    `Generated at: ${report.generatedAt}`,
    `Coverage contract: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM060S01ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM060S01CoverageContract(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM060S01Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`${COMMAND_NAME} failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM060S01Args(args: readonly string[]): { json: boolean } {
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

type FileSetResult =
  | { ok: true; entries: string[] }
  | { ok: false; error: unknown };

type ManifestState =
  | { ok: true; runtimeTargets: string[]; typeOnlyExemptions: string[] }
  | { ok: false; error: unknown };

async function buildPackageCheck(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  let packageText: string;
  try {
    packageText = await readTextFile(PACKAGE_JSON_PATH);
  } catch (error) {
    return failCheck("M060-S01-PACKAGE-WIRING", "package_file_unreadable", error);
  }

  let parsed: { scripts?: Record<string, string> };
  try {
    parsed = JSON.parse(packageText) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck("M060-S01-PACKAGE-WIRING", "package_json_invalid", error);
  }

  const actualScript = parsed.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M060-S01-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M060-S01-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M060-S01-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

async function buildRegistryCheck(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  let registryText: string;
  try {
    registryText = await readTextFile(REGISTRY_PATH);
  } catch (error) {
    return failCheck("M060-S01-REGISTRY-WIRING", "registry_file_unreadable", error);
  }

  const missingRows = EXPECTED_REGISTRY_ROWS.filter((row) => !registryText.includes(row));
  if (missingRows.length > 0) {
    return failCheck(
      "M060-S01-REGISTRY-WIRING",
      "registry_rows_missing",
      `scripts/REGISTRY.md must include canonical rows for ${missingRows.map(extractRegistryPathFromRow).join(", ")}`,
    );
  }

  return passCheck(
    "M060-S01-REGISTRY-WIRING",
    "registry_rows_ok",
    `scripts/REGISTRY.md registers ${EXPECTED_REGISTRY_ROWS.map(extractRegistryPathFromRow).join(" and ")}.`,
  );
}

function buildRuntimeTargetManifestCheck(
  manifestState: ManifestState,
  trackedFilesState: FileSetResult,
): Check {
  if (!manifestState.ok) {
    return failCheck("M060-S01-RUNTIME-TARGET-MANIFEST", "manifest_unreadable", manifestState.error);
  }

  const validationError = validatePathList(manifestState.runtimeTargets, "runtime target");
  if (validationError) {
    return failCheck("M060-S01-RUNTIME-TARGET-MANIFEST", validationError.code, validationError.detail);
  }

  const missingRequired = REQUIRED_RUNTIME_TARGETS.filter(
    (target) => !manifestState.runtimeTargets.includes(target),
  );
  if (missingRequired.length > 0) {
    return failCheck(
      "M060-S01-RUNTIME-TARGET-MANIFEST",
      "runtime_targets_incomplete",
      `Manifest is missing required runtime targets: ${missingRequired.join(", ")}`,
    );
  }

  const unexpectedTargets = manifestState.runtimeTargets.filter(
    (target) => !(REQUIRED_RUNTIME_TARGETS as readonly string[]).includes(target),
  );
  if (unexpectedTargets.length > 0) {
    return failCheck(
      "M060-S01-RUNTIME-TARGET-MANIFEST",
      "runtime_targets_unexpected",
      `Manifest includes unexpected S01 runtime targets: ${unexpectedTargets.join(", ")}`,
    );
  }

  if (!trackedFilesState.ok) {
    return failCheck(
      "M060-S01-RUNTIME-TARGET-MANIFEST",
      "tracked_files_unreadable",
      trackedFilesState.error,
    );
  }

  const trackedFileSet = new Set(trackedFilesState.entries);
  const missingTracked = manifestState.runtimeTargets.filter((target) => !trackedFileSet.has(target));
  if (missingTracked.length > 0) {
    return failCheck(
      "M060-S01-RUNTIME-TARGET-MANIFEST",
      "runtime_target_untracked",
      `Manifest runtime targets must be tracked files: ${missingTracked.join(", ")}`,
    );
  }

  return passCheck(
    "M060-S01-RUNTIME-TARGET-MANIFEST",
    "runtime_targets_ok",
    `Manifest lists ${manifestState.runtimeTargets.length} required S01 runtime targets.`,
  );
}

async function buildDirectTestCoverageCheck(
  manifestState: ManifestState,
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<Check> {
  if (!manifestState.ok) {
    return failCheck("M060-S01-DIRECT-TEST-COVERAGE", "manifest_unreadable", manifestState.error);
  }

  const missingDirectTests: string[] = [];

  for (const target of manifestState.runtimeTargets) {
    const testPath = target.replace(/\.ts$/u, ".test.ts");
    if (!(await fileExists(testPath))) {
      missingDirectTests.push(`${target} -> ${testPath}`);
    }
  }

  if (missingDirectTests.length > 0) {
    return failCheck(
      "M060-S01-DIRECT-TEST-COVERAGE",
      "direct_tests_missing",
      `Runtime targets missing direct same-name tests: ${missingDirectTests.join(", ")}`,
    );
  }

  return passCheck(
    "M060-S01-DIRECT-TEST-COVERAGE",
    "direct_tests_ok",
    `All ${manifestState.runtimeTargets.length} runtime targets have direct same-name tests.`,
  );
}

async function buildTypeOnlyExemptionsCheck({
  manifestState,
  trackedFilesState,
  readTextFile,
  fileExists,
}: {
  manifestState: ManifestState;
  trackedFilesState: FileSetResult;
  readTextFile: (filePath: string) => Promise<string>;
  fileExists: (filePath: string) => Promise<boolean>;
}): Promise<Check> {
  if (!manifestState.ok) {
    return failCheck("M060-S01-TYPE-ONLY-EXEMPTIONS", "manifest_unreadable", manifestState.error);
  }

  const validationError = validatePathList(manifestState.typeOnlyExemptions, "type-only exemption");
  if (validationError) {
    return failCheck("M060-S01-TYPE-ONLY-EXEMPTIONS", validationError.code, validationError.detail);
  }

  const missingRequired = REQUIRED_TYPE_ONLY_EXEMPTIONS.filter(
    (exemption) => !manifestState.typeOnlyExemptions.includes(exemption),
  );
  if (missingRequired.length > 0) {
    return failCheck(
      "M060-S01-TYPE-ONLY-EXEMPTIONS",
      "type_only_exemptions_incomplete",
      `Manifest is missing required type-only exemptions: ${missingRequired.join(", ")}`,
    );
  }

  const unexpectedExemptions = manifestState.typeOnlyExemptions.filter(
    (exemption) => !(REQUIRED_TYPE_ONLY_EXEMPTIONS as readonly string[]).includes(exemption),
  );
  if (unexpectedExemptions.length > 0) {
    return failCheck(
      "M060-S01-TYPE-ONLY-EXEMPTIONS",
      "type_only_exemptions_unexpected",
      `Manifest includes unexpected type-only exemptions: ${unexpectedExemptions.join(", ")}`,
    );
  }

  if (!trackedFilesState.ok) {
    return failCheck(
      "M060-S01-TYPE-ONLY-EXEMPTIONS",
      "tracked_files_unreadable",
      trackedFilesState.error,
    );
  }

  const trackedFileSet = new Set(trackedFilesState.entries);
  const missingTracked = manifestState.typeOnlyExemptions.filter((target) => !trackedFileSet.has(target));
  if (missingTracked.length > 0) {
    return failCheck(
      "M060-S01-TYPE-ONLY-EXEMPTIONS",
      "type_only_exemption_untracked",
      `Manifest exemptions must be tracked files: ${missingTracked.join(", ")}`,
    );
  }

  const directTestConflicts: Array<{ target: string; testPath: string }> = [];
  for (const target of manifestState.typeOnlyExemptions) {
    const testPath = target.replace(/\.ts$/u, ".test.ts");
    if (await fileExists(testPath)) {
      directTestConflicts.push({ target, testPath });
    }
  }
  if (directTestConflicts.length > 0) {
    return failCheck(
      "M060-S01-TYPE-ONLY-EXEMPTIONS",
      "type_only_exemption_has_direct_test",
      `Type-only exemptions should not point at files that already have direct tests: ${directTestConflicts.map(({ target, testPath }) => `${target} -> ${testPath}`).join(", ")}`,
    );
  }

  const classificationFailures: string[] = [];
  for (const exemption of manifestState.typeOnlyExemptions) {
    let text: string;
    try {
      text = await readTextFile(path.resolve(import.meta.dir, "..", exemption));
    } catch (error) {
      classificationFailures.push(`${exemption}: unreadable: ${normalizeDetail(error)}`);
      continue;
    }

    const classification = classifyExports(text);
    if (classification.hasRuntime) {
      classificationFailures.push(`${exemption}: runtime exports detected`);
      continue;
    }
    if (!classification.hasTypeOnly) {
      classificationFailures.push(`${exemption}: no explicit type-only exports detected`);
    }
  }

  if (classificationFailures.length > 0) {
    return failCheck(
      "M060-S01-TYPE-ONLY-EXEMPTIONS",
      "type_only_exemption_invalid",
      classificationFailures.join(" | "),
    );
  }

  return passCheck(
    "M060-S01-TYPE-ONLY-EXEMPTIONS",
    "type_only_exemptions_ok",
    `Validated ${manifestState.typeOnlyExemptions.length} explicit type-only exemptions.`,
  );
}

function validatePathList(
  items: string[],
  label: string,
): { code: string; detail: string } | null {
  const duplicates = findDuplicates(items);
  if (duplicates.length > 0) {
    return {
      code: `${label.replace(/[^a-z0-9]+/giu, "_")}_duplicate_entries`,
      detail: `Manifest contains duplicate ${label} entries: ${duplicates.join(", ")}`,
    };
  }

  const outsideScope = items.filter((item) => !item.startsWith("src/knowledge/") || !item.endsWith(".ts"));
  if (outsideScope.length > 0) {
    return {
      code: `${label.replace(/[^a-z0-9]+/giu, "_")}_outside_scope`,
      detail: `${label} entries must stay under src/knowledge/*.ts: ${outsideScope.join(", ")}`,
    };
  }

  return null;
}

function classifyExports(sourceText: string): { hasRuntime: boolean; hasTypeOnly: boolean } {
  const stripped = stripComments(sourceText);

  const hasRuntime =
    /(^|\n)\s*export\s+(?:default\s+)?(?:async\s+)?function\b/u.test(stripped) ||
    /(^|\n)\s*export\s+(?:const|let|var|class|enum)\b/u.test(stripped) ||
    /(^|\n)\s*export\s*\{(?!\s*type\b)[^}]+\}/u.test(stripped) ||
    /(^|\n)\s*export\s*\*\s*from\s*["']/u.test(stripped) ||
    /(^|\n)\s*export\s+default\b/u.test(stripped);

  const hasTypeOnly =
    /(^|\n)\s*export\s+type\b/u.test(stripped) ||
    /(^|\n)\s*export\s+interface\b/u.test(stripped) ||
    /(^|\n)\s*export\s*\{\s*type\b/u.test(stripped);

  return { hasRuntime, hasTypeOnly };
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

function extractRegistryPathFromRow(row: string): string {
  return row.split("|")[1]?.trim() ?? row;
}

function findDuplicates(items: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([item]) => item)
    .sort();
}

function passCheck(id: M060S01CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M060S01CheckId, status_code: string, detail?: unknown): Check {
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
    return { ok: true, entries: (await listTrackedFiles()).sort() };
  } catch (error) {
    return { ok: false, error };
  }
}

async function readManifestState(loadManifest: () => Promise<ManifestShape>): Promise<ManifestState> {
  try {
    const loaded = await loadManifest();
    return {
      ok: true,
      runtimeTargets: [...(loaded.runtimeTargets ?? [])].sort(),
      typeOnlyExemptions: [...(loaded.typeOnlyExemptions ?? [])].sort(),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

async function defaultListTrackedFiles(): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "--", "src/knowledge", "scripts", "package.json"], {
    cwd: path.resolve(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderrText.trim() || `git ls-files exited with code ${exitCode}`);
  }

  return stdoutText
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(path.resolve(import.meta.dir, "..", filePath));
    return true;
  } catch {
    return false;
  }
}

async function defaultLoadManifest(): Promise<ManifestShape> {
  return {
    runtimeTargets: [...M060_S01_RUNTIME_TARGETS],
    typeOnlyExemptions: [...M060_S01_TYPE_ONLY_EXEMPTIONS],
  };
}

if (import.meta.main) {
  try {
    const args = parseM060S01Args(process.argv.slice(2));
    const { exitCode } = await buildM060S01ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
