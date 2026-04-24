import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateRegressionGateChecks,
  type RegressionGateReport,
} from "./phase-m061-token-regression-gate.ts";

const COMMAND_NAME = "verify:m065:s03" as const;
const RUNBOOK_PATH = path.resolve(import.meta.dir, "../docs/runbooks/m065-rollout-proof.md");
const PACKAGE_JSON_PATH = path.resolve(import.meta.dir, "../package.json");
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m065-s03.ts";
const EXPECTED_RERUN_COMMANDS = [
  "bun run verify:m065 -- --json",
  "bun run verify:m065:s02 -- --json",
  "bun run verify:m065:s03 -- --json",
  "bun run verify:m061:regression",
] as const;
const SUPPORTED_MANUAL_RERUN_PHRASE = "explicit PR-scoped `@kodiai review`";
const UNSUPPORTED_REVIEWER_REQUEST_PATTERN = /\breviewer request\b/i;

export const M065_S03_CHECK_IDS = [
  "M065-S03-FRESH-REGRESSION-EVIDENCE",
  "M065-S03-RUNBOOK-PRESENCE",
  "M065-S03-RERUN-COMMAND-RESOLUTION",
  "M065-S03-PACKAGE-WIRING",
] as const;

export type M065S03CheckId = (typeof M065_S03_CHECK_IDS)[number];

export type M065S03StatusCode =
  | "m065_s03_ok"
  | "m065_s03_invalid_arg"
  | "m065_s03_nested_contract_failed"
  | "m065_s03_verifier_failed";

export type M065S03CheckStatusCode =
  | "fresh_regression_ok"
  | "fresh_regression_failed"
  | "fresh_regression_malformed"
  | "runbook_present"
  | "runbook_missing"
  | "rerun_commands_resolved"
  | "rerun_command_unresolved"
  | "package_wiring_ok"
  | "package_wiring_missing"
  | "package_wiring_incorrect"
  | "package_json_invalid";

export type M065S03Check = {
  id: M065S03CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: M065S03CheckStatusCode;
  detail?: string;
  drill_down: {
    command: string;
    report_key: string;
    nested_status_code?: string;
  };
};

export type M065S03Report = {
  command: typeof COMMAND_NAME;
  generated_at: string;
  success: boolean;
  status_code: M065S03StatusCode;
  check_ids: readonly M065S03CheckId[];
  checks: M065S03Check[];
  nested_reports: {
    regression_gate: RegressionGateReport | null;
  };
  rollout_package: {
    runbook_path: string;
    rerun_commands: string[];
  };
  proof_surface: {
    report_key: "nested_reports.regression_gate";
    rollout_obligation_key: "rollout_obligation";
  };
  rollout_obligation: {
    state: "satisfied" | "failed";
    source: "nested_reports.regression_gate" | null;
    detail: string;
    drill_down_command: string;
  };
  failing_check_id: M065S03CheckId | null;
  issues: string[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  evaluateRegressionGate?: () => RegressionGateReport;
  readTextFile?: (filePath: string) => Promise<string>;
  fileExists?: (filePath: string) => Promise<boolean>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

type CommandReference = {
  command: string;
  target: string;
  resolution: "package-script" | "typescript-file" | "unresolved";
};

export function parseVerifyM065S03Args(args: readonly string[]): { help: boolean; json: boolean } {
  for (const arg of args) {
    if (arg === "--json" || arg === "--help" || arg === "-h") {
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
  };
}

export async function evaluateM065S03(options: EvaluateOptions = {}): Promise<M065S03Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const evaluateRegressionGate = options.evaluateRegressionGate ?? (() => evaluateRegressionGateChecks());
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const fileExists = options.fileExists ?? defaultFileExists;

  const regressionGateRaw = evaluateRegressionGate();
  const regressionGate = isRegressionGateReport(regressionGateRaw) ? regressionGateRaw : null;

  let runbookText = "";
  try {
    runbookText = await readTextFile(RUNBOOK_PATH);
  } catch {
    runbookText = "";
  }

  let packageJsonText = "";
  try {
    packageJsonText = await readTextFile(PACKAGE_JSON_PATH);
  } catch {
    packageJsonText = "";
  }

  const checks: M065S03Check[] = [
    buildFreshRegressionCheck(regressionGate),
    buildRunbookPresenceCheck(await fileExists(RUNBOOK_PATH)),
    await buildRerunCommandResolutionCheck(runbookText, packageJsonText, fileExists),
    buildPackageWiringCheck(packageJsonText),
  ];

  const firstMalformed = checks.find((check) => check.status_code === "fresh_regression_malformed");
  const firstFailed = checks.find((check) => !check.passed && !check.skipped);
  const status_code: M065S03StatusCode = firstMalformed
    ? "m065_s03_nested_contract_failed"
    : firstFailed
      ? "m065_s03_verifier_failed"
      : "m065_s03_ok";
  const success = firstFailed == null;
  const failing_check_id = firstFailed?.id ?? null;
  const issues = checks.filter((check) => !check.passed && !check.skipped).map((check) => check.detail ?? `${check.id} failed.`);

  return {
    command: COMMAND_NAME,
    generated_at: generatedAt,
    success,
    status_code,
    check_ids: M065_S03_CHECK_IDS,
    checks,
    nested_reports: {
      regression_gate: regressionGate,
    },
    rollout_package: {
      runbook_path: normalizeRepoRelativePath(RUNBOOK_PATH),
      rerun_commands: [...EXPECTED_RERUN_COMMANDS],
    },
    proof_surface: {
      report_key: "nested_reports.regression_gate",
      rollout_obligation_key: "rollout_obligation",
    },
    rollout_obligation: buildRolloutObligation(regressionGate),
    failing_check_id,
    issues,
  };
}

export function renderM065S03Report(report: M065S03Report): string {
  const lines = [
    "# M065 S03 — Fresh Regression Proof Verifier",
    "",
    `Status: ${report.status_code}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Overall success: ${String(report.success)}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.status_code} (passed=${String(check.passed)} skipped=${String(check.skipped)})`);
    if (check.detail) lines.push(`  - ${check.detail}`);
    lines.push(`  - Next drill-down: ${check.drill_down.command}`);
    lines.push(`  - Report key: ${check.drill_down.report_key}`);
    if (check.drill_down.nested_status_code) {
      lines.push(`  - Nested status: ${check.drill_down.nested_status_code}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM065S03ProofHarness(options: BuildOptions = {}): Promise<{ exitCode: number; report: M065S03Report }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM065S03(options);

  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM065S03Report(report));

  if (!report.success) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m065:s03 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.success ? 0 : 1,
    report,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m065:s03 -- [--json]",
    "",
    "Wraps authoritative verify:m061:regression evidence and pins operator rerun packaging seams for M065 S03.",
    "",
    "Options:",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  deps?: { stdout?: StdWriter; stderr?: StdWriter },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  try {
    const parsed = parseVerifyM065S03Args(args);
    if (parsed.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const { exitCode } = await buildM065S03ProofHarness({ json: parsed.json, stdout, stderr });
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m065:s03 failed: ${message}\n`);
    return 1;
  }
}

function buildFreshRegressionCheck(report: RegressionGateReport | null): M065S03Check {
  if (report == null) {
    return {
      id: "M065-S03-FRESH-REGRESSION-EVIDENCE",
      passed: false,
      skipped: false,
      status_code: "fresh_regression_malformed",
      detail: "verify:m061:regression did not return the expected overallPassed/checks contract.",
      drill_down: {
        command: "bun run verify:m061:regression",
        report_key: "nested_reports.regression_gate",
      },
    };
  }

  if (!report.overallPassed) {
    const failedIds = report.checks.filter((check) => !check.passed).map((check) => check.id);
    return {
      id: "M065-S03-FRESH-REGRESSION-EVIDENCE",
      passed: false,
      skipped: false,
      status_code: "fresh_regression_failed",
      detail: `verify:m061:regression reported one or more failing regression suites: ${failedIds.join(", ")}.`,
      drill_down: {
        command: "bun run verify:m061:regression",
        report_key: "nested_reports.regression_gate",
        nested_status_code: "regression_gate_failed",
      },
    };
  }

  return {
    id: "M065-S03-FRESH-REGRESSION-EVIDENCE",
    passed: true,
    skipped: false,
    status_code: "fresh_regression_ok",
    detail: "Preserved authoritative verify:m061:regression evidence under nested_reports.regression_gate.",
    drill_down: {
      command: "bun run verify:m061:regression",
      report_key: "nested_reports.regression_gate",
      nested_status_code: "regression_gate_passed",
    },
  };
}

function buildRunbookPresenceCheck(exists: boolean): M065S03Check {
  return exists
    ? {
        id: "M065-S03-RUNBOOK-PRESENCE",
        passed: true,
        skipped: false,
        status_code: "runbook_present",
        detail: "docs/runbooks/m065-rollout-proof.md is present.",
        drill_down: {
          command: "bun run verify:m065:s03 -- --json",
          report_key: "rollout_package.runbook_path",
        },
      }
    : {
        id: "M065-S03-RUNBOOK-PRESENCE",
        passed: false,
        skipped: false,
        status_code: "runbook_missing",
        detail: "docs/runbooks/m065-rollout-proof.md is missing.",
        drill_down: {
          command: "bun run verify:m065:s03 -- --json",
          report_key: "rollout_package.runbook_path",
        },
      };
}

async function buildRerunCommandResolutionCheck(
  runbookText: string,
  packageJsonText: string,
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<M065S03Check> {
  const packageJson = parsePackageJson(packageJsonText);
  const scripts = packageJson?.scripts ?? {};
  const unresolved: string[] = [];

  for (const expectedCommand of EXPECTED_RERUN_COMMANDS) {
    if (!runbookText.includes(expectedCommand)) {
      unresolved.push(expectedCommand);
    }
  }

  if (!runbookText.includes(SUPPORTED_MANUAL_RERUN_PHRASE) || UNSUPPORTED_REVIEWER_REQUEST_PATTERN.test(runbookText)) {
    unresolved.push("unsupported reviewer-request wording");
  }

  const references = await collectCommandReferences(runbookText, scripts, fileExists);
  for (const reference of references) {
    if (reference.resolution === "unresolved") {
      unresolved.push(reference.command);
    }
  }

  if (unresolved.length > 0) {
    const uniqueUnresolved = [...new Set(unresolved)];
    return {
      id: "M065-S03-RERUN-COMMAND-RESOLUTION",
      passed: false,
      skipped: false,
      status_code: "rerun_command_unresolved",
      detail: `Unresolved or missing rerun commands: ${uniqueUnresolved.join(", ")}`,
      drill_down: {
        command: "bun run verify:m065:s03 -- --json",
        report_key: "rollout_package.rerun_commands",
      },
    };
  }

  return {
    id: "M065-S03-RERUN-COMMAND-RESOLUTION",
    passed: true,
    skipped: false,
    status_code: "rerun_commands_resolved",
    detail: "Resolved rerun commands in docs/runbooks/m065-rollout-proof.md.",
    drill_down: {
      command: "bun run verify:m065:s03 -- --json",
      report_key: "rollout_package.rerun_commands",
    },
  };
}

function buildPackageWiringCheck(packageJsonText: string): M065S03Check {
  const packageJson = parsePackageJson(packageJsonText);
  if (packageJson == null) {
    return {
      id: "M065-S03-PACKAGE-WIRING",
      passed: false,
      skipped: false,
      status_code: "package_json_invalid",
      detail: "package.json is unreadable or invalid JSON.",
      drill_down: {
        command: "bun run verify:m065:s03 -- --json",
        report_key: "checks[3]",
      },
    };
  }

  const actual = packageJson.scripts?.[COMMAND_NAME];
  if (actual == null) {
    return {
      id: "M065-S03-PACKAGE-WIRING",
      passed: false,
      skipped: false,
      status_code: "package_wiring_missing",
      detail: `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}.`,
      drill_down: {
        command: "bun run verify:m065:s03 -- --json",
        report_key: "checks[3]",
      },
    };
  }

  if (actual !== EXPECTED_PACKAGE_SCRIPT) {
    return {
      id: "M065-S03-PACKAGE-WIRING",
      passed: false,
      skipped: false,
      status_code: "package_wiring_incorrect",
      detail: `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actual}.`,
      drill_down: {
        command: "bun run verify:m065:s03 -- --json",
        report_key: "checks[3]",
      },
    };
  }

  return {
    id: "M065-S03-PACKAGE-WIRING",
    passed: true,
    skipped: false,
    status_code: "package_wiring_ok",
    detail: "package.json wires verify:m065:s03 to bun scripts/verify-m065-s03.ts.",
    drill_down: {
      command: "bun run verify:m065:s03 -- --json",
      report_key: "checks[3]",
    },
  };
}

function buildRolloutObligation(report: RegressionGateReport | null): M065S03Report["rollout_obligation"] {
  if (report?.overallPassed) {
    return {
      state: "satisfied",
      source: "nested_reports.regression_gate",
      detail: "Fresh non-large regression proof is satisfied by authoritative verify:m061:regression evidence.",
      drill_down_command: "bun run verify:m061:regression",
    };
  }

  if (report == null) {
    return {
      state: "failed",
      source: null,
      detail: "Fresh non-large regression proof is malformed and cannot be trusted.",
      drill_down_command: "bun run verify:m065:s03 -- --json",
    };
  }

  return {
    state: "failed",
    source: "nested_reports.regression_gate",
    detail: "Fresh non-large regression proof is failing and requires rerun packaging.",
    drill_down_command: "bun run verify:m065:s03 -- --json",
  };
}

function parsePackageJson(packageJsonText: string): { scripts?: Record<string, string> } | null {
  if (packageJsonText.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}

async function collectCommandReferences(
  markdown: string,
  scripts: Record<string, string>,
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<CommandReference[]> {
  const references: CommandReference[] = [];
  const seen = new Set<string>();

  for (const command of extractCommands(markdown)) {
    const target = extractResolvableTarget(command);
    if (target == null) {
      continue;
    }

    if (seen.has(command)) {
      continue;
    }
    seen.add(command);

    references.push({
      command,
      target,
      resolution: await resolveCommandTarget(target, scripts, fileExists),
    });
  }

  return references;
}

function extractCommands(markdown: string): string[] {
  const matches = [
    ...markdown.matchAll(/```(?:bash|sh)?\n([\s\S]*?)```/g),
    ...markdown.matchAll(/`([^`\n]+)`/g),
  ];

  const commands = new Set<string>();
  for (const match of matches) {
    const body = match[1]?.trim();
    if (!body) continue;

    for (const line of body.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
      if (line.startsWith("bun ")) {
        commands.add(line);
      }
    }
  }

  return [...commands];
}

function extractResolvableTarget(command: string): string | null {
  let match = command.match(/^bun\s+run\s+([a-z0-9:-]+)(?:\s|$)/i);
  if (match?.[1] && !match[1].includes("/") && !match[1].includes(".")) {
    return match[1];
  }

  match = command.match(/^bun\s+run\s+((?:src|scripts)\/[^\s]+\.ts)(?:\s|$)/i);
  if (match?.[1]) {
    return match[1];
  }

  match = command.match(/^bun\s+((?:src|scripts)\/[^\s]+\.ts)(?:\s|$)/i);
  if (match?.[1]) {
    return match[1];
  }

  return null;
}

async function resolveCommandTarget(
  target: string,
  scripts: Record<string, string>,
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<CommandReference["resolution"]> {
  if (!target.includes("/") && scripts[target] != null) {
    return "package-script";
  }

  if (target.endsWith(".ts")) {
    const absolutePath = path.resolve(REPO_ROOT, target);
    if (await fileExists(absolutePath)) {
      return "typescript-file";
    }
  }

  return "unresolved";
}

function isRegressionGateReport(value: unknown): value is RegressionGateReport {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.overallPassed === "boolean"
    && Array.isArray(record.checks)
    && record.checks.every((check) => {
      if (!check || typeof check !== "object") return false;
      const item = check as Record<string, unknown>;
      return typeof item.id === "string"
        && typeof item.title === "string"
        && typeof item.passed === "boolean"
        && typeof item.details === "string";
    });
}

function normalizeRepoRelativePath(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
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
  const exitCode = await main();
  process.exit(exitCode);
}
