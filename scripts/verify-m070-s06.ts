import { readFile } from "node:fs/promises";

import {
  buildM070FixtureScenario,
  evaluateM070VerifierScenario,
  type M070PublicationMode,
  type M070ScenarioName,
  type M070StatusCode,
  type M070VerifierReport,
} from "./verify-m070.ts";

export const COMMAND_NAME = "verify:m070:s06" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m070-s06.ts" as const;
export const DEFAULT_TARGET = "xbmc/xbmc#28172" as const;
export const DEFAULT_REPO = "xbmc/xbmc" as const;

export const M070_S06_CHECK_IDS = [
  "M070-S06-CLI-ARGS",
  "M070-S06-SOURCE-AVAILABILITY",
  "M070-S06-EXACT-KEY-ARTIFACTS",
  "M070-S06-S04-EVALUATOR-STATUS",
  "M070-S06-RUNTIME-CORRELATION",
  "M070-S06-REDACTION-BOUNDARY",
  "M070-S06-PACKAGE-WIRING",
] as const;

export const M070_S06_STATUS_CODES = [
  "m070_s06_candidate_approved_verified_ok",
  "m070_s06_candidate_approved_partial_ok",
  "m070_s06_missing_exact_key_blocked",
  "m070_s06_invalid_or_stale_key_blocked",
  "m070_s06_missing_github_access_blocked",
  "m070_s06_github_unavailable_blocked",
  "m070_s06_no_artifact_blocked",
  "m070_s06_duplicate_artifact_blocked",
  "m070_s06_wrong_artifact_blocked",
  "m070_s06_missing_runtime_correlation_blocked",
  "m070_s06_malformed_aggregate_blocked",
  "m070_s06_direct_fallback_rejected",
  "m070_s06_redaction_violation",
  "m070_s06_package_wiring_drift",
  "m070_s06_invalid_arg",
] as const;

export type M070S06CheckId = (typeof M070_S06_CHECK_IDS)[number];
export type M070S06StatusCode = (typeof M070_S06_STATUS_CODES)[number];

export type M070S06Args = {
  readonly json: boolean;
  readonly help: boolean;
  readonly reviewOutputKey: string | null;
  readonly deliveryId: string | null;
  readonly repo: string;
  readonly correlationKey: string | null;
  readonly target: string;
  readonly expectStatus: M070S06StatusCode | null;
  readonly allowBlocked: boolean;
};

export type M070S06ReviewDetailsArtifact = {
  readonly id: string;
  readonly reviewOutputKey: string;
  readonly deliveryId?: string | null;
  readonly repo?: string | null;
  readonly target?: string | null;
  readonly shortUrl?: string | null;
  readonly aggregateEvidence: unknown;
  readonly publicationMode: M070PublicationMode;
  readonly stale?: boolean;
};

export type M070S06RuntimeLogRow = {
  readonly id: string;
  readonly reviewOutputKey?: string | null;
  readonly deliveryId?: string | null;
  readonly correlationKey?: string | null;
  readonly available: boolean;
};

export type M070S06SourceSnapshot = {
  readonly github: {
    readonly reviewDetailsAvailable: boolean;
    readonly accessPresent: boolean;
    readonly unavailable: boolean;
  };
  readonly reviewDetails: readonly M070S06ReviewDetailsArtifact[];
  readonly runtime: {
    readonly queried: boolean;
    readonly unavailable: boolean;
    readonly rows: readonly M070S06RuntimeLogRow[];
  };
};

export type M070S06Check = {
  readonly id: M070S06CheckId;
  readonly passed: boolean;
  readonly status: "pass" | "fail";
  readonly status_code: M070S06StatusCode;
  readonly detail: string;
};

export type M070S06Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "exact-key-live-or-production-like-wrapper";
  readonly proofScope: "s06-exact-key-s04-evaluator-wrapper";
  readonly success: boolean;
  readonly status_code: M070S06StatusCode;
  readonly check_ids: readonly M070S06CheckId[];
  readonly checks: readonly M070S06Check[];
  readonly failing_check_id: M070S06CheckId | null;
  readonly inputs: {
    readonly repo: string;
    readonly target: string;
    readonly reviewOutputKeyPresent: boolean;
    readonly deliveryIdPresent: boolean;
    readonly correlationKeyPresent: boolean;
  };
  readonly sourceAvailability: {
    readonly githubReviewDetailsAvailable: boolean;
    readonly githubAccessPresent: boolean;
    readonly githubUnavailable: boolean;
    readonly runtimeQueried: boolean;
    readonly runtimeUnavailable: boolean;
  };
  readonly artifactCounts: {
    readonly totalReviewDetails: number;
    readonly matchingReviewDetails: number;
    readonly duplicateReviewDetails: number;
    readonly wrongKeyReviewDetails: number;
    readonly staleReviewDetails: number;
  };
  readonly artifactIds: readonly string[];
  readonly shortUrls: readonly string[];
  readonly s04: {
    readonly status_code: M070StatusCode | null;
    readonly success: boolean;
    readonly failing_check_id: M070VerifierReport["failing_check_id"] | null;
    readonly check_ids: readonly M070VerifierReport["check_ids"][number][];
  };
  readonly runtimeCorrelation: {
    readonly correlationKeyPresent: boolean;
    readonly runtimeLogRowsAvailable: boolean;
    readonly matchingRuntimeRows: number;
  };
  readonly publicationMode: M070PublicationMode;
  readonly redaction: {
    readonly privateOnly: boolean;
    readonly candidateBodiesIncluded: boolean;
    readonly specialistProseIncluded: boolean;
    readonly rawPromptsIncluded: boolean;
    readonly rawModelOutputIncluded: boolean;
    readonly diffsIncluded: boolean;
    readonly evidencePayloadsIncluded: boolean;
    readonly rawFingerprintsIncluded: boolean;
    readonly candidateAttemptIncluded: boolean;
    readonly candidateKeyIncluded: boolean;
    readonly forbiddenInputFieldPresent: boolean;
    readonly aggregateOnly: boolean;
  };
  readonly packageWiring: {
    readonly scriptName: typeof COMMAND_NAME;
    readonly expected: typeof EXPECTED_PACKAGE_SCRIPT;
    readonly present: boolean;
    readonly matches: boolean;
  };
  readonly issue_categories: readonly string[];
  readonly issues: readonly string[];
};

export type EvaluateM070S06Input = {
  readonly reviewOutputKey?: string | null;
  readonly deliveryId?: string | null;
  readonly repo?: string | null;
  readonly correlationKey?: string | null;
  readonly target?: string | null;
  readonly sources?: M070S06SourceSnapshot;
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly evaluateS04?: typeof evaluateM070VerifierScenario;
};

export type M070S06MainDeps = {
  readonly stdout?: { write(chunk: string): void };
  readonly stderr?: { write(chunk: string): void };
  readonly collectSources?: (args: M070S06Args) => Promise<M070S06SourceSnapshot>;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly generatedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nextValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`invalid_cli_args: ${flag} requires a value`);
  return value;
}

export function parseM070S06Args(argv: readonly string[]): M070S06Args {
  let json = false;
  let help = false;
  let reviewOutputKey: string | null = null;
  let deliveryId: string | null = null;
  let repo = DEFAULT_REPO;
  let correlationKey: string | null = null;
  let target = DEFAULT_TARGET;
  let expectStatus: M070S06StatusCode | null = null;
  let allowBlocked = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--allow-blocked") allowBlocked = true;
    else if (arg === "--review-output-key") {
      reviewOutputKey = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--delivery-id") {
      deliveryId = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--repo") {
      repo = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--correlation-key") {
      correlationKey = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--target") {
      target = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--expect-status") {
      const value = nextValue(argv, index, arg);
      if (!M070_S06_STATUS_CODES.includes(value as M070S06StatusCode)) {
        throw new Error(`invalid_cli_args: --expect-status must be one of ${M070_S06_STATUS_CODES.join(",")}`);
      }
      expectStatus = value as M070S06StatusCode;
      index++;
    } else {
      throw new Error(`invalid_cli_args: unsupported argument ${arg}`);
    }
  }

  return { json, help, reviewOutputKey, deliveryId, repo, correlationKey, target, expectStatus, allowBlocked };
}

function compactId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 96);
}

function validExactKey(value: string | null | undefined): boolean {
  const trimmed = compactId(value);
  return trimmed !== null && /^[A-Za-z0-9][A-Za-z0-9._:@/+\-=#]{2,160}$/.test(trimmed) && !trimmed.includes("..");
}

function makeCheck(id: M070S06CheckId, passed: boolean, statusCode: M070S06StatusCode, detail: string): M070S06Check {
  return { id, passed, status: passed ? "pass" : "fail", status_code: statusCode, detail };
}

function defaultSources(): M070S06SourceSnapshot {
  return {
    github: { reviewDetailsAvailable: false, accessPresent: false, unavailable: false },
    reviewDetails: [],
    runtime: { queried: false, unavailable: false, rows: [] },
  };
}

function parsePackageWiring(packageJsonText: string): M070S06Report["packageWiring"] {
  try {
    const parsed = JSON.parse(packageJsonText) as unknown;
    const actual = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts[COMMAND_NAME] : undefined;
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: typeof actual === "string", matches: actual === EXPECTED_PACKAGE_SCRIPT };
  } catch {
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false };
  }
}

async function readDefaultPackageJsonText(): Promise<string> {
  return readFile(new URL("../package.json", import.meta.url), "utf8");
}

const emptyRedaction: M070S06Report["redaction"] = {
  privateOnly: false,
  candidateBodiesIncluded: false,
  specialistProseIncluded: false,
  rawPromptsIncluded: false,
  rawModelOutputIncluded: false,
  diffsIncluded: false,
  evidencePayloadsIncluded: false,
  rawFingerprintsIncluded: false,
  candidateAttemptIncluded: false,
  candidateKeyIncluded: false,
  forbiddenInputFieldPresent: false,
  aggregateOnly: true,
};

function mapS04Status(report: M070VerifierReport | null): M070S06StatusCode {
  if (report === null) return "m070_s06_malformed_aggregate_blocked";
  if (report.redaction.forbiddenInputFieldPresent
    || report.redaction.candidateBodiesIncluded
    || report.redaction.specialistProseIncluded
    || report.redaction.rawPromptsIncluded
    || report.redaction.rawModelOutputIncluded
    || report.redaction.diffsIncluded
    || report.redaction.evidencePayloadsIncluded
    || report.redaction.rawFingerprintsIncluded
    || report.redaction.candidateAttemptIncluded
    || report.redaction.candidateKeyIncluded) return "m070_s06_redaction_violation";
  if (report.status_code === "m070_candidate_approved_verified_ok") return "m070_s06_candidate_approved_verified_ok";
  if (report.status_code === "m070_candidate_approved_partial_ok") return "m070_s06_candidate_approved_partial_ok";
  if (report.status_code === "m070_direct_fallback_rejected") return "m070_s06_direct_fallback_rejected";
  if (report.status_code === "m070_missing_correlation_blocked") return "m070_s06_missing_runtime_correlation_blocked";
  return "m070_s06_malformed_aggregate_blocked";
}

function isAccepted(statusCode: M070S06StatusCode): boolean {
  return statusCode === "m070_s06_candidate_approved_verified_ok" || statusCode === "m070_s06_candidate_approved_partial_ok";
}

function issueFor(statusCode: M070S06StatusCode): { categories: string[]; issues: string[] } {
  if (isAccepted(statusCode)) return { categories: [], issues: [] };
  const category = statusCode.replace(/^m070_s06_/, "").replace(/_blocked$|_rejected$|_violation$|_drift$|_arg$/g, "").replaceAll("_", "-");
  const messages: Record<M070S06StatusCode, string> = {
    m070_s06_candidate_approved_verified_ok: "",
    m070_s06_candidate_approved_partial_ok: "",
    m070_s06_missing_exact_key_blocked: "Missing reviewOutputKey; exact-key verification cannot prove M070 success.",
    m070_s06_invalid_or_stale_key_blocked: "Review output key is invalid, stale, or refers to stale artifact evidence.",
    m070_s06_missing_github_access_blocked: "GitHub Review Details source access is unavailable or unauthenticated.",
    m070_s06_github_unavailable_blocked: "GitHub Review Details source is temporarily unavailable.",
    m070_s06_no_artifact_blocked: "No Review Details artifact was found for the exact key.",
    m070_s06_duplicate_artifact_blocked: "Multiple Review Details artifacts matched the exact key.",
    m070_s06_wrong_artifact_blocked: "Review Details artifacts were present but none matched the exact key.",
    m070_s06_missing_runtime_correlation_blocked: "Required correlation key or matching runtime log row is missing.",
    m070_s06_malformed_aggregate_blocked: "S04 aggregate evidence was missing, malformed, or policy-rejected without an accepted S06 mapping.",
    m070_s06_direct_fallback_rejected: "Direct fallback-only evidence is blocked and cannot count as M070 success.",
    m070_s06_redaction_violation: "Raw/private evidence was detected at the wrapper boundary and omitted from output.",
    m070_s06_package_wiring_drift: "package.json scripts.verify:m070:s06 is missing or points at the wrong command.",
    m070_s06_invalid_arg: "Invalid CLI arguments.",
  };
  return { categories: [category], issues: [messages[statusCode]] };
}

export function buildM070S06FixtureSources(input: {
  readonly scenario: M070ScenarioName;
  readonly reviewOutputKey: string;
  readonly deliveryId: string;
  readonly correlationKey: string;
  readonly repo: string;
  readonly target: string;
}): M070S06SourceSnapshot {
  const fixture = buildM070FixtureScenario(input.scenario);
  return {
    github: { reviewDetailsAvailable: true, accessPresent: true, unavailable: false },
    reviewDetails: [{
      id: "review-details-1",
      shortUrl: `https://github.com/${input.repo}/pull/${input.target.split("#").at(-1) ?? "28172"}#review-details-1`,
      reviewOutputKey: input.reviewOutputKey,
      deliveryId: input.deliveryId,
      repo: input.repo,
      target: input.target,
      aggregateEvidence: fixture.aggregateEvidence,
      publicationMode: fixture.publicationMode,
    }],
    runtime: { queried: true, unavailable: false, rows: [{ id: "runtime-row-1", reviewOutputKey: input.reviewOutputKey, deliveryId: input.deliveryId, correlationKey: input.correlationKey, available: true }] },
  };
}

export async function evaluateM070S06(input: EvaluateM070S06Input): Promise<M070S06Report> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const repo = compactId(input.repo) ?? DEFAULT_REPO;
  const target = compactId(input.target) ?? DEFAULT_TARGET;
  const reviewOutputKey = compactId(input.reviewOutputKey);
  const deliveryId = compactId(input.deliveryId);
  const correlationKey = compactId(input.correlationKey);
  const sources = input.sources ?? defaultSources();
  const packageWiring = parsePackageWiring(await (input.readPackageJsonText ?? readDefaultPackageJsonText)());
  const totalReviewDetails = sources.reviewDetails.length;
  const exactKeyValid = validExactKey(reviewOutputKey);
  const matching = exactKeyValid ? sources.reviewDetails.filter((artifact) => artifact.reviewOutputKey === reviewOutputKey && (artifact.repo == null || artifact.repo === repo) && (artifact.target == null || artifact.target === target)) : [];
  const wrongKeyReviewDetails = exactKeyValid ? sources.reviewDetails.filter((artifact) => artifact.reviewOutputKey !== reviewOutputKey || (artifact.repo != null && artifact.repo !== repo) || (artifact.target != null && artifact.target !== target)).length : totalReviewDetails;
  const staleReviewDetails = matching.filter((artifact) => artifact.stale).length;
  const duplicateReviewDetails = Math.max(0, matching.length - 1);
  const selected = matching.length === 1 && staleReviewDetails === 0 ? matching[0] ?? null : null;
  const runtimeMatches = correlationKey === null ? [] : sources.runtime.rows.filter((row) => row.available && row.correlationKey === correlationKey && (reviewOutputKey === null || row.reviewOutputKey == null || row.reviewOutputKey === reviewOutputKey) && (deliveryId === null || row.deliveryId == null || row.deliveryId === deliveryId));

  let s04: M070VerifierReport | null = null;
  if (selected !== null) {
    s04 = (input.evaluateS04 ?? evaluateM070VerifierScenario)({ scenario: "candidate_approved_verified", aggregateEvidence: selected.aggregateEvidence, publicationMode: selected.publicationMode }, { generatedAt });
  }

  let statusCode: M070S06StatusCode;
  if (reviewOutputKey === null) statusCode = "m070_s06_missing_exact_key_blocked";
  else if (!exactKeyValid || staleReviewDetails > 0) statusCode = "m070_s06_invalid_or_stale_key_blocked";
  else if (!sources.github.accessPresent) statusCode = "m070_s06_missing_github_access_blocked";
  else if (sources.github.unavailable || !sources.github.reviewDetailsAvailable) statusCode = "m070_s06_github_unavailable_blocked";
  else if (totalReviewDetails === 0) statusCode = "m070_s06_no_artifact_blocked";
  else if (matching.length === 0) statusCode = "m070_s06_wrong_artifact_blocked";
  else if (matching.length > 1) statusCode = "m070_s06_duplicate_artifact_blocked";
  else if (!packageWiring.matches) statusCode = "m070_s06_package_wiring_drift";
  else if (correlationKey === null || runtimeMatches.length === 0) statusCode = "m070_s06_missing_runtime_correlation_blocked";
  else statusCode = mapS04Status(s04);

  const success = isAccepted(statusCode);
  const redaction = s04 === null ? emptyRedaction : {
    privateOnly: s04.redaction.privateOnly,
    candidateBodiesIncluded: s04.redaction.candidateBodiesIncluded,
    specialistProseIncluded: s04.redaction.specialistProseIncluded,
    rawPromptsIncluded: s04.redaction.rawPromptsIncluded,
    rawModelOutputIncluded: s04.redaction.rawModelOutputIncluded,
    diffsIncluded: s04.redaction.diffsIncluded,
    evidencePayloadsIncluded: s04.redaction.evidencePayloadsIncluded,
    rawFingerprintsIncluded: s04.redaction.rawFingerprintsIncluded,
    candidateAttemptIncluded: s04.redaction.candidateAttemptIncluded,
    candidateKeyIncluded: s04.redaction.candidateKeyIncluded,
    forbiddenInputFieldPresent: s04.redaction.forbiddenInputFieldPresent,
    aggregateOnly: !s04.redaction.candidateBodiesIncluded && !s04.redaction.specialistProseIncluded && !s04.redaction.rawPromptsIncluded && !s04.redaction.rawModelOutputIncluded && !s04.redaction.diffsIncluded && !s04.redaction.evidencePayloadsIncluded && !s04.redaction.rawFingerprintsIncluded && !s04.redaction.candidateAttemptIncluded && !s04.redaction.candidateKeyIncluded,
  };
  const { categories, issues } = issueFor(statusCode);

  const checks: M070S06Check[] = [
    makeCheck("M070-S06-CLI-ARGS", reviewOutputKey !== null && exactKeyValid, statusCode, reviewOutputKey !== null && exactKeyValid ? "Exact reviewOutputKey input is present and bounded." : "Exact reviewOutputKey input is missing or invalid."),
    makeCheck("M070-S06-SOURCE-AVAILABILITY", sources.github.accessPresent && sources.github.reviewDetailsAvailable && !sources.github.unavailable, statusCode, sources.github.accessPresent && sources.github.reviewDetailsAvailable && !sources.github.unavailable ? "GitHub Review Details source is available." : "GitHub Review Details source is blocked or unavailable."),
    makeCheck("M070-S06-EXACT-KEY-ARTIFACTS", selected !== null, statusCode, selected !== null ? "Exactly one non-stale Review Details artifact matched the exact key." : "Exact-key artifact cardinality is not accepted."),
    makeCheck("M070-S06-S04-EVALUATOR-STATUS", s04?.success === true && !s04.safety.directFallbackOnly && statusCode !== "m070_s06_malformed_aggregate_blocked" && statusCode !== "m070_s06_direct_fallback_rejected", statusCode, s04?.success === true ? "S04 evaluator accepted aggregate policy evidence." : "S04 evaluator did not accept aggregate policy evidence."),
    makeCheck("M070-S06-RUNTIME-CORRELATION", correlationKey !== null && runtimeMatches.length > 0, statusCode, correlationKey !== null && runtimeMatches.length > 0 ? "Runtime correlation key has a matching bounded row." : "Runtime correlation evidence is missing."),
    makeCheck("M070-S06-REDACTION-BOUNDARY", redaction.aggregateOnly && !redaction.forbiddenInputFieldPresent, statusCode, redaction.aggregateOnly && !redaction.forbiddenInputFieldPresent ? "Report is aggregate-only with no raw canary surfaces." : "Forbidden raw/private fields were detected and omitted."),
    makeCheck("M070-S06-PACKAGE-WIRING", packageWiring.matches, statusCode, packageWiring.matches ? "package.json script is wired to the S06 verifier." : "package.json script wiring drift detected."),
  ];
  const failingCheck = checks.find((check) => !check.passed) ?? null;

  return {
    command: COMMAND_NAME,
    generated_at: generatedAt,
    proofMode: "exact-key-live-or-production-like-wrapper",
    proofScope: "s06-exact-key-s04-evaluator-wrapper",
    success,
    status_code: statusCode,
    check_ids: M070_S06_CHECK_IDS,
    checks,
    failing_check_id: failingCheck?.id ?? null,
    inputs: { repo, target, reviewOutputKeyPresent: reviewOutputKey !== null, deliveryIdPresent: deliveryId !== null, correlationKeyPresent: correlationKey !== null },
    sourceAvailability: { githubReviewDetailsAvailable: sources.github.reviewDetailsAvailable, githubAccessPresent: sources.github.accessPresent, githubUnavailable: sources.github.unavailable, runtimeQueried: sources.runtime.queried, runtimeUnavailable: sources.runtime.unavailable },
    artifactCounts: { totalReviewDetails, matchingReviewDetails: matching.length, duplicateReviewDetails, wrongKeyReviewDetails, staleReviewDetails },
    artifactIds: matching.slice(0, 5).map((artifact) => artifact.id.slice(0, 96)),
    shortUrls: matching.map((artifact) => artifact.shortUrl).filter((url): url is string => typeof url === "string" && url.length > 0).slice(0, 5).map((url) => url.slice(0, 160)),
    s04: { status_code: s04?.status_code ?? null, success: s04?.success ?? false, failing_check_id: s04?.failing_check_id ?? null, check_ids: s04?.check_ids ?? [] },
    runtimeCorrelation: { correlationKeyPresent: correlationKey !== null, runtimeLogRowsAvailable: runtimeMatches.length > 0, matchingRuntimeRows: runtimeMatches.length },
    publicationMode: selected?.publicationMode ?? { candidateApprovedNonFallback: false, directFallbackEvidence: false },
    redaction,
    packageWiring,
    issue_categories: categories,
    issues,
  };
}

function buildInvalidArgReport(issue: string, generatedAt = new Date().toISOString()): M070S06Report {
  const { categories, issues } = issueFor("m070_s06_invalid_arg");
  return {
    command: COMMAND_NAME,
    generated_at: generatedAt,
    proofMode: "exact-key-live-or-production-like-wrapper",
    proofScope: "s06-exact-key-s04-evaluator-wrapper",
    success: false,
    status_code: "m070_s06_invalid_arg",
    check_ids: M070_S06_CHECK_IDS,
    checks: [makeCheck("M070-S06-CLI-ARGS", false, "m070_s06_invalid_arg", issue.slice(0, 160))],
    failing_check_id: "M070-S06-CLI-ARGS",
    inputs: { repo: DEFAULT_REPO, target: DEFAULT_TARGET, reviewOutputKeyPresent: false, deliveryIdPresent: false, correlationKeyPresent: false },
    sourceAvailability: { githubReviewDetailsAvailable: false, githubAccessPresent: false, githubUnavailable: false, runtimeQueried: false, runtimeUnavailable: false },
    artifactCounts: { totalReviewDetails: 0, matchingReviewDetails: 0, duplicateReviewDetails: 0, wrongKeyReviewDetails: 0, staleReviewDetails: 0 },
    artifactIds: [],
    shortUrls: [],
    s04: { status_code: null, success: false, failing_check_id: null, check_ids: [] },
    runtimeCorrelation: { correlationKeyPresent: false, runtimeLogRowsAvailable: false, matchingRuntimeRows: 0 },
    publicationMode: { candidateApprovedNonFallback: false, directFallbackEvidence: false },
    redaction: emptyRedaction,
    packageWiring: { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false },
    issue_categories: categories,
    issues,
  };
}

function usage(): string {
  return `Usage: bun run verify:m070:s06 --review-output-key <key> [--delivery-id <id>] [--repo owner/name] [--correlation-key <key>] [--target owner/name#pr] [--json] [--expect-status <status>] [--allow-blocked]\n\nRuns the bounded M070 S06 exact-key wrapper over GitHub Review Details/runtime aggregate evidence and the S04 evaluator.\n`;
}

export async function main(argv: readonly string[] = process.argv.slice(2), deps: M070S06MainDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const generatedAt = deps.generatedAt ?? new Date().toISOString();
  let args: M070S06Args;
  try {
    args = parseM070S06Args(argv);
  } catch (error) {
    const report = buildInvalidArgReport(error instanceof Error ? error.message : "invalid_cli_args", generatedAt);
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(usage());
    return 0;
  }

  const sources = await (deps.collectSources ?? (async () => defaultSources()))(args);
  const report = await evaluateM070S06({
    reviewOutputKey: args.reviewOutputKey,
    deliveryId: args.deliveryId,
    repo: args.repo,
    correlationKey: args.correlationKey,
    target: args.target,
    sources,
    readPackageJsonText: deps.readPackageJsonText,
    generatedAt,
  });

  if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else stdout.write(`${report.status_code} success=${report.success} failing_check_id=${report.failing_check_id ?? "none"}\n`);

  if (args.expectStatus !== null) return report.status_code === args.expectStatus ? 0 : 1;
  if (report.success || args.allowBlocked) return 0;
  stderr.write(`M070 S06 verifier blocked: ${report.status_code}\n`);
  return 1;
}

if (import.meta.main) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
