import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  M060_S01_RUNTIME_TARGETS,
  M060_S01_TYPE_ONLY_EXEMPTIONS,
} from "../src/knowledge/test-coverage-exemptions.ts";

const COMMAND_NAME = "verify:m060:s02" as const;
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m060-s02.ts";
const REGISTRY_PATH = path.resolve(import.meta.dir, "REGISTRY.md");
const PACKAGE_JSON_PATH = path.resolve(import.meta.dir, "../package.json");
const DECISIONS_PATH = path.resolve(import.meta.dir, "../.gsd/DECISIONS.md");
const M027_SUMMARY_PATH = path.resolve(
  import.meta.dir,
  "../.gsd/milestones/M027/M027-SUMMARY.md",
);
const EXPECTED_REGISTRY_ROWS = [
  "| scripts/verify-m060-s02.test.ts | Regression tests for the M060 S02 ownership-boundary verifier. | M060 | internal | none |",
  "| scripts/verify-m060-s02.ts | Verification CLI for the M060 S02 M060-vs-M027 ownership-boundary contract. | M060 | active | package:verify:m060:s02 |",
] as const;
const EXPECTED_DECISION_MARKERS = [
  "| D171 |",
  "Define the boundary by proof class, not file exclusivity",
  "M060 owns direct same-name unit tests plus explicit type-only exemptions",
  "M027 owns persisted-corpus audit, repair/status, and live retriever acceptance proofs",
  "deterministic repo-local verifier",
] as const;
const EXPECTED_SUMMARY_MARKERS = [
  "## M060/M027 ownership boundary",
  "src/knowledge/test-coverage-exemptions.ts",
  "bun run verify:m060:s01",
  "M060 owns direct same-name unit tests",
  "M027 owns persisted-corpus audit, repair/status, and live retriever acceptance proof",
  "File overlap is allowed when the proof class differs.",
  "issue_comments",
  "audited and repairable under M027",
  "outside the live retriever",
  "D171",
  ".gsd/DECISIONS.md",
] as const;

export const M060_S02_CHECK_IDS = [
  "M060-S02-PACKAGE-WIRING",
  "M060-S02-REGISTRY-WIRING",
  "M060-S02-DECISION-RENDER",
  "M060-S02-SUMMARY-BOUNDARY",
] as const;

export type M060S02CheckId = (typeof M060_S02_CHECK_IDS)[number];

export type Check = {
  id: M060S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M060S02CheckId[];
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

export async function evaluateM060S02BoundaryContract(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  const packageCheck = await buildPackageCheck(readTextFile);
  const registryCheck = await buildRegistryCheck(readTextFile);
  const decisionCheck = await buildDecisionRenderCheck(readTextFile);
  const summaryCheck = await buildSummaryBoundaryCheck(readTextFile);

  const checks = [packageCheck, registryCheck, decisionCheck, summaryCheck];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M060_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM060S02Report(report: EvaluationReport): string {
  const lines = [
    "M060 S02 ownership-boundary verifier",
    `Generated at: ${report.generatedAt}`,
    `Boundary contract: ${report.overallPassed ? "PASS" : "FAIL"}`,
    `Manifest anchor: ${M060_S01_RUNTIME_TARGETS.length} runtime targets, ${M060_S01_TYPE_ONLY_EXEMPTIONS.length} type-only exemptions from src/knowledge/test-coverage-exemptions.ts`,
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

export async function buildM060S02ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM060S02BoundaryContract(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM060S02Report(report));
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

export function parseM060S02Args(args: readonly string[]): { json: boolean } {
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

async function buildPackageCheck(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  let packageText: string;
  try {
    packageText = await readTextFile(PACKAGE_JSON_PATH);
  } catch (error) {
    return failCheck("M060-S02-PACKAGE-WIRING", "package_file_unreadable", error);
  }

  let parsed: { scripts?: Record<string, string> };
  try {
    parsed = JSON.parse(packageText) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck("M060-S02-PACKAGE-WIRING", "package_json_invalid", error);
  }

  const actualScript = parsed.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M060-S02-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M060-S02-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M060-S02-PACKAGE-WIRING",
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
    return failCheck("M060-S02-REGISTRY-WIRING", "registry_file_unreadable", error);
  }

  const missingRows = EXPECTED_REGISTRY_ROWS.filter((row) => !registryText.includes(row));
  if (missingRows.length > 0) {
    return failCheck(
      "M060-S02-REGISTRY-WIRING",
      "registry_rows_missing",
      `scripts/REGISTRY.md must include canonical rows for ${missingRows.map(extractRegistryPathFromRow).join(", ")}`,
    );
  }

  return passCheck(
    "M060-S02-REGISTRY-WIRING",
    "registry_rows_ok",
    `scripts/REGISTRY.md registers ${EXPECTED_REGISTRY_ROWS.map(extractRegistryPathFromRow).join(" and ")}.`,
  );
}

async function buildDecisionRenderCheck(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  let decisionsText: string;
  try {
    decisionsText = await readTextFile(DECISIONS_PATH);
  } catch (error) {
    return failCheck(
      "M060-S02-DECISION-RENDER",
      "decision_file_unreadable",
      `${formatPathForDetail(DECISIONS_PATH)}: ${normalizeDetail(error)}`,
    );
  }

  if (!decisionsText.includes("| D171 |")) {
    return failCheck(
      "M060-S02-DECISION-RENDER",
      "decision_render_missing",
      `${formatPathForDetail(DECISIONS_PATH)} must include rendered decision D171.`,
    );
  }

  const missingMarkers = EXPECTED_DECISION_MARKERS.filter((marker) => !decisionsText.includes(marker));
  if (missingMarkers.length > 0) {
    return failCheck(
      "M060-S02-DECISION-RENDER",
      "decision_marker_missing",
      `Rendered D171 is missing canonical markers: ${missingMarkers.join(" | ")}`,
    );
  }

  return passCheck(
    "M060-S02-DECISION-RENDER",
    "decision_render_ok",
    "Rendered D171 preserves the proof-class boundary rationale.",
  );
}

async function buildSummaryBoundaryCheck(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  let summaryText: string;
  try {
    summaryText = await readTextFile(M027_SUMMARY_PATH);
  } catch (error) {
    return failCheck(
      "M060-S02-SUMMARY-BOUNDARY",
      "summary_file_unreadable",
      `${formatPathForDetail(M027_SUMMARY_PATH)}: ${normalizeDetail(error)}`,
    );
  }

  const missingMarkers = EXPECTED_SUMMARY_MARKERS.filter((marker) => !summaryText.includes(marker));
  if (missingMarkers.length > 0) {
    return failCheck(
      "M060-S02-SUMMARY-BOUNDARY",
      "boundary_marker_missing",
      `Canonical ownership summary is missing markers: ${missingMarkers.join(" | ")}`,
    );
  }

  for (const verifier of [
    "bun run verify:m027:s01",
    "bun run verify:m027:s02",
    "bun run verify:m027:s03",
    "bun run verify:m027:s04",
  ]) {
    if (!summaryText.includes(verifier)) {
      return failCheck(
        "M060-S02-SUMMARY-BOUNDARY",
        "boundary_marker_missing",
        `Canonical ownership summary must include corpus-level proof command ${verifier}`,
      );
    }
  }

  return passCheck(
    "M060-S02-SUMMARY-BOUNDARY",
    "boundary_markers_ok",
    `Canonical ownership summary references the shared manifest anchor (${M060_S01_RUNTIME_TARGETS.length} runtime targets / ${M060_S01_TYPE_ONLY_EXEMPTIONS.length} type-only exemptions) and corpus-level proof family without claiming file exclusivity.`,
  );
}

function extractRegistryPathFromRow(row: string): string {
  return row.split("|")[1]?.trim() ?? row;
}

function passCheck(id: M060S02CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M060S02CheckId, status_code: string, detail?: unknown): Check {
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

function formatPathForDetail(filePath: string): string {
  return path.relative(path.resolve(import.meta.dir, ".."), filePath).replace(/\\/gu, "/");
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

if (import.meta.main) {
  try {
    const args = parseM060S02Args(process.argv.slice(2));
    const { exitCode } = await buildM060S02ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`);
    process.exit(1);
  }
}
