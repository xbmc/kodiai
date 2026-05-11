export const COMMAND_NAME = "verify:m069:s02" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m069-s02.ts" as const;

export const M069_S02_CHECK_IDS = [
  "M069-S02-PACKAGE-WIRING",
  "M069-S02-HANDLER-INJECTION-SEAM",
  "M069-S02-HANDLER-ORDERING",
  "M069-S02-READ-ONLY-SUBFLOW-BOUNDARY",
  "M069-S02-FAIL-OPEN-STATUSES",
  "M069-S02-PUBLICATION-SAFETY",
] as const;

export type M069S02CheckId = (typeof M069_S02_CHECK_IDS)[number];
export type M069S02StatusCode = "m069_s02_ok" | "m069_s02_contract_failed" | "m069_s02_invalid_arg";
export type M069S02CheckStatus = "pass" | "fail";
export type M069S02CheckStatusCode =
  | "package_wiring_ok"
  | "package_wiring_failed"
  | "handler_injection_seam_ok"
  | "handler_injection_seam_failed"
  | "handler_ordering_ok"
  | "handler_ordering_failed"
  | "read_only_subflow_boundary_ok"
  | "read_only_subflow_boundary_failed"
  | "fail_open_statuses_ok"
  | "fail_open_statuses_failed"
  | "publication_safety_ok"
  | "publication_safety_failed";

export type M069S02Check = {
  readonly id: M069S02CheckId;
  readonly passed: boolean;
  readonly status: M069S02CheckStatus;
  readonly status_code: M069S02CheckStatusCode;
  readonly detail: string;
};

export type M069S02Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly success: boolean;
  readonly status_code: M069S02StatusCode;
  readonly check_ids: readonly M069S02CheckId[];
  readonly checks: readonly M069S02Check[];
  readonly failing_check_id: M069S02CheckId | null;
  readonly summary: {
    readonly packageScriptWired: boolean;
    readonly handlerInjectionPresent: boolean;
    readonly sameJobInjectionDefaultPresent: boolean;
    readonly handlerOrderingValid: boolean;
    readonly readOnlyRunnerInputPresent: boolean;
    readonly readOnlyFlagCount: number;
    readonly failOpenStatusCount: number;
    readonly publicationForbiddenMatchCount: number;
    readonly targetedTestCommandCount: number;
    readonly readsPlanningOrSecrets: false;
    readonly liveServiceRequired: false;
  };
  readonly wiring: {
    readonly handlerImportsSubflow: boolean;
    readonly handlerDependencyInjectionSeam: boolean;
    readonly handlerInvokesSubflow: boolean;
    readonly handlerLogsBoundedFields: boolean;
    readonly handlerFailOpenCatch: boolean;
    readonly invocationAfterChangedFiles: boolean;
    readonly invocationBeforeReviewExecution: boolean;
  };
  readonly readOnlyBoundary: {
    readonly helperPresent: boolean;
    readonly runnerInputTypePresent: boolean;
    readonly runnerInputReadOnlyTrue: boolean;
    readonly runnerReceivesDiffContext: boolean;
    readonly runnerInputHasOctokitDependency: boolean;
    readonly forbiddenPublicationMatches: readonly string[];
    readonly shadowOnlyFieldsPresent: boolean;
    readonly publishesFindingsFalsePresent: boolean;
  };
  readonly failOpen: {
    readonly statuses: readonly string[];
    readonly timeoutReasonPresent: boolean;
    readonly errorReasonPresent: boolean;
    readonly malformedReasonPresent: boolean;
    readonly notTriggeredSkipPresent: boolean;
    readonly handlerCatchContinues: boolean;
  };
  readonly targetedTests: readonly string[];
  readonly issues: readonly string[];
};

export type M069S02Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type EvaluateM069S02Options = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly readHandlerText?: () => Promise<string>;
  readonly readSubflowText?: () => Promise<string>;
};

type SourcePositions = {
  readonly changedFiles: number;
  readonly subflowInvocation: number;
  readonly reviewExecution: number;
};

const HANDLER_PATH = "src/handlers/review.ts";
const SUBFLOW_PATH = "src/specialists/shadow-specialist-subflow.ts";

const TARGETED_TEST_COMMANDS = [
  "bun test src/specialists/shadow-specialist-subflow.test.ts",
  "bun test src/handlers/review.test.ts",
  "bun test scripts/verify-m069-s02.test.ts",
] as const;

const FORBIDDEN_PUBLICATION_PATTERNS = [
  "createComment",
  "createReview",
  "issues.createComment",
  "pulls.createReview",
  "updateComment",
  "deleteReviewComment",
  "Octokit",
  "octokit",
  "commentBody",
  "inlineComment",
  "approvalCallback",
  "approveCallback",
  "publishCallback",
  "publicationCallback",
] as const;

export function parseM069S02Args(args: readonly string[]): M069S02Args {
  let json = false;
  let help = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { json, help };
}

export async function evaluateM069S02Contract(options: EvaluateM069S02Options = {}): Promise<M069S02Report> {
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const readHandlerText = options.readHandlerText ?? (() => Bun.file(HANDLER_PATH).text());
  const readSubflowText = options.readSubflowText ?? (() => Bun.file(SUBFLOW_PATH).text());

  const [packageJsonText, handlerText, subflowText] = await Promise.all([
    readPackageJsonText(),
    readHandlerText(),
    readSubflowText(),
  ]);

  const packageCheck = buildPackageWiringCheck(packageJsonText);
  const handlerChecks = buildHandlerChecks(handlerText);
  const readOnlyCheck = buildReadOnlyBoundaryCheck(subflowText);
  const failOpenCheck = buildFailOpenStatusesCheck(handlerText, subflowText);
  const publicationCheck = buildPublicationSafetyCheck(subflowText);
  const checks = [packageCheck, ...handlerChecks, readOnlyCheck, failOpenCheck, publicationCheck];
  const issues = checks.filter((check) => !check.passed).map((check) => check.detail);
  const failingCheck = checks.find((check) => !check.passed) ?? null;
  const packageScriptWired = packageCheck.passed;
  const handlerSummary = summarizeHandlerWiring(handlerText);
  const readOnlySummary = summarizeReadOnlyBoundary(subflowText);
  const failOpenSummary = summarizeFailOpen(handlerText, subflowText);

  return {
    command: COMMAND_NAME,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m069_s02_ok" : "m069_s02_contract_failed",
    check_ids: [...M069_S02_CHECK_IDS],
    checks,
    failing_check_id: failingCheck?.id ?? null,
    summary: {
      packageScriptWired,
      handlerInjectionPresent: handlerSummary.handlerImportsSubflow && handlerSummary.handlerDependencyInjectionSeam && handlerSummary.handlerInvokesSubflow,
      sameJobInjectionDefaultPresent: handlerText.includes("shadowSpecialistSubflow = runShadowSpecialistSubflow"),
      handlerOrderingValid: handlerSummary.invocationAfterChangedFiles && handlerSummary.invocationBeforeReviewExecution,
      readOnlyRunnerInputPresent: readOnlySummary.runnerInputTypePresent,
      readOnlyFlagCount: countOccurrences(subflowText, "readOnly: true"),
      failOpenStatusCount: failOpenSummary.statuses.length,
      publicationForbiddenMatchCount: readOnlySummary.forbiddenPublicationMatches.length,
      targetedTestCommandCount: TARGETED_TEST_COMMANDS.length,
      readsPlanningOrSecrets: false,
      liveServiceRequired: false,
    },
    wiring: handlerSummary,
    readOnlyBoundary: readOnlySummary,
    failOpen: failOpenSummary,
    targetedTests: [...TARGETED_TEST_COMMANDS],
    issues,
  };
}

function buildPackageWiringCheck(packageJsonText: string): M069S02Check {
  const failures: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    failures.push("package.json must be parseable JSON.");
  }

  const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
  if (scripts[COMMAND_NAME] !== EXPECTED_PACKAGE_SCRIPT) {
    failures.push(`package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`);
  }

  return makeCheck({
    id: "M069-S02-PACKAGE-WIRING",
    okCode: "package_wiring_ok",
    failCode: "package_wiring_failed",
    okDetail: "package.json exposes verify:m069:s02 as a local no-live-service verifier.",
    failures,
  });
}

function buildHandlerChecks(handlerText: string): M069S02Check[] {
  const wiring = summarizeHandlerWiring(handlerText);
  const injectionFailures: string[] = [];
  if (!wiring.handlerImportsSubflow) injectionFailures.push("review handler must import runShadowSpecialistSubflow and subflow types.");
  if (!wiring.handlerDependencyInjectionSeam) injectionFailures.push("review handler must expose shadowSpecialistSubflow dependency injection with default runner.");
  if (!wiring.handlerInvokesSubflow) injectionFailures.push("review handler must invoke shadowSpecialistSubflow with changed files and diff context.");
  if (!wiring.handlerLogsBoundedFields) injectionFailures.push("review handler must log bounded shadow-specialist fields.");
  if (!wiring.handlerFailOpenCatch) injectionFailures.push("review handler must catch subflow failures and continue fail-open.");

  const orderingFailures: string[] = [];
  if (!wiring.invocationAfterChangedFiles) orderingFailures.push("shadow specialist invocation must occur after changedFiles are filtered and available.");
  if (!wiring.invocationBeforeReviewExecution) orderingFailures.push("shadow specialist invocation must occur before normal review execution/prompt analysis continues.");

  return [
    makeCheck({
      id: "M069-S02-HANDLER-INJECTION-SEAM",
      okCode: "handler_injection_seam_ok",
      failCode: "handler_injection_seam_failed",
      okDetail: "review handler imports, injects, invokes, logs, and fail-opens the shadow specialist subflow.",
      failures: injectionFailures,
    }),
    makeCheck({
      id: "M069-S02-HANDLER-ORDERING",
      okCode: "handler_ordering_ok",
      failCode: "handler_ordering_failed",
      okDetail: "shadow specialist runs after changed-file/diff context exists and before normal review analysis/execution continues.",
      failures: orderingFailures,
    }),
  ];
}

function buildReadOnlyBoundaryCheck(subflowText: string): M069S02Check {
  const boundary = summarizeReadOnlyBoundary(subflowText);
  const failures: string[] = [];
  if (!boundary.helperPresent) failures.push("subflow helper must export runShadowSpecialistSubflow.");
  if (!boundary.runnerInputTypePresent) failures.push("subflow must define ReadOnlyShadowSpecialistRunnerInput.");
  if (!boundary.runnerInputReadOnlyTrue) failures.push("runner input must include readOnly: true.");
  if (!boundary.runnerReceivesDiffContext) failures.push("runner input must receive bounded changed paths and diff context.");
  if (boundary.runnerInputHasOctokitDependency) failures.push("runner input type must not expose Octokit or octokit dependencies.");
  if (!boundary.shadowOnlyFieldsPresent) failures.push("subflow result must expose shadowOnly: true.");
  if (!boundary.publishesFindingsFalsePresent) failures.push("subflow result must expose publishesFindings: false.");

  return makeCheck({
    id: "M069-S02-READ-ONLY-SUBFLOW-BOUNDARY",
    okCode: "read_only_subflow_boundary_ok",
    failCode: "read_only_subflow_boundary_failed",
    okDetail: "subflow runner boundary is read-only, diff-context-only, shadow-only, and has no Octokit dependency.",
    failures,
  });
}

function buildFailOpenStatusesCheck(handlerText: string, subflowText: string): M069S02Check {
  const failOpen = summarizeFailOpen(handlerText, subflowText);
  const failures: string[] = [];
  if (!failOpen.timeoutReasonPresent) failures.push("subflow must expose runner-timeout fail-open reason.");
  if (!failOpen.errorReasonPresent) failures.push("subflow must expose runner-error fail-open reason.");
  if (!failOpen.malformedReasonPresent) failures.push("subflow must expose malformed-output fail-open reason.");
  if (!failOpen.notTriggeredSkipPresent) failures.push("subflow must expose not-triggered skip reason.");
  if (!failOpen.handlerCatchContinues) failures.push("handler catch path must log continuing fail-open.");

  return makeCheck({
    id: "M069-S02-FAIL-OPEN-STATUSES",
    okCode: "fail_open_statuses_ok",
    failCode: "fail_open_statuses_failed",
    okDetail: "timeout, error, malformed, and not-triggered paths are represented as bounded fail-open statuses.",
    failures,
  });
}

function buildPublicationSafetyCheck(subflowText: string): M069S02Check {
  const boundary = summarizeReadOnlyBoundary(subflowText);
  const failures: string[] = [];
  if (boundary.forbiddenPublicationMatches.length > 0) {
    failures.push(`subflow source must not wire publication tools or approval-shaped callbacks: ${boundary.forbiddenPublicationMatches.join(", ")}.`);
  }

  return makeCheck({
    id: "M069-S02-PUBLICATION-SAFETY",
    okCode: "publication_safety_ok",
    failCode: "publication_safety_failed",
    okDetail: "subflow source has no obvious GitHub publication/comment/review/approval tool wiring.",
    failures,
  });
}

function summarizeHandlerWiring(handlerText: string): M069S02Report["wiring"] {
  const positions = getSourcePositions(handlerText);
  return {
    handlerImportsSubflow: handlerText.includes("../specialists/shadow-specialist-subflow.ts")
      && handlerText.includes("runShadowSpecialistSubflow")
      && handlerText.includes("type ShadowSpecialistSubflowInput")
      && handlerText.includes("type ShadowSpecialistSubflowResult"),
    handlerDependencyInjectionSeam: handlerText.includes("shadowSpecialistSubflow?:")
      && handlerText.includes("ShadowSpecialistSubflowInput")
      && handlerText.includes("shadowSpecialistSubflow = runShadowSpecialistSubflow"),
    handlerInvokesSubflow: handlerText.includes("await shadowSpecialistSubflow({")
      && handlerText.includes("changedPaths: changedFiles")
      && handlerText.includes("diffText: diffContext.diffContent")
      && handlerText.includes("diffSnippet: diffContext.diffContent")
      && handlerText.includes("workspaceDir: workspace.dir")
      && handlerText.includes("deliveryId: event.id")
      && handlerText.includes("reviewOutputKey"),
    handlerLogsBoundedFields: handlerText.includes("buildShadowSpecialistLogFields")
      && handlerText.includes('gate: "shadow-specialist"')
      && handlerText.includes("candidateCount")
      && handlerText.includes("decisionCount")
      && handlerText.includes("duplicateCount")
      && handlerText.includes("disagreementCount")
      && handlerText.includes("tokenCountAvailable")
      && handlerText.includes("costAvailable")
      && handlerText.includes("latencyMsAvailable")
      && handlerText.includes("discardedPublicationFields"),
    handlerFailOpenCatch: handlerText.includes("Shadow specialist subflow failed before normal review; continuing fail-open")
      && handlerText.includes("handler-subflow-error"),
    invocationAfterChangedFiles: positions.changedFiles >= 0
      && positions.subflowInvocation >= 0
      && positions.changedFiles < positions.subflowInvocation,
    invocationBeforeReviewExecution: positions.subflowInvocation >= 0
      && positions.reviewExecution >= 0
      && positions.subflowInvocation < positions.reviewExecution,
  };
}

function summarizeReadOnlyBoundary(subflowText: string): M069S02Report["readOnlyBoundary"] {
  const runnerInputType = extractTypeBlock(subflowText, "ReadOnlyShadowSpecialistRunnerInput");
  const forbiddenPublicationMatches = FORBIDDEN_PUBLICATION_PATTERNS.filter((pattern) => subflowText.includes(pattern));
  return {
    helperPresent: subflowText.includes("export async function runShadowSpecialistSubflow"),
    runnerInputTypePresent: runnerInputType !== null,
    runnerInputReadOnlyTrue: runnerInputType?.includes("readonly readOnly: true") ?? false,
    runnerReceivesDiffContext: Boolean(runnerInputType
      && runnerInputType.includes("readonly matchedPaths")
      && runnerInputType.includes("readonly changedPaths")
      && runnerInputType.includes("readonly diffText")
      && runnerInputType.includes("readonly diffSnippet")),
    runnerInputHasOctokitDependency: /\bOctokit\b|\boctokit\b/.test(runnerInputType ?? ""),
    forbiddenPublicationMatches,
    shadowOnlyFieldsPresent: subflowText.includes("readonly shadowOnly: true") && subflowText.includes("shadowOnly: true"),
    publishesFindingsFalsePresent: subflowText.includes("readonly publishesFindings: false") && subflowText.includes("publishesFindings: false"),
  };
}

function summarizeFailOpen(handlerText: string, subflowText: string): M069S02Report["failOpen"] {
  const statuses = ["not-triggered", "runner-timeout", "runner-error", "malformed-output"].filter((status) => subflowText.includes(status));
  return {
    statuses,
    timeoutReasonPresent: subflowText.includes('"runner-timeout"') && subflowText.includes("timeoutReason"),
    errorReasonPresent: subflowText.includes('"runner-error"') && subflowText.includes("errorReason"),
    malformedReasonPresent: subflowText.includes('"malformed-output"') && subflowText.includes("unclassifiableReason"),
    notTriggeredSkipPresent: subflowText.includes('"not-triggered"') && subflowText.includes("skipReason"),
    handlerCatchContinues: handlerText.includes("continuing fail-open"),
  };
}

function getSourcePositions(handlerText: string): SourcePositions {
  const subflowInvocation = handlerText.indexOf("await shadowSpecialistSubflow({");
  return {
    changedFiles: handlerText.indexOf("const changedFiles = allChangedFiles.filter"),
    subflowInvocation,
    reviewExecution: firstPresentIndexAfter(handlerText, [
      "const diffAnalysis = analyzeDiff({",
      "buildReviewPromptDetails",
      "buildReviewPrompt(",
      "executor handoff",
    ], subflowInvocation >= 0 ? subflowInvocation : 0),
  };
}

function firstPresentIndexAfter(text: string, needles: readonly string[], startIndex: number): number {
  const positions = needles.map((needle) => text.indexOf(needle, startIndex)).filter((index) => index >= 0);
  return positions.length > 0 ? Math.min(...positions) : -1;
}

function extractTypeBlock(source: string, typeName: string): string | null {
  const start = source.indexOf(`export type ${typeName} = {`);
  if (start < 0) return null;
  const end = source.indexOf("};", start);
  if (end < 0) return null;
  return source.slice(start, end + 2);
}

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function makeCheck(params: {
  id: M069S02CheckId;
  okCode: M069S02CheckStatusCode;
  failCode: M069S02CheckStatusCode;
  okDetail: string;
  failures: readonly string[];
}): M069S02Check {
  const passed = params.failures.length === 0;
  return {
    id: params.id,
    passed,
    status: passed ? "pass" : "fail",
    status_code: passed ? params.okCode : params.failCode,
    detail: passed ? params.okDetail : params.failures.join(" "),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderM069S02Report(report: M069S02Report): string {
  return [
    "M069 S02 handler shadow specialist verifier",
    `status: ${report.status_code}`,
    `success: ${report.success ? "yes" : "no"}`,
    "",
    "checks:",
    ...report.checks.map((check) => `- [${check.passed ? "x" : " "}] ${check.id}: ${check.detail}`),
    "",
    "targeted tests:",
    ...report.targetedTests.map((command) => `- ${command}`),
    ...(report.issues.length > 0 ? ["", "issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

export function renderHelp(): string {
  return [
    "M069 S02 handler shadow specialist verifier",
    "",
    "Usage:",
    "  bun run verify:m069:s02 [--json]",
    "",
    "Notes:",
    "  - Uses package.json plus static source-file contract checks only.",
    "  - Does not read .gsd, .planning, .audits, .env, GitHub, Azure, or credentials.",
    "  - Emits bounded booleans and counts; no raw prompts, model output, tool payloads, secrets, comments, or approval-shaped fields.",
    "  - Targeted test commands are listed in JSON for slice verification and are not executed by this static verifier.",
    "",
  ].join("\n");
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  io?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: typeof evaluateM069S02Contract;
  },
): Promise<number> {
  const stdout = io?.stdout ?? process.stdout;
  const stderr = io?.stderr ?? process.stderr;
  const evaluate = io?.evaluate ?? evaluateM069S02Contract;

  let parsed: M069S02Args;
  try {
    parsed = parseM069S02Args(args);
  } catch (error) {
    const report = buildInvalidArgReport(error instanceof Error ? error.message : String(error));
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(renderHelp());
    return 0;
  }

  const report = await evaluate({ generatedAt: new Date().toISOString() });
  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM069S02Report(report));
  }

  if (!report.success) {
    stderr.write(`${COMMAND_NAME} failed: ${report.failing_check_id ?? "unknown"}\n`);
  }

  return report.success ? 0 : 1;
}

function buildInvalidArgReport(issue: string): M069S02Report {
  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    success: false,
    status_code: "m069_s02_invalid_arg",
    check_ids: [...M069_S02_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    summary: {
      packageScriptWired: false,
      handlerInjectionPresent: false,
      sameJobInjectionDefaultPresent: false,
      handlerOrderingValid: false,
      readOnlyRunnerInputPresent: false,
      readOnlyFlagCount: 0,
      failOpenStatusCount: 0,
      publicationForbiddenMatchCount: 0,
      targetedTestCommandCount: TARGETED_TEST_COMMANDS.length,
      readsPlanningOrSecrets: false,
      liveServiceRequired: false,
    },
    wiring: {
      handlerImportsSubflow: false,
      handlerDependencyInjectionSeam: false,
      handlerInvokesSubflow: false,
      handlerLogsBoundedFields: false,
      handlerFailOpenCatch: false,
      invocationAfterChangedFiles: false,
      invocationBeforeReviewExecution: false,
    },
    readOnlyBoundary: {
      helperPresent: false,
      runnerInputTypePresent: false,
      runnerInputReadOnlyTrue: false,
      runnerReceivesDiffContext: false,
      runnerInputHasOctokitDependency: false,
      forbiddenPublicationMatches: [],
      shadowOnlyFieldsPresent: false,
      publishesFindingsFalsePresent: false,
    },
    failOpen: {
      statuses: [],
      timeoutReasonPresent: false,
      errorReasonPresent: false,
      malformedReasonPresent: false,
      notTriggeredSkipPresent: false,
      handlerCatchContinues: false,
    },
    targetedTests: [...TARGETED_TEST_COMMANDS],
    issues: [issue],
  };
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
