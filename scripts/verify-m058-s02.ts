import { readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m058:s02" as const;
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m058-s02.ts";
const PINNED_BUN_VERSION = "1.3.8" as const;
const EXPECTED_PACKAGE_MANAGER = `bun@${PINNED_BUN_VERSION}`;
const WORKFLOW_VERSION_SNIPPET = `bun-version: ${PINNED_BUN_VERSION}`;
const WORKFLOW_STALE_SNIPPET = "bun-version: latest";
const REQUIRED_DOC_MARKERS = [
  `packageManager\` to \`${EXPECTED_PACKAGE_MANAGER}\``,
  `engines.bun\` to \`${PINNED_BUN_VERSION}\``,
  `bun-version: ${PINNED_BUN_VERSION}`,
  "@types/bun",
  COMMAND_NAME,
] as const;
const STALE_DOC_MARKERS = [
  "does **not** pin a single Bun version",
  "does not pin a single Bun version",
  "bun-version: latest",
  "use a current Bun release that is compatible with the repo",
] as const;

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const CONTRIBUTING_PATH = path.resolve(REPO_ROOT, "CONTRIBUTING.md");
const WORKFLOW_PATHS = [
  ".github/workflows/ci.yml",
  ".github/workflows/nightly-issue-sync.yml",
  ".github/workflows/nightly-reaction-sync.yml",
] as const;

export const M058_S02_CHECK_IDS = [
  "M058-S02-PACKAGE-CONTRACT",
  "M058-S02-PACKAGE-WIRING",
  "M058-S02-WORKFLOW-ALIGNMENT",
  "M058-S02-DOCS-TRUTH",
] as const;

export type M058S02CheckId = (typeof M058_S02_CHECK_IDS)[number];

export type Check = {
  id: M058S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M058S02CheckId[];
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

type PackageJsonShape = {
  packageManager?: unknown;
  engines?: { bun?: unknown } | unknown;
  scripts?: Record<string, string> | unknown;
};

export async function evaluateM058S02Proof(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  const packageContent = await readOptionalTextFile(readTextFile, PACKAGE_JSON_PATH);
  const contributingContent = await readOptionalTextFile(readTextFile, CONTRIBUTING_PATH);
  const workflowContents = await Promise.all(
    WORKFLOW_PATHS.map(async (relativePath) => ({
      relativePath,
      result: await readOptionalTextFile(readTextFile, path.resolve(REPO_ROOT, relativePath)),
    })),
  );

  const parsedPackageJson = packageContent.ok
    ? parsePackageJson(packageContent.content)
    : { ok: false as const, error: packageContent.error };

  const checks: Check[] = [
    buildPackageContractCheck(parsedPackageJson),
    buildPackageWiringCheck(parsedPackageJson),
    buildWorkflowAlignmentCheck(workflowContents),
    contributingContent.ok
      ? buildDocsTruthCheck(contributingContent.content)
      : failCheck(
          "M058-S02-DOCS-TRUTH",
          "contributing_file_unreadable",
          contributingContent.error,
        ),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M058_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM058S02Report(report: EvaluationReport): string {
  const lines = [
    "M058 S02 Bun contract verifier",
    `Generated at: ${report.generatedAt}`,
    `Bun contract proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM058S02ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM058S02Proof(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM058S02Report(report));
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

export function parseM058S02Args(args: readonly string[]): { json: boolean } {
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

function buildPackageContractCheck(
  parsedPackageJson: ReturnType<typeof parsePackageJson>,
): Check {
  if (!parsedPackageJson.ok) {
    return failCheck("M058-S02-PACKAGE-CONTRACT", "package_json_invalid", parsedPackageJson.error);
  }

  const packageJson = parsedPackageJson.value;
  if (typeof packageJson.packageManager !== "string") {
    return failCheck(
      "M058-S02-PACKAGE-CONTRACT",
      "package_manager_missing",
      `package.json must define packageManager=${EXPECTED_PACKAGE_MANAGER}`,
    );
  }

  if (!packageJson.packageManager.startsWith("bun@")) {
    return failCheck(
      "M058-S02-PACKAGE-CONTRACT",
      "package_manager_invalid_shape",
      `packageManager must be an exact bun@<version> string; found ${packageJson.packageManager}`,
    );
  }

  if (typeof packageJson.engines !== "object" || packageJson.engines == null || Array.isArray(packageJson.engines)) {
    return failCheck(
      "M058-S02-PACKAGE-CONTRACT",
      "engines_bun_missing",
      `package.json must define engines.bun=${PINNED_BUN_VERSION}`,
    );
  }

  const engines = packageJson.engines as Record<string, unknown>;
  const bunEngine = engines.bun;
  if (typeof bunEngine !== "string") {
    return failCheck(
      "M058-S02-PACKAGE-CONTRACT",
      "engines_bun_missing",
      `package.json must define engines.bun=${PINNED_BUN_VERSION}`,
    );
  }

  const packageManagerVersion = packageJson.packageManager.slice("bun@".length);
  if (packageManagerVersion !== bunEngine) {
    return failCheck(
      "M058-S02-PACKAGE-CONTRACT",
      "bun_version_mismatch",
      `packageManager declares ${packageJson.packageManager} while engines.bun declares ${bunEngine}`,
    );
  }

  if (packageJson.packageManager !== EXPECTED_PACKAGE_MANAGER || bunEngine !== PINNED_BUN_VERSION) {
    return failCheck(
      "M058-S02-PACKAGE-CONTRACT",
      "bun_version_drift",
      `Expected packageManager=${EXPECTED_PACKAGE_MANAGER} and engines.bun=${PINNED_BUN_VERSION}, found packageManager=${packageJson.packageManager} engines.bun=${bunEngine}`,
    );
  }

  return passCheck(
    "M058-S02-PACKAGE-CONTRACT",
    "package_contract_ok",
    `package.json pins packageManager=${EXPECTED_PACKAGE_MANAGER} and engines.bun=${PINNED_BUN_VERSION}`,
  );
}

function buildPackageWiringCheck(parsedPackageJson: ReturnType<typeof parsePackageJson>): Check {
  if (!parsedPackageJson.ok) {
    return failCheck("M058-S02-PACKAGE-WIRING", "package_json_invalid", parsedPackageJson.error);
  }

  const scripts = parsedPackageJson.value.scripts;
  if (typeof scripts !== "object" || scripts == null || Array.isArray(scripts)) {
    return failCheck(
      "M058-S02-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  const scriptMap = scripts as Record<string, unknown>;
  const actualScript = scriptMap[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M058-S02-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M058-S02-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M058-S02-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function buildWorkflowAlignmentCheck(
  workflowContents: Array<{
    relativePath: (typeof WORKFLOW_PATHS)[number];
    result: Awaited<ReturnType<typeof readOptionalTextFile>>;
  }>,
): Check {
  for (const workflow of workflowContents) {
    if (!workflow.result.ok) {
      return failCheck(
        "M058-S02-WORKFLOW-ALIGNMENT",
        "workflow_file_unreadable",
        `${workflow.relativePath}: ${normalizeDetail(workflow.result.error)}`,
      );
    }
  }

  const stalePaths: string[] = [];
  const missingSetupPaths: string[] = [];

  for (const workflow of workflowContents) {
    if (!workflow.result.ok) {
      continue;
    }

    const content = workflow.result.content;
    if (!content.includes("oven-sh/setup-bun@v2")) {
      missingSetupPaths.push(workflow.relativePath);
      continue;
    }

    if (content.includes(WORKFLOW_STALE_SNIPPET) || !content.includes(WORKFLOW_VERSION_SNIPPET)) {
      stalePaths.push(workflow.relativePath);
    }
  }

  if (missingSetupPaths.length > 0) {
    return failCheck(
      "M058-S02-WORKFLOW-ALIGNMENT",
      "workflow_setup_missing",
      `Missing oven-sh/setup-bun@v2 in: ${missingSetupPaths.join(", ")}`,
    );
  }

  if (stalePaths.length > 0) {
    return failCheck(
      "M058-S02-WORKFLOW-ALIGNMENT",
      "workflow_bun_version_drift",
      `Expected ${WORKFLOW_VERSION_SNIPPET} in all Bun-installing workflows; drift found in: ${stalePaths.join(", ")}`,
    );
  }

  return passCheck(
    "M058-S02-WORKFLOW-ALIGNMENT",
    "workflow_alignment_ok",
    `All Bun-installing workflows pin ${WORKFLOW_VERSION_SNIPPET}`,
  );
}

function buildDocsTruthCheck(contributingContent: string): Check {
  const staleMarkers = STALE_DOC_MARKERS.filter((marker) => contributingContent.includes(marker));
  if (staleMarkers.length > 0) {
    return failCheck(
      "M058-S02-DOCS-TRUTH",
      "docs_truth_stale",
      `CONTRIBUTING.md still contains stale Bun guidance: ${staleMarkers.join(", ")}`,
    );
  }

  const missingMarkers = REQUIRED_DOC_MARKERS.filter(
    (marker) => !contributingContent.includes(marker),
  );
  if (missingMarkers.length > 0) {
    return failCheck(
      "M058-S02-DOCS-TRUTH",
      "docs_truth_missing",
      `CONTRIBUTING.md must document the Bun contract markers: ${missingMarkers.join(", ")}`,
    );
  }

  return passCheck(
    "M058-S02-DOCS-TRUTH",
    "docs_truth_ok",
    "CONTRIBUTING.md documents the pinned Bun contract, workflow alignment, verifier command, and the separate @types/bun caveat.",
  );
}

function parsePackageJson(content: string):
  | { ok: true; value: PackageJsonShape }
  | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(content) as PackageJsonShape };
  } catch (error) {
    return { ok: false, error };
  }
}

function passCheck(id: M058S02CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M058S02CheckId, status_code: string, detail?: unknown): Check {
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

async function readOptionalTextFile(
  readTextFile: (filePath: string) => Promise<string>,
  filePath: string,
): Promise<{ ok: true; content: string } | { ok: false; error: unknown }> {
  try {
    return { ok: true, content: await readTextFile(filePath) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

if (import.meta.main) {
  try {
    const args = parseM058S02Args(process.argv.slice(2));
    const { exitCode } = await buildM058S02ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
