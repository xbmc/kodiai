import { readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m055:s02" as const;
const LICENSE_PATH = path.resolve(import.meta.dir, "../LICENSE");
const CONTRIBUTING_PATH = path.resolve(import.meta.dir, "../CONTRIBUTING.md");
const PACKAGE_JSON_PATH = path.resolve(import.meta.dir, "../package.json");
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m055-s02.ts";

const REQUIRED_LICENSE_MARKERS = [
  "Proprietary.",
  "All rights reserved.",
  "No license or other right to use, copy, modify, merge, publish, distribute, sublicense, sell, or create derivative works from this repository is granted except through prior written permission from the repository owner.",
  "Submission of a contribution does not, by itself, transfer ownership of your underlying copyright except to the extent required by separate written agreement.",
] as const;

const REQUIRED_CONTRIBUTING_PLANNING_MARKERS = [
  ".gsd/",
  "M###",
  "S##",
  "T##",
  "ROADMAP",
  "PLAN",
  "SUMMARY",
  ".gsd/DECISIONS.md",
  ".gsd/REQUIREMENTS.md",
] as const;

const REQUIRED_CONTRIBUTING_MIGRATION_MARKERS = [
  "src/db/migrate.ts",
  "bun run src/db/migrate.ts down <version>",
  ".down.sql",
  "explicit exception",
  "Do **not** assume every historical migration already meets the paired-file rule.",
] as const;

const REQUIRED_CONTRIBUTING_VERIFICATION_MARKERS = [
  "bun test",
  "bunx tsc --noEmit",
  "verify:*",
  "verify:m053",
  "verify:m054:s01",
  "verify:m055:s01",
  ".github/workflows/ci.yml",
] as const;

export const M055_S02_CHECK_IDS = [
  "M055-S02-LICENSE-CONTRACT",
  "M055-S02-CONTRIBUTING-PLANNING",
  "M055-S02-CONTRIBUTING-MIGRATIONS",
  "M055-S02-CONTRIBUTING-VERIFICATION",
  "M055-S02-PACKAGE-WIRING",
] as const;

export type M055S02CheckId = (typeof M055_S02_CHECK_IDS)[number];

export type Check = {
  id: M055S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M055S02CheckId[];
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

export async function evaluateM055S02DocsTruth(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  let licenseContent: string | null = null;
  let licenseReadError: unknown = null;
  try {
    licenseContent = await readTextFile(LICENSE_PATH);
  } catch (error) {
    licenseReadError = error;
  }

  let contributingContent: string | null = null;
  let contributingReadError: unknown = null;
  try {
    contributingContent = await readTextFile(CONTRIBUTING_PATH);
  } catch (error) {
    contributingReadError = error;
  }

  let packageJsonContent: string | null = null;
  let packageJsonReadError: unknown = null;
  try {
    packageJsonContent = await readTextFile(PACKAGE_JSON_PATH);
  } catch (error) {
    packageJsonReadError = error;
  }

  const checks: Check[] = [
    licenseContent == null
      ? failCheck(
          "M055-S02-LICENSE-CONTRACT",
          "license_file_unreadable",
          licenseReadError,
        )
      : buildLicenseContractCheck(licenseContent),
    contributingContent == null
      ? failCheck(
          "M055-S02-CONTRIBUTING-PLANNING",
          "contributing_file_unreadable",
          contributingReadError,
        )
      : buildContributingPlanningCheck(contributingContent),
    contributingContent == null
      ? failCheck(
          "M055-S02-CONTRIBUTING-MIGRATIONS",
          "contributing_file_unreadable",
          contributingReadError,
        )
      : buildContributingMigrationCheck(contributingContent),
    contributingContent == null
      ? failCheck(
          "M055-S02-CONTRIBUTING-VERIFICATION",
          "contributing_file_unreadable",
          contributingReadError,
        )
      : buildContributingVerificationCheck(contributingContent),
    packageJsonContent == null
      ? failCheck(
          "M055-S02-PACKAGE-WIRING",
          "package_file_unreadable",
          packageJsonReadError,
        )
      : buildPackageWiringCheck(packageJsonContent),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M055_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM055S02Report(report: EvaluationReport): string {
  const lines = [
    "M055 S02 docs contract verifier",
    `Generated at: ${report.generatedAt}`,
    `Docs contract proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
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

export async function buildM055S02ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM055S02DocsTruth(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM055S02Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m055:s02 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM055S02Args(args: readonly string[]): { json: boolean } {
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

function buildLicenseContractCheck(licenseContent: string): Check {
  const missingMarkers = REQUIRED_LICENSE_MARKERS.filter(
    (marker) => !licenseContent.includes(marker),
  );

  if (missingMarkers.length > 0) {
    return failCheck(
      "M055-S02-LICENSE-CONTRACT",
      "license_contract_missing",
      `LICENSE is missing contract markers: ${missingMarkers.join(", ")}`,
    );
  }

  return passCheck(
    "M055-S02-LICENSE-CONTRACT",
    "license_contract_ok",
    "LICENSE preserves the proprietary, all-rights-reserved, no-grant, and contribution-use contract.",
  );
}

function buildContributingPlanningCheck(contributingContent: string): Check {
  const missingMarkers = REQUIRED_CONTRIBUTING_PLANNING_MARKERS.filter(
    (marker) => !contributingContent.includes(marker),
  );

  if (missingMarkers.length > 0) {
    return failCheck(
      "M055-S02-CONTRIBUTING-PLANNING",
      "contributing_planning_markers_missing",
      `CONTRIBUTING.md is missing planning markers: ${missingMarkers.join(", ")}`,
    );
  }

  return passCheck(
    "M055-S02-CONTRIBUTING-PLANNING",
    "contributing_planning_markers_ok",
    "CONTRIBUTING.md documents the checked-in .gsd artifact model and naming/layout expectations.",
  );
}

function buildContributingMigrationCheck(contributingContent: string): Check {
  const missingMarkers = REQUIRED_CONTRIBUTING_MIGRATION_MARKERS.filter(
    (marker) => !contributingContent.includes(marker),
  );

  if (missingMarkers.length > 0) {
    return failCheck(
      "M055-S02-CONTRIBUTING-MIGRATIONS",
      "contributing_migration_markers_missing",
      `CONTRIBUTING.md is missing migration markers: ${missingMarkers.join(", ")}`,
    );
  }

  return passCheck(
    "M055-S02-CONTRIBUTING-MIGRATIONS",
    "contributing_migration_markers_ok",
    "CONTRIBUTING.md documents src/db/migrate.ts rollback behavior, .down.sql expectations, and historical-drift caveats.",
  );
}

function buildContributingVerificationCheck(contributingContent: string): Check {
  const missingMarkers = REQUIRED_CONTRIBUTING_VERIFICATION_MARKERS.filter(
    (marker) => !contributingContent.includes(marker),
  );

  if (missingMarkers.length > 0) {
    return failCheck(
      "M055-S02-CONTRIBUTING-VERIFICATION",
      "contributing_verification_markers_missing",
      `CONTRIBUTING.md is missing verification markers: ${missingMarkers.join(", ")}`,
    );
  }

  return passCheck(
    "M055-S02-CONTRIBUTING-VERIFICATION",
    "contributing_verification_markers_ok",
    "CONTRIBUTING.md documents baseline verification, targeted verify:* commands, and CI-backed proof expectations.",
  );
}

function buildPackageWiringCheck(packageJsonContent: string): Check {
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as {
      scripts?: Record<string, string>;
    };
  } catch (error) {
    return failCheck(
      "M055-S02-PACKAGE-WIRING",
      "package_json_invalid",
      error,
    );
  }

  const actualScript = packageJson.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M055-S02-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M055-S02-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M055-S02-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function passCheck(id: M055S02CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M055S02CheckId, status_code: string, detail?: unknown): Check {
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
    const args = parseM055S02Args(process.argv.slice(2));
    const { exitCode } = await buildM055S02ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m055:s02 failed: ${message}\n`);
    process.exit(1);
  }
}
