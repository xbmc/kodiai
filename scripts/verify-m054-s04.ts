import { access, readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m054:s04" as const;
const PACKAGE_JSON_PATH = path.resolve(import.meta.dir, "../package.json");
const CANONICAL_SCRIPT_COMMAND = "bun scripts/verify-m054-s04.ts" as const;

const AUDITED_MILESTONES = [
  "M035",
  "M036",
  "M037",
  "M038",
  "M039",
  "M040",
  "M041",
  "M042",
  "M043",
  "M044",
  "M045",
  "M046",
  "M047",
  "M048",
  "M049",
  "M050",
  "M051",
  "M052",
] as const;

export const M054_S04_CHECK_IDS = [
  "M054-S04-COMPLETED-MILESTONE-COVERAGE",
  "M054-S04-PACKAGE-SCRIPT-WIRING",
] as const;

export type M054S04CheckId = (typeof M054_S04_CHECK_IDS)[number];
export type CoverageType = "verifier" | "rationale" | "overclaim" | "missing" | "error";

export type MilestoneAuditResult = {
  milestoneId: (typeof AUDITED_MILESTONES)[number];
  passed: boolean;
  coverageType: CoverageType;
  status_code: string;
  detail?: string;
  evidence?: string[];
};

export type Check = {
  id: M054S04CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
  milestones?: MilestoneAuditResult[];
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M054S04CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  readTextFile?: (filePath: string) => Promise<string>;
  fileExists?: (filePath: string) => Promise<boolean> | boolean;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

type PackageJson = { scripts?: Record<string, string> };

type MilestoneRule = {
  rationaleFiles: string[];
  rationaleMatcher?: (artifactTexts: string[]) => { matched: boolean; evidence?: string[] };
  coverageCommands: string[];
};

const MILESTONE_RULES: Record<(typeof AUDITED_MILESTONES)[number], MilestoneRule> = {
  M035: {
    rationaleFiles: [],
    coverageCommands: ["verify:m054:s02"],
  },
  M036: {
    rationaleFiles: [],
    coverageCommands: ["verify:m054:s02", "verify:m036:s01", "verify:m036:s02", "verify:m036:s03"],
  },
  M037: {
    rationaleFiles: [],
    coverageCommands: ["verify:m054:s02", "verify:m037:s01", "verify:m037:s02", "verify:m037:s03"],
  },
  M038: {
    rationaleFiles: [],
    coverageCommands: ["verify:m054:s02", "verify:m038:s02", "verify:m038:s03"],
  },
  M039: {
    rationaleFiles: [".gsd/milestones/M039/M039-SUMMARY.md"],
    rationaleMatcher: (artifactTexts) => matchAllPhrases(artifactTexts, ["no committed `verify-m039-*` harness survives"]),
    coverageCommands: ["verify:m054:s02"],
  },
  M040: {
    rationaleFiles: [],
    coverageCommands: ["verify:m054:s02", "verify:m040:s02", "verify:m040:s03"],
  },
  M041: {
    rationaleFiles: [],
    coverageCommands: ["verify:m054:s02", "verify:m041:s02", "verify:m041:s03"],
  },
  M042: {
    rationaleFiles: [],
    coverageCommands: ["verify:m054:s02", "verify:m042:s01", "verify:m042:s02", "verify:m042:s03"],
  },
  M043: {
    rationaleFiles: [".gsd/milestones/M043/M043-CONTEXT.md"],
    rationaleMatcher: (artifactTexts) => matchAllPhrases(artifactTexts, ["no `verify:m043:*` package scripts survive"]),
    coverageCommands: ["verify:m054:s02"],
  },
  M044: {
    rationaleFiles: [],
    coverageCommands: ["verify:m044", "verify:m044:s01"],
  },
  M045: {
    rationaleFiles: [],
    coverageCommands: ["verify:m045:s01", "verify:m045:s03"],
  },
  M046: {
    rationaleFiles: [],
    coverageCommands: ["verify:m046", "verify:m046:s01", "verify:m046:s02"],
  },
  M047: {
    rationaleFiles: [],
    coverageCommands: ["verify:m047", "verify:m047:s01", "verify:m047:s02"],
  },
  M048: {
    rationaleFiles: [],
    coverageCommands: ["verify:m054:s03", "verify:m048:s01", "verify:m048:s02", "verify:m048:s03"],
  },
  M049: {
    rationaleFiles: [],
    coverageCommands: ["verify:m054:s03", "verify:m049:s02"],
  },
  M050: {
    rationaleFiles: [".gsd/milestones/M050/M050-CONTEXT.md", ".gsd/milestones/M050/M050-SUMMARY.md"],
    rationaleMatcher: (artifactTexts) =>
      matchAllPhrases(artifactTexts, [
        "intentionally reused `verify:m048:s01`",
        "instead of introducing `verify:m050:*`",
      ]),
    coverageCommands: ["verify:m054:s03"],
  },
  M051: {
    rationaleFiles: [".gsd/milestones/M051/M051-SUMMARY.md"],
    rationaleMatcher: (artifactTexts) =>
      matchAnyPhrase(artifactTexts, [
        "closed the remaining m048 operator/verifier truthfulness debt",
        "bun run verify:m048:s01",
        "bun run verify:m048:s03",
      ]),
    coverageCommands: ["verify:m054:s03"],
  },
  M052: {
    rationaleFiles: [".gsd/milestones/M052/M052-SUMMARY.md", ".gsd/milestones/M052/M052-VALIDATION.md"],
    coverageCommands: ["verify:m054:s03"],
  },
};

export async function evaluateM054S04VerifierCoverage(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const fileExists = options.fileExists ?? defaultFileExists;

  const packageScriptCheck = await buildPackageScriptCheck(readTextFile);
  const packageJson = await readPackageJson(readTextFile);
  const milestoneCoverageCheck = await buildMilestoneCoverageCheck({
    readTextFile,
    fileExists,
    packageJson,
  });

  const checks = [milestoneCoverageCheck, packageScriptCheck];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M054_S04_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM054S04Report(report: EvaluationReport): string {
  const lines = [
    "M054 S04 completed-milestone verifier/rationale audit",
    `Generated at: ${report.generatedAt}`,
    `Verifier/rationale audit: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
    );

    if (check.milestones != null) {
      for (const milestone of check.milestones) {
        const milestoneVerdict = milestone.passed ? "PASS" : "FAIL";
        lines.push(
          `  - ${milestone.milestoneId} ${milestoneVerdict} coverage=${milestone.coverageType} status_code=${milestone.status_code}${milestone.detail ? ` ${milestone.detail}` : ""}`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM054S04ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM054S04VerifierCoverage(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM054S04Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .flatMap((check) => {
        const topLevel = `${check.id}:${check.status_code}`;
        const milestoneCodes =
          check.milestones
            ?.filter((milestone) => !milestone.passed)
            .map((milestone) => `${milestone.milestoneId}:${milestone.status_code}`) ?? [];
        return [topLevel, ...milestoneCodes];
      })
      .join(", ");
    stderr.write(`verify:m054:s04 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM054S04Args(args: readonly string[]): { json: boolean } {
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

type MilestoneCoverageCheckOptions = {
  readTextFile: (filePath: string) => Promise<string>;
  fileExists: (filePath: string) => Promise<boolean> | boolean;
  packageJson: PackageJson;
};

async function buildMilestoneCoverageCheck(
  options: MilestoneCoverageCheckOptions,
): Promise<Check> {
  const results: MilestoneAuditResult[] = [];

  for (const milestoneId of AUDITED_MILESTONES) {
    results.push(await evaluateMilestoneCoverage(milestoneId, options));
  }

  const failures = results.filter((result) => !result.passed);
  if (failures.length > 0) {
    return {
      id: "M054-S04-COMPLETED-MILESTONE-COVERAGE",
      passed: false,
      skipped: false,
      status_code: "completed_milestone_coverage_drift",
      detail: failures
        .map((failure) => `${failure.milestoneId}:${failure.status_code}`)
        .join(", "),
      milestones: results,
    };
  }

  return {
    id: "M054-S04-COMPLETED-MILESTONE-COVERAGE",
    passed: true,
    skipped: false,
    status_code: "completed_milestone_coverage_ok",
    detail: `Verified ${AUDITED_MILESTONES.join(", ")} for verifier or rationale coverage without stale overclaims.`,
    milestones: results,
  };
}

async function evaluateMilestoneCoverage(
  milestoneId: (typeof AUDITED_MILESTONES)[number],
  options: MilestoneCoverageCheckOptions,
): Promise<MilestoneAuditResult> {
  const rule = MILESTONE_RULES[milestoneId];
  const artifactTexts: string[] = [];

  for (const artifactPath of rule.rationaleFiles) {
    try {
      artifactTexts.push(await options.readTextFile(path.resolve(import.meta.dir, `../${artifactPath}`)));
    } catch (error) {
      return {
        milestoneId,
        passed: false,
        coverageType: "error",
        status_code: "artifact_unreadable",
        detail: `${artifactPath}: ${normalizeDetail(error)}`,
      };
    }
  }

  if (rule.rationaleMatcher != null) {
    const rationale = rule.rationaleMatcher(artifactTexts);
    if (rationale.matched) {
      return {
        milestoneId,
        passed: true,
        coverageType: "rationale",
        status_code: "explicit_rationale_present",
        detail: `Committed artifacts explicitly explain verifier absence or reuse for ${milestoneId}.`,
        evidence: rationale.evidence,
      };
    }
  }

  const claimedSurfaces = extractClaimedVerifierSurfaces(artifactTexts, milestoneId);
  if (claimedSurfaces.length > 0) {
    const missingClaims = await findMissingClaims(claimedSurfaces, options.packageJson, options.fileExists);
    if (missingClaims.length > 0) {
      return {
        milestoneId,
        passed: false,
        coverageType: "overclaim",
        status_code: "claimed_verifier_missing",
        detail: `Missing claimed verifier surfaces: ${missingClaims.join(", ")}`,
        evidence: claimedSurfaces,
      };
    }
  }

  const coverage = await findPresentCoverage(rule.coverageCommands, options.packageJson, options.fileExists);
  if (coverage.length > 0) {
    return {
      milestoneId,
      passed: true,
      coverageType: "verifier",
      status_code: "repo_verifier_coverage_present",
      detail: `Repo exposes verifier coverage via ${coverage.join(", ")}.`,
      evidence: coverage,
    };
  }

  return {
    milestoneId,
    passed: false,
    coverageType: "missing",
    status_code: "verifier_or_rationale_missing",
    detail: `No explicit rationale and no repo verifier coverage found for ${milestoneId}.`,
  };
}

async function findMissingClaims(
  claims: string[],
  packageJson: PackageJson,
  fileExists: (filePath: string) => Promise<boolean> | boolean,
): Promise<string[]> {
  const missing: string[] = [];

  for (const claim of claims) {
    if (claim.startsWith("verify:")) {
      const command = packageJson.scripts?.[claim];
      if (command == null) {
        missing.push(claim);
        continue;
      }
      const scriptPath = getScriptPathFromCommand(command);
      if (scriptPath == null || !(await fileExists(path.resolve(import.meta.dir, `../${scriptPath}`)))) {
        missing.push(`${claim} -> ${command}`);
      }
      continue;
    }

    if (!(await fileExists(path.resolve(import.meta.dir, `../${claim}`)))) {
      missing.push(claim);
    }
  }

  return missing;
}

async function findPresentCoverage(
  commands: string[],
  packageJson: PackageJson,
  fileExists: (filePath: string) => Promise<boolean> | boolean,
): Promise<string[]> {
  const coverage: string[] = [];

  for (const commandName of commands) {
    const command = packageJson.scripts?.[commandName];
    if (command == null) {
      continue;
    }

    const scriptPath = getScriptPathFromCommand(command);
    if (scriptPath == null) {
      continue;
    }

    if (await fileExists(path.resolve(import.meta.dir, `../${scriptPath}`))) {
      coverage.push(commandName);
    }
  }

  return coverage;
}

function extractClaimedVerifierSurfaces(artifactTexts: string[], milestoneId: string): string[] {
  const claims = new Set<string>();
  const commandRegex = /verify:[a-z0-9]+(?::[a-z0-9]+)*/giu;
  const scriptRegex = /scripts\/verify-[a-z0-9-]+\.ts/giu;
  const milestonePrefix = `verify:${milestoneId.toLowerCase()}`;

  for (const text of artifactTexts) {
    for (const match of text.matchAll(commandRegex)) {
      const value = match[0].toLowerCase();
      const start = match.index ?? 0;
      const trailingText = text.slice(start + value.length, start + value.length + 20).toLowerCase();
      if (
        trailingText.startsWith(":*") ||
        trailingText.startsWith("*") ||
        trailingText.startsWith(" family") ||
        trailingText.startsWith("` family") ||
        trailingText.startsWith(" script family")
      ) {
        continue;
      }
      if (value.startsWith(milestonePrefix)) {
        claims.add(value);
      }
    }

    for (const match of text.matchAll(scriptRegex)) {
      const value = match[0].toLowerCase();
      if (value.includes(`verify-${milestoneId.toLowerCase()}`)) {
        claims.add(value);
      }
    }
  }

  return [...claims].sort((left, right) => left.localeCompare(right));
}

function matchAllPhrases(
  artifactTexts: string[],
  phrases: string[],
): { matched: boolean; evidence?: string[] } {
  const loweredTexts = artifactTexts.map((text) => text.toLowerCase());
  const matched = phrases.every((phrase) =>
    loweredTexts.some((text) => text.includes(phrase.toLowerCase())),
  );
  return {
    matched,
    evidence: matched ? phrases : undefined,
  };
}

function matchAnyPhrase(
  artifactTexts: string[],
  phrases: string[],
): { matched: boolean; evidence?: string[] } {
  const loweredTexts = artifactTexts.map((text) => text.toLowerCase());
  const evidence = phrases.filter((phrase) =>
    loweredTexts.some((text) => text.includes(phrase.toLowerCase())),
  );
  return {
    matched: evidence.length > 0,
    evidence: evidence.length > 0 ? evidence : undefined,
  };
}

async function buildPackageScriptCheck(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  let packageJsonText: string;
  try {
    packageJsonText = await readTextFile(PACKAGE_JSON_PATH);
  } catch (error) {
    return failCheck(
      "M054-S04-PACKAGE-SCRIPT-WIRING",
      "package_json_unreadable",
      error,
    );
  }

  let packageJson: PackageJson;
  try {
    packageJson = JSON.parse(packageJsonText) as PackageJson;
  } catch (error) {
    return failCheck(
      "M054-S04-PACKAGE-SCRIPT-WIRING",
      "package_json_malformed",
      error,
    );
  }

  const actualCommand = packageJson.scripts?.[COMMAND_NAME];
  if (actualCommand == null) {
    return failCheck(
      "M054-S04-PACKAGE-SCRIPT-WIRING",
      "package_script_wiring_missing",
      `package.json is missing scripts.${COMMAND_NAME}`,
    );
  }

  if (actualCommand !== CANONICAL_SCRIPT_COMMAND) {
    return failCheck(
      "M054-S04-PACKAGE-SCRIPT-WIRING",
      "package_script_wiring_mismatch",
      `Expected ${CANONICAL_SCRIPT_COMMAND} but found ${actualCommand}`,
    );
  }

  return passCheck(
    "M054-S04-PACKAGE-SCRIPT-WIRING",
    "package_script_wiring_ok",
    `package.json scripts.${COMMAND_NAME} matches the canonical command.`,
  );
}

async function readPackageJson(
  readTextFile: (filePath: string) => Promise<string>,
): Promise<PackageJson> {
  try {
    return JSON.parse(await readTextFile(PACKAGE_JSON_PATH)) as PackageJson;
  } catch {
    return {};
  }
}

function getScriptPathFromCommand(command: string): string | null {
  const match = command.match(/^bun\s+(.+)$/u);
  if (match == null) {
    return null;
  }

  const candidate = match[1]?.trim();
  if (candidate == null || !candidate.startsWith("scripts/")) {
    return null;
  }

  return candidate;
}

function passCheck(id: M054S04CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M054S04CheckId, status_code: string, detail?: unknown): Check {
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

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  try {
    const args = parseM054S04Args(process.argv.slice(2));
    const { exitCode } = await buildM054S04ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m054:s04 failed: ${message}\n`);
    process.exit(1);
  }
}
