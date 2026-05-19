import { dirname, isAbsolute, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHubApp } from "../src/auth/github-app.ts";
import { parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import { collectReviewOutputArtifacts, type ReviewOutputArtifactCollection, type ReviewOutputArtifactsOctokit } from "../src/review-audit/review-output-artifacts.ts";
import { discoverLogAnalyticsWorkspaceIds, queryReviewAuditLogs, type NormalizedLogAnalyticsRow } from "../src/review-audit/log-analytics.ts";

export const COMMAND_NAME = "verify:m074:s06" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m074-s06.ts" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m074-s06-production-like-proof.json" as const;

export const S06_CHECK_IDS = [
  "fixture.shape",
  "source.available",
  "correlation.exact",
  "same-pr-inline-suggestion.present",
  "lifecycle.rows.passed",
  "fix-eligibility.rows.passed",
  "validation-truth.rows.passed",
  "review-details.validation-truth.passed",
  "validation-truth.not-suggested-only",
  "visible-volume.bounded",
  "side-effects.absent",
  "redaction.safe",
  "package-wiring.present",
] as const;

export type M074S06CheckId = typeof S06_CHECK_IDS[number];
export type M074S06CheckStatus = "pass" | "fail" | "blocked";
export type M074S06StatusCode =
  | "m074_s06_ok"
  | "m074_s06_contract_failed"
  | "m074_s06_malformed_evidence"
  | "m074_s06_source_blocked"
  | "m074_s06_live_source_blocked"
  | "m074_s06_live_source_unavailable"
  | "m074_s06_live_exact_key_failed"
  | "m074_s06_live_runtime_correlation_missing"
  | "m074_s06_fixture_read_failed"
  | "m074_s06_invalid_json"
  | "m074_s06_invalid_arg";

export type M074S06Args = {
  readonly json: boolean;
  readonly help: boolean;
  readonly fixturePath?: string;
  readonly owner?: string;
  readonly repo?: string;
  readonly pr?: number;
  readonly reviewOutputKey?: string;
  readonly deliveryId?: string;
  readonly allowBlocked: boolean;
  readonly expectStatus?: M074S06StatusCode;
};

export type M074S06Check = {
  readonly id: M074S06CheckId;
  readonly status: M074S06CheckStatus;
  readonly message: string;
  readonly issues: readonly string[];
};

export type M074S06EvidenceSnapshot = {
  readonly schema: "m074-s06-production-like-proof.v1";
  readonly generatedAt: string;
  readonly source: {
    readonly mode: "production-like" | "live";
    readonly kind: "fixture" | "handler-log" | "live-run";
    readonly available: boolean;
    readonly externalWritesPerformed: boolean;
  };
  readonly target: {
    readonly owner: string;
    readonly repo: string;
    readonly pr: number;
  };
  readonly reviewOutputKey: string;
  readonly deliveryId: string;
  readonly trigger: {
    readonly kind: "pull_request" | "pull_request_review" | "issue_comment" | "workflow_dispatch";
    readonly samePr: boolean;
  };
  readonly samePrInlineSuggestion: {
    readonly attempted: boolean;
    readonly publishedOnSamePr: boolean;
    readonly suggestionCount: number;
    readonly maxSuggestions: number;
    readonly markerPresent: boolean;
    readonly suggestionBlockPresent: boolean;
    readonly commentCheckIds: readonly string[];
  };
  readonly gates: {
    readonly lifecycle: GateEvidence;
    readonly fixEligibility: GateEvidence;
    readonly validationTruth: GateEvidence;
  };
  readonly reviewDetails: GateEvidence & {
    readonly validationTruthLineCount: number;
    readonly correlationPresent: boolean;
    readonly reviewOutputKeyPresent: boolean;
    readonly deliveryIdPresent: boolean;
    readonly addedLines: number;
    readonly maxAddedLines: number;
    readonly visibleCharDelta: number;
    readonly maxVisibleCharDelta: number;
  };
  readonly validationTruth: {
    readonly suggestedOnlyResolvedCount: number;
    readonly validationOnlyResolvedCount: number;
    readonly freshRevalidationResolvedCount: number;
    readonly staleValidationResolvedCount: number;
    readonly failedValidationResolvedCount: number;
    readonly blockedOrDegradedResolvedCount: number;
  };
  readonly visibleVolume: {
    readonly publicCommentCount: number;
    readonly maxPublicCommentCount: number;
    readonly inlineSuggestionCommentCount: number;
    readonly maxInlineSuggestionCommentCount: number;
    readonly reviewDetailsLineCount: number;
    readonly maxReviewDetailsLineCount: number;
    readonly reviewDetailsValidationTruthLineCount: number;
  };
  readonly sideEffects: {
    readonly botBranchCreated: number;
    readonly separatePrCreated: number;
    readonly directPushCount: number;
    readonly unexpectedPublicCommentCount: number;
  };
  readonly redaction: {
    readonly rawPromptsIncluded: boolean;
    readonly rawModelOutputIncluded: boolean;
    readonly candidateBodiesIncluded: boolean;
    readonly replacementTextIncluded: boolean;
    readonly toolPayloadsIncluded: boolean;
    readonly diffsIncluded: boolean;
    readonly secretLikeStringsIncluded: boolean;
    readonly unboundedArraysIncluded: boolean;
    readonly canariesAbsent: boolean;
  };
};

type GateEvidence = {
  readonly gate: string;
  readonly passed: boolean;
  readonly statusCode: string;
  readonly checkIds: readonly string[];
  readonly sourceAvailable: boolean;
  readonly correlationPresent: boolean;
  readonly counts: Record<string, number>;
};

export type M074S06Observed = {
  readonly sourceAvailable: boolean;
  readonly liveSource: "not-requested" | "blocked" | "unavailable" | "matched" | "failed";
  readonly target: string;
  readonly reviewOutputKeyPresent: boolean;
  readonly deliveryIdPresent: boolean;
  readonly samePrSuggestionCount: number;
  readonly liveGithubArtifactCounts: { readonly reviewComments: number; readonly issueComments: number; readonly reviews: number; readonly total: number; readonly capped: boolean };
  readonly liveRuntimeCorrelation: { readonly matchedRows: number; readonly malformedRows: number; readonly missingCorrelationRows: number; readonly workspaceCount: number; readonly queried: boolean };
  readonly lifecycleStatusCode: string;
  readonly fixEligibilityStatusCode: string;
  readonly validationTruthStatusCode: string;
  readonly reviewDetailsStatusCode: string;
  readonly visibleVolume: M074S06EvidenceSnapshot["visibleVolume"];
  readonly sideEffects: M074S06EvidenceSnapshot["sideEffects"];
  readonly redaction: M074S06EvidenceSnapshot["redaction"] & { readonly forbiddenCanariesAbsent: boolean };
};

export type M074S06Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: M074S06StatusCode;
  readonly fixturePath?: string;
  readonly expectedStatus?: M074S06StatusCode;
  readonly failedCheckIds: readonly M074S06CheckId[];
  readonly checks: readonly M074S06Check[];
  readonly observed: M074S06Observed;
  readonly issues: readonly string[];
};

export type M074S06EvidenceSource = {
  readonly load: (args: M074S06Args) => Promise<{ readonly available: true; readonly text: string; readonly fixturePath?: string } | { readonly available: false; readonly reason: string }>;
};

export type M074S06LiveAvailability = "blocked" | "unavailable" | "matched";
export type M074S06LiveGithubResult =
  | { readonly availability: "blocked"; readonly reason: string }
  | { readonly availability: "unavailable"; readonly reason: string; readonly counts?: Partial<M074S06Observed["liveGithubArtifactCounts"]> }
  | { readonly availability: "matched"; readonly collection: ReviewOutputArtifactCollection; readonly capped?: boolean };
export type M074S06LiveRuntimeResult =
  | { readonly availability: "blocked"; readonly reason: string; readonly workspaceCount?: number }
  | { readonly availability: "unavailable"; readonly reason: string; readonly rows?: readonly NormalizedLogAnalyticsRow[]; readonly workspaceCount?: number }
  | { readonly availability: "matched"; readonly rows: readonly NormalizedLogAnalyticsRow[]; readonly workspaceCount: number; readonly queried?: boolean };
export type M074S06LiveCollectors = {
  readonly collectGithubArtifacts?: (args: M074S06Args) => Promise<M074S06LiveGithubResult>;
  readonly queryRuntimeLogs?: (args: M074S06Args) => Promise<M074S06LiveRuntimeResult>;
};

export type EvaluateM074S06Options = {
  readonly generatedAt?: string;
  readonly source?: M074S06EvidenceSource;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly liveCollectors?: M074S06LiveCollectors;
};

export type M074S06Writer = { readonly write: (chunk: string) => unknown };
export type M074S06MainOptions = {
  readonly stdout?: M074S06Writer;
  readonly stderr?: M074S06Writer;
  readonly evaluate?: (args: M074S06Args) => Promise<M074S06Report>;
};

const HELP_TEXT = `Usage: bun scripts/verify-m074-s06.ts [--fixture <path>] [--owner <owner>] [--repo <repo>] [--pr <number>] [--review-output-key <key>] [--delivery-id <id>] [--allow-blocked] [--expect-status <status>] [--json] [--help]\n\nVerifies bounded M074/S06 production-like or live same-PR inline-fix proof evidence without performing GitHub writes. When no fixture is supplied, the injected live source must provide evidence; the built-in CLI source is intentionally unavailable and returns a blocked status.\n`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);
const MAX_ISSUES = 24;
const FORBIDDEN_PATH_PREFIXES = [".gsd/", ".planning/", ".audits/", "live-only/"] as const;
const REQUIRED_GATE_CHECKS = {
  lifecycle: "review-finding-lifecycle",
  fixEligibility: "review-fix-eligibility",
  validationTruth: "review-validation-truth",
  reviewDetails: "review-details-validation-truth",
} as const;
const FORBIDDEN_RAW_KEY = /(^|_)(rawPrompt|rawPrompts|prompt|promptText|rawModelOutput|modelOutput|candidate|candidateBody|candidateBodies|replacement|replacementText|toolPayload|toolPayloads|diff|diffText|patch|hunk|secret|token|apiKey|body|commentBody|content|text)$/i;
const FORBIDDEN_RAW_VALUE = /(RAW_PROMPT_CANARY|RAW_MODEL_OUTPUT_CANARY|CANDIDATE_BODY_CANARY|TOOL_PAYLOAD_CANARY|RAW_PAYLOAD_CANARY|REPLACEMENT_CANARY|SECRET_TOKEN_CANARY|DIFF_TEXT_CANARY|PRIVATE_CANDIDATE_BODY|diff --git|ghp_|github_pat_|sk-[a-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const EMPTY_LIVE_GITHUB_COUNTS: M074S06Observed["liveGithubArtifactCounts"] = { reviewComments: 0, issueComments: 0, reviews: 0, total: 0, capped: false };
const EMPTY_LIVE_RUNTIME_CORRELATION: M074S06Observed["liveRuntimeCorrelation"] = { matchedRows: 0, malformedRows: 0, missingCorrelationRows: 0, workspaceCount: 0, queried: false };
const EMPTY_OBSERVED: M074S06Observed = {
  sourceAvailable: false,
  liveSource: "not-requested",
  target: "unknown/unknown#0",
  reviewOutputKeyPresent: false,
  deliveryIdPresent: false,
  samePrSuggestionCount: 0,
  liveGithubArtifactCounts: EMPTY_LIVE_GITHUB_COUNTS,
  liveRuntimeCorrelation: EMPTY_LIVE_RUNTIME_CORRELATION,
  lifecycleStatusCode: "missing",
  fixEligibilityStatusCode: "missing",
  validationTruthStatusCode: "missing",
  reviewDetailsStatusCode: "missing",
  visibleVolume: {
    publicCommentCount: 0,
    maxPublicCommentCount: 0,
    inlineSuggestionCommentCount: 0,
    maxInlineSuggestionCommentCount: 0,
    reviewDetailsLineCount: 0,
    maxReviewDetailsLineCount: 0,
    reviewDetailsValidationTruthLineCount: 0,
  },
  sideEffects: {
    botBranchCreated: 0,
    separatePrCreated: 0,
    directPushCount: 0,
    unexpectedPublicCommentCount: 0,
  },
  redaction: {
    rawPromptsIncluded: false,
    rawModelOutputIncluded: false,
    candidateBodiesIncluded: false,
    replacementTextIncluded: false,
    toolPayloadsIncluded: false,
    diffsIncluded: false,
    secretLikeStringsIncluded: false,
    unboundedArraysIncluded: false,
    canariesAbsent: false,
    forbiddenCanariesAbsent: false,
  },
};

export function parseM074S06Args(args: readonly string[]): M074S06Args {
  const parsed: Partial<M074S06Args> = { json: false, help: false, allowBlocked: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--allow-blocked") {
      parsed.allowBlocked = true;
      continue;
    }
    if (["--fixture", "--owner", "--repo", "--pr", "--review-output-key", "--delivery-id", "--expect-status"].includes(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`invalid_cli_args: ${arg} requires a value`);
      if (arg === "--fixture") parsed.fixturePath = value;
      if (arg === "--owner") parsed.owner = value;
      if (arg === "--repo") parsed.repo = value;
      if (arg === "--review-output-key") parsed.reviewOutputKey = value;
      if (arg === "--delivery-id") parsed.deliveryId = value;
      if (arg === "--expect-status") parsed.expectStatus = value as M074S06StatusCode;
      if (arg === "--pr") {
        const pr = Number(value);
        if (!Number.isInteger(pr) || pr <= 0) throw new Error("invalid_cli_args: --pr requires a positive integer");
        parsed.pr = pr;
      }
      index += 1;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  if (parsed.fixturePath) assertSafeFixturePath(parsed.fixturePath);
  if (parsed.expectStatus && !isStatusCode(parsed.expectStatus)) throw new Error(`invalid_cli_args: unsupported --expect-status ${parsed.expectStatus}`);
  return parsed as M074S06Args;
}

export async function evaluateM074S06Contract(args: M074S06Args = parseM074S06Args([]), options: EvaluateM074S06Options = {}): Promise<M074S06Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const source = options.source ?? (args.fixturePath ? fixtureSource : unavailableLiveSource);
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  let packageJsonText = "";
  try {
    packageJsonText = await readPackageJsonText();
  } catch {
    packageJsonText = "{}";
  }

  if (!args.fixturePath) {
    return evaluateM074S06LiveContract(args, { generatedAt, readPackageJsonText: async () => packageJsonText, liveCollectors: options.liveCollectors });
  }

  const loaded = await source.load(args);
  if (!loaded.available) {
    const isFixtureReadFailure = Boolean(args.fixturePath) && loaded.reason === "fixture-read-failed";
    const report = finalizeReport({
      command: COMMAND_NAME,
      generatedAt,
      success: false,
      statusCode: isFixtureReadFailure ? "m074_s06_fixture_read_failed" : "m074_s06_source_blocked",
      ...(args.fixturePath ? { fixturePath: args.fixturePath } : {}),
      ...(args.expectStatus ? { expectedStatus: args.expectStatus } : {}),
      failedCheckIds: [isFixtureReadFailure ? "fixture.shape" : "source.available"],
      checks: [isFixtureReadFailure
        ? fail("fixture.shape", "Fixture could not be read.", ["Fixture path is missing or unreadable."])
        : blocked("source.available", "Evidence source is unavailable.", ["No fixture was supplied and live evidence source is unavailable."])],
      observed: EMPTY_OBSERVED,
      issues: [isFixtureReadFailure ? "fixture.shape: Fixture path is missing or unreadable." : "source.available: evidence source unavailable"],
    }, args);
    return report;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(loaded.text);
  } catch {
    return finalizeReport(buildReadFailure(generatedAt, loaded.fixturePath, args, "m074_s06_invalid_json", "Fixture JSON could not be parsed."), args);
  }

  const packageWiringPresent = hasExpectedPackageScript(packageJsonText);
  const evaluation = evaluateM074S06Evidence(parsed, args, packageWiringPresent);
  const failed = evaluation.checks.filter((check) => check.status !== "pass");
  const shapeFailed = failed.some((check) => check.id === "fixture.shape");
  const statusCode: M074S06StatusCode = failed.length === 0 ? "m074_s06_ok" : shapeFailed ? "m074_s06_malformed_evidence" : "m074_s06_contract_failed";
  return finalizeReport({
    command: COMMAND_NAME,
    generatedAt,
    success: failed.length === 0,
    statusCode,
    fixturePath: loaded.fixturePath,
    ...(args.expectStatus ? { expectedStatus: args.expectStatus } : {}),
    failedCheckIds: uniqueSorted(failed.map((check) => check.id)),
    checks: evaluation.checks,
    observed: evaluation.observed,
    issues: boundIssues(failed.flatMap((check) => check.issues.length > 0 ? check.issues.map((issue) => `${check.id}: ${issue}`) : [`${check.id}: ${check.message}`])),
  }, args);
}

export function evaluateM074S06Evidence(fixture: unknown, args: M074S06Args = parseM074S06Args([]), packageWiringPresent = true): { readonly checks: readonly M074S06Check[]; readonly observed: M074S06Observed } {
  const shapeIssues = validateShape(fixture);
  if (shapeIssues.length > 0) {
    return {
      checks: [fail("fixture.shape", "Evidence shape is malformed.", shapeIssues), packageWiringCheck(packageWiringPresent)],
      observed: EMPTY_OBSERVED,
    };
  }
  const proof = fixture as M074S06EvidenceSnapshot;
  const forbiddenCanariesAbsent = findForbiddenCanaryPaths(proof).length === 0;
  const observed = buildObserved(proof, forbiddenCanariesAbsent);
  const checks: M074S06Check[] = [];
  checks.push(pass("fixture.shape", "Evidence has the bounded S06 proof shape."));
  checks.push(proof.source.available ? pass("source.available", "Evidence source is available.") : blocked("source.available", "Evidence source reported unavailable.", ["source.available must be true."]));

  const correlationIssues = validateCorrelation(proof, args);
  checks.push(correlationIssues.length === 0
    ? pass("correlation.exact", "Review output key, delivery id, and target correlation match expectations.")
    : fail("correlation.exact", "Correlation evidence is missing or stale.", correlationIssues));

  const samePrIssues = validateSamePrSuggestion(proof);
  checks.push(samePrIssues.length === 0
    ? pass("same-pr-inline-suggestion.present", "Same-PR inline suggestion evidence is present and bounded.")
    : fail("same-pr-inline-suggestion.present", "Same-PR inline suggestion evidence is missing or unsafe.", samePrIssues));

  checks.push(gateCheck("lifecycle.rows.passed", proof.gates.lifecycle, REQUIRED_GATE_CHECKS.lifecycle));
  checks.push(gateCheck("fix-eligibility.rows.passed", proof.gates.fixEligibility, REQUIRED_GATE_CHECKS.fixEligibility));
  checks.push(gateCheck("validation-truth.rows.passed", proof.gates.validationTruth, REQUIRED_GATE_CHECKS.validationTruth));
  checks.push(reviewDetailsCheck(proof));

  const validationIssues = validateTruthfulValidation(proof);
  checks.push(validationIssues.length === 0
    ? pass("validation-truth.not-suggested-only", "Suggested-only fixes do not resolve validation truth.")
    : fail("validation-truth.not-suggested-only", "Validation truth falsely resolves incomplete fixes.", validationIssues));

  const visibleIssues = validateVisibleVolume(proof);
  checks.push(visibleIssues.length === 0
    ? pass("visible-volume.bounded", "Public visible volume remains within S06 caps.")
    : fail("visible-volume.bounded", "Visible public output exceeds S06 caps.", visibleIssues));

  const sideEffectIssues = validateSideEffects(proof);
  checks.push(sideEffectIssues.length === 0
    ? pass("side-effects.absent", "No branch, separate PR, direct push, or unexpected public comment side effects are present.")
    : fail("side-effects.absent", "Forbidden side effects were observed.", sideEffectIssues));

  const redactionIssues = validateRedaction(proof, forbiddenCanariesAbsent);
  checks.push(redactionIssues.length === 0
    ? pass("redaction.safe", "Report surface is bounded and contains no raw payload canaries.")
    : fail("redaction.safe", "Unsafe raw evidence reached the bounded proof surface.", redactionIssues));

  checks.push(packageWiringCheck(packageWiringPresent));
  return { checks, observed };
}

async function fixtureSourceLoad(args: M074S06Args) {
  const fixturePath = args.fixturePath ?? DEFAULT_FIXTURE_PATH;
  assertSafeFixturePath(fixturePath);
  try {
    return { available: true as const, text: await Bun.file(resolveFixtureReadPath(fixturePath)).text(), fixturePath };
  } catch {
    return { available: false as const, reason: "fixture-read-failed" };
  }
}

const fixtureSource: M074S06EvidenceSource = { load: fixtureSourceLoad };
const unavailableLiveSource: M074S06EvidenceSource = { load: async () => ({ available: false, reason: "no-live-source" }) };

function buildReadFailure(generatedAt: string, fixturePath: string | undefined, args: M074S06Args, statusCode: M074S06StatusCode, issue: string): M074S06Report {
  return {
    command: COMMAND_NAME,
    generatedAt,
    success: false,
    statusCode,
    ...(fixturePath ? { fixturePath } : {}),
    ...(args.expectStatus ? { expectedStatus: args.expectStatus } : {}),
    failedCheckIds: ["fixture.shape"],
    checks: [fail("fixture.shape", issue, [issue])],
    observed: EMPTY_OBSERVED,
    issues: [`fixture.shape: ${issue}`],
  };
}

function buildObserved(proof: M074S06EvidenceSnapshot, forbiddenCanariesAbsent: boolean): M074S06Observed {
  return {
    sourceAvailable: proof.source.available,
    liveSource: proof.source.mode === "live" ? "matched" : "not-requested",
    target: `${proof.target.owner}/${proof.target.repo}#${proof.target.pr}`,
    reviewOutputKeyPresent: proof.reviewOutputKey.length > 0,
    deliveryIdPresent: proof.deliveryId.length > 0,
    samePrSuggestionCount: proof.samePrInlineSuggestion.suggestionCount,
    liveGithubArtifactCounts: EMPTY_LIVE_GITHUB_COUNTS,
    liveRuntimeCorrelation: EMPTY_LIVE_RUNTIME_CORRELATION,
    lifecycleStatusCode: proof.gates.lifecycle.statusCode,
    fixEligibilityStatusCode: proof.gates.fixEligibility.statusCode,
    validationTruthStatusCode: proof.gates.validationTruth.statusCode,
    reviewDetailsStatusCode: proof.reviewDetails.statusCode,
    visibleVolume: proof.visibleVolume,
    sideEffects: proof.sideEffects,
    redaction: { ...proof.redaction, forbiddenCanariesAbsent },
  };
}

function validateShape(value: unknown): string[] {
  const issues: string[] = [];
  const proof = value as Partial<M074S06EvidenceSnapshot> | null;
  if (!proof || typeof proof !== "object") return ["Evidence root must be an object."];
  if (proof.schema !== "m074-s06-production-like-proof.v1") issues.push("schema must be m074-s06-production-like-proof.v1.");
  for (const field of ["source", "target", "trigger", "samePrInlineSuggestion", "gates", "reviewDetails", "validationTruth", "visibleVolume", "sideEffects", "redaction"] as const) {
    if (!isRecord(proof[field])) issues.push(`${field} must be an object.`);
  }
  if (typeof proof.reviewOutputKey !== "string") issues.push("reviewOutputKey must be a string.");
  if (typeof proof.deliveryId !== "string") issues.push("deliveryId must be a string.");
  if (!isRecord(proof.target) || typeof proof.target.owner !== "string" || typeof proof.target.repo !== "string" || typeof proof.target.pr !== "number") issues.push("target must include owner, repo, and numeric pr.");
  if (isRecord(proof.gates)) {
    for (const field of ["lifecycle", "fixEligibility", "validationTruth"] as const) {
      if (!isGate(proof.gates[field])) issues.push(`gates.${field} is malformed.`);
    }
  }
  if (isRecord(proof.reviewDetails) && !isGate(proof.reviewDetails)) issues.push("reviewDetails gate fields are malformed.");
  return issues;
}

function validateCorrelation(proof: M074S06EvidenceSnapshot, args: M074S06Args): string[] {
  const expectedOwner = args.owner ?? proof.target.owner;
  const expectedRepo = args.repo ?? proof.target.repo;
  const expectedPr = args.pr ?? proof.target.pr;
  const expectedKey = args.reviewOutputKey ?? proof.reviewOutputKey;
  const expectedDelivery = args.deliveryId ?? proof.deliveryId;
  const issues: string[] = [];
  if (!proof.reviewOutputKey || proof.reviewOutputKey !== expectedKey) issues.push("reviewOutputKey missing or does not match expected value.");
  if (!proof.deliveryId || proof.deliveryId !== expectedDelivery) issues.push("deliveryId missing or does not match expected value.");
  if (proof.target.owner !== expectedOwner || proof.target.repo !== expectedRepo || proof.target.pr !== expectedPr) issues.push("target owner/repo/pr does not match expected value.");
  for (const gate of [proof.gates.lifecycle, proof.gates.fixEligibility, proof.gates.validationTruth, proof.reviewDetails]) {
    if (!gate.correlationPresent || !gate.sourceAvailable) issues.push(`${gate.gate} lacks source availability or correlation.`);
  }
  if (!proof.reviewDetails.reviewOutputKeyPresent || !proof.reviewDetails.deliveryIdPresent) issues.push("Review Details lacks exact key correlation metadata.");
  return issues;
}

function validateSamePrSuggestion(proof: M074S06EvidenceSnapshot): string[] {
  const evidence = proof.samePrInlineSuggestion;
  const issues: string[] = [];
  if (!proof.trigger.samePr) issues.push("trigger.samePr must be true.");
  if (!evidence.attempted || !evidence.publishedOnSamePr) issues.push("inline suggestion must be attempted and published on the same PR.");
  if (evidence.suggestionCount < 1) issues.push("at least one same-PR suggestion is required.");
  if (evidence.suggestionCount > evidence.maxSuggestions) issues.push("same-PR suggestion count exceeds configured cap.");
  if (!evidence.markerPresent || !evidence.suggestionBlockPresent) issues.push("inline suggestion marker and suggestion block must be present.");
  if (!evidence.commentCheckIds.includes("same-pr-suggestion-shape")) issues.push("same-pr-suggestion-shape check id is required.");
  return issues;
}

function gateCheck(id: M074S06CheckId, gate: GateEvidence, expectedGate: string): M074S06Check {
  const issues: string[] = [];
  if (gate.gate !== expectedGate) issues.push(`expected gate ${expectedGate}.`);
  if (!gate.passed) issues.push("gate did not pass.");
  if (!gate.sourceAvailable || !gate.correlationPresent) issues.push("gate lacks source availability or correlation.");
  if (gate.checkIds.length < 1) issues.push("gate checkIds are missing.");
  if (!Object.values(gate.counts).some((count) => count > 0)) issues.push("gate counts are empty.");
  return issues.length === 0 ? pass(id, `${expectedGate} evidence passed.`) : fail(id, `${expectedGate} evidence failed.`, issues);
}

function reviewDetailsCheck(proof: M074S06EvidenceSnapshot): M074S06Check {
  const issues: string[] = [];
  const details = proof.reviewDetails;
  if (details.gate !== REQUIRED_GATE_CHECKS.reviewDetails || !details.passed) issues.push("Review Details validation truth gate did not pass.");
  if (!details.sourceAvailable || !details.correlationPresent || !details.reviewOutputKeyPresent || !details.deliveryIdPresent) issues.push("Review Details lacks source availability or exact key correlation.");
  if (details.validationTruthLineCount !== 1) issues.push("Review Details must contain exactly one validation-truth line.");
  if (details.addedLines > details.maxAddedLines || details.visibleCharDelta > details.maxVisibleCharDelta) issues.push("Review Details visible delta exceeds bounds.");
  return issues.length === 0 ? pass("review-details.validation-truth.passed", "Review Details validation truth projection is bounded and correlated.") : fail("review-details.validation-truth.passed", "Review Details validation truth evidence failed.", issues);
}

function validateTruthfulValidation(proof: M074S06EvidenceSnapshot): string[] {
  const truth = proof.validationTruth;
  const issues: string[] = [];
  if (truth.suggestedOnlyResolvedCount !== 0) issues.push("suggested-only fixes resolved validation truth.");
  if (truth.validationOnlyResolvedCount !== 0) issues.push("validation-only fixes resolved without required revalidation.");
  if (truth.staleValidationResolvedCount !== 0 || truth.failedValidationResolvedCount !== 0 || truth.blockedOrDegradedResolvedCount !== 0) issues.push("stale, failed, blocked, or degraded evidence resolved validation truth.");
  return issues;
}

function validateVisibleVolume(proof: M074S06EvidenceSnapshot): string[] {
  const volume = proof.visibleVolume;
  const issues: string[] = [];
  if (volume.publicCommentCount > volume.maxPublicCommentCount) issues.push("public comment count exceeds cap.");
  if (volume.inlineSuggestionCommentCount > volume.maxInlineSuggestionCommentCount) issues.push("inline suggestion count exceeds cap.");
  if (volume.reviewDetailsLineCount > volume.maxReviewDetailsLineCount) issues.push("Review Details line count exceeds cap.");
  if (volume.reviewDetailsValidationTruthLineCount !== 1) issues.push("visible Review Details must include exactly one validation-truth line.");
  return issues;
}

function validateSideEffects(proof: M074S06EvidenceSnapshot): string[] {
  const effects = proof.sideEffects;
  const issues: string[] = [];
  if (effects.botBranchCreated > 0) issues.push("bot branch creation counter is non-zero.");
  if (effects.separatePrCreated > 0) issues.push("separate PR creation counter is non-zero.");
  if (effects.directPushCount > 0) issues.push("direct push counter is non-zero.");
  if (effects.unexpectedPublicCommentCount > 0) issues.push("unexpected public comment counter is non-zero.");
  if (proof.source.externalWritesPerformed) issues.push("source reports external writes performed by verifier.");
  return issues;
}

function validateRedaction(proof: M074S06EvidenceSnapshot, forbiddenCanariesAbsent: boolean): string[] {
  const redaction = proof.redaction;
  const issues: string[] = [];
  for (const [key, value] of Object.entries(redaction)) {
    if (key === "canariesAbsent") continue;
    if (value !== false) issues.push(`${key} must be false.`);
  }
  if (!redaction.canariesAbsent) issues.push("canariesAbsent flag must be true.");
  if (!forbiddenCanariesAbsent) issues.push("forbidden raw key or value canary detected.");
  return issues;
}

function findForbiddenCanaryPaths(value: unknown, path = "$", paths: string[] = []): string[] {
  if (paths.length >= MAX_ISSUES) return paths;
  if (typeof value === "string") {
    if (FORBIDDEN_RAW_VALUE.test(value)) paths.push(path);
    return paths;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenCanaryPaths(item, `${path}[${index}]`, paths));
    return paths;
  }
  if (!isRecord(value)) return paths;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (path !== "$.redaction" && FORBIDDEN_RAW_KEY.test(key)) paths.push(childPath);
    findForbiddenCanaryPaths(child, childPath, paths);
  }
  return paths;
}

function packageWiringCheck(packageWiringPresent: boolean): M074S06Check {
  return packageWiringPresent
    ? pass("package-wiring.present", "package.json exposes verify:m074:s06.")
    : fail("package-wiring.present", "package.json verify:m074:s06 wiring is absent or drifted.", [`expected ${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`]);
}

function pass(id: M074S06CheckId, message: string): M074S06Check {
  return { id, status: "pass", message, issues: [] };
}

function fail(id: M074S06CheckId, message: string, issues: readonly string[]): M074S06Check {
  return { id, status: "fail", message, issues: boundIssues(issues) };
}

function blocked(id: M074S06CheckId, message: string, issues: readonly string[]): M074S06Check {
  return { id, status: "blocked", message, issues: boundIssues(issues) };
}

function hasExpectedPackageScript(packageJsonText: string): boolean {
  try {
    const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> };
    return parsed.scripts?.[COMMAND_NAME] === EXPECTED_PACKAGE_SCRIPT;
  } catch {
    return packageJsonText.includes(`"${COMMAND_NAME}": "${EXPECTED_PACKAGE_SCRIPT}"`) || packageJsonText.includes(`"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"`);
  }
}

function assertSafeFixturePath(fixturePath: string): void {
  if (!fixturePath || isAbsolute(fixturePath)) throw new Error("invalid_cli_args: --fixture must be a repo-relative path");
  const normalized = normalize(fixturePath).replaceAll(sep, "/");
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) throw new Error("invalid_cli_args: --fixture must not traverse outside the repo");
  if (FORBIDDEN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) throw new Error("invalid_cli_args: --fixture must not read ignored or live-only paths");
  if (!normalized.endsWith(".json")) throw new Error("invalid_cli_args: --fixture must be a JSON file");
}

function resolveFixtureReadPath(fixturePath: string): string {
  assertSafeFixturePath(fixturePath);
  return `${PROJECT_ROOT}/${normalize(fixturePath).replaceAll(sep, "/")}`;
}

function isGate(value: unknown): value is GateEvidence {
  return isRecord(value)
    && typeof value.gate === "string"
    && typeof value.passed === "boolean"
    && typeof value.statusCode === "string"
    && Array.isArray(value.checkIds)
    && typeof value.sourceAvailable === "boolean"
    && typeof value.correlationPresent === "boolean"
    && isRecord(value.counts)
    && Object.values(value.counts).every((item) => typeof item === "number");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundIssues(issues: readonly string[]): readonly string[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 220 ? `${issue.slice(0, 217)}...` : issue);
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort();
}

function isStatusCode(value: string): value is M074S06StatusCode {
  return ["m074_s06_ok", "m074_s06_contract_failed", "m074_s06_malformed_evidence", "m074_s06_source_blocked", "m074_s06_live_source_blocked", "m074_s06_live_source_unavailable", "m074_s06_live_exact_key_failed", "m074_s06_live_runtime_correlation_missing", "m074_s06_fixture_read_failed", "m074_s06_invalid_json", "m074_s06_invalid_arg"].includes(value);
}

function finalizeReport(report: M074S06Report, args: M074S06Args): M074S06Report {
  const expectedStatusPass = !args.expectStatus || report.statusCode === args.expectStatus;
  const allowBlockedPass = !["m074_s06_source_blocked", "m074_s06_live_source_blocked"].includes(report.statusCode) || args.allowBlocked;
  return {
    ...report,
    success: expectedStatusPass && allowBlockedPass && (report.success || Boolean(args.expectStatus)),
    issues: boundIssues([
      ...report.issues,
      ...(expectedStatusPass ? [] : [`expect-status: expected ${args.expectStatus}, got ${report.statusCode}`]),
      ...(allowBlockedPass ? [] : ["source.available: blocked status requires --allow-blocked"]),
    ]),
  };
}


export async function evaluateM074S06LiveContract(
  args: M074S06Args,
  options: Pick<EvaluateM074S06Options, "generatedAt" | "readPackageJsonText" | "liveCollectors"> = {},
): Promise<M074S06Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packageJsonText = await (options.readPackageJsonText ?? (() => Bun.file("package.json").text()))().catch(() => "{}");
  const packageCheck = packageWiringCheck(hasExpectedPackageScript(packageJsonText));
  const parsed = typeof args.reviewOutputKey === "string" ? parseReviewOutputKey(args.reviewOutputKey) : null;
  const expectedDeliveryId = args.deliveryId ?? parsed?.effectiveDeliveryId ?? null;
  const target = parsed ? `${parsed.owner}/${parsed.repo}#${parsed.prNumber}` : `${args.owner ?? "unknown"}/${args.repo ?? "unknown"}#${args.pr ?? 0}`;

  if (!parsed || !expectedDeliveryId) {
    return finalizeReport({
      command: COMMAND_NAME,
      generatedAt,
      success: false,
      statusCode: "m074_s06_live_source_blocked",
      ...(args.expectStatus ? { expectedStatus: args.expectStatus } : {}),
      failedCheckIds: ["correlation.exact"],
      checks: [blocked("correlation.exact", "Live exact-key mode requires a parseable reviewOutputKey and deliveryId.", ["reviewOutputKey is missing, malformed, or lacks delivery correlation."]), packageCheck],
      observed: { ...EMPTY_OBSERVED, liveSource: "blocked", target, reviewOutputKeyPresent: Boolean(args.reviewOutputKey), deliveryIdPresent: Boolean(expectedDeliveryId) },
      issues: ["correlation.exact: live mode requires parseable reviewOutputKey and deliveryId"],
    }, args);
  }

  const collectors = options.liveCollectors ?? buildDefaultLiveCollectors();
  if (!collectors.collectGithubArtifacts && !collectors.queryRuntimeLogs) {
    return finalizeReport({
      command: COMMAND_NAME,
      generatedAt,
      success: false,
      statusCode: "m074_s06_live_source_blocked",
      ...(args.expectStatus ? { expectedStatus: args.expectStatus } : {}),
      failedCheckIds: ["source.available"],
      checks: [blocked("source.available", "No live collectors are available.", ["GitHub credentials/log configuration unavailable or no collectors were injected."]), packageCheck],
      observed: { ...EMPTY_OBSERVED, liveSource: "blocked", target, sourceAvailable: false, reviewOutputKeyPresent: true, deliveryIdPresent: true },
      issues: ["source.available: live collectors blocked or not configured"],
    }, args);
  }

  const github = collectors.collectGithubArtifacts
    ? await collectors.collectGithubArtifacts(args).catch((error): M074S06LiveGithubResult => ({ availability: "unavailable", reason: compactError(error) }))
    : { availability: "blocked", reason: "github collector not configured" } as const;
  const runtime = collectors.queryRuntimeLogs
    ? await collectors.queryRuntimeLogs(args).catch((error): M074S06LiveRuntimeResult => ({ availability: "unavailable", reason: compactError(error) }))
    : { availability: "blocked", reason: "runtime collector not configured" } as const;

  const githubCounts = summarizeGithubResult(github);
  const runtimeCorrelation = summarizeRuntimeResult(runtime, args.reviewOutputKey!, expectedDeliveryId);
  const checks: M074S06Check[] = [];
  checks.push(github.availability === "matched" || runtime.availability === "matched"
    ? pass("source.available", "At least one live source returned bounded evidence.")
    : github.availability === "unavailable" || runtime.availability === "unavailable"
      ? fail("source.available", "A configured live source was unavailable.", [github.reason, runtime.reason].filter(Boolean))
      : blocked("source.available", "Live sources are blocked by missing configuration.", [github.reason, runtime.reason].filter(Boolean)));

  const correlationIssues: string[] = [];
  if (args.owner && args.owner.toLowerCase() !== parsed.owner) correlationIssues.push("owner does not match reviewOutputKey.");
  if (args.repo && args.repo.toLowerCase() !== parsed.repo) correlationIssues.push("repo does not match reviewOutputKey.");
  if (args.pr && args.pr !== parsed.prNumber) correlationIssues.push("pr does not match reviewOutputKey.");
  if (expectedDeliveryId !== parsed.effectiveDeliveryId) correlationIssues.push("deliveryId does not match reviewOutputKey effective delivery.");
  checks.push(correlationIssues.length === 0 ? pass("correlation.exact", "Live key target and delivery correlation match.") : fail("correlation.exact", "Live key target or delivery correlation drifted.", correlationIssues));

  const githubIssues = validateLiveGithub(github);
  checks.push(githubIssues.length === 0 ? pass("visible-volume.bounded", "Live GitHub artifacts match exactly one bounded review output.") : fail("visible-volume.bounded", "Live GitHub artifacts are missing, duplicated, wrong, stale, or unbounded.", githubIssues));

  const runtimeIssues = validateLiveRuntime(runtime, runtimeCorrelation);
  checks.push(runtimeIssues.length === 0 ? pass("validation-truth.rows.passed", "Runtime logs include exact key and delivery correlation.") : fail("validation-truth.rows.passed", "Runtime logs are missing exact key/delivery correlation.", runtimeIssues));
  checks.push(pass("side-effects.absent", "Live verifier is read-only and performs no writes."));
  checks.push(pass("redaction.safe", "Live verifier reports aggregate metadata only; raw artifact bodies/log payloads are discarded."));
  checks.push(packageCheck);

  const failed = checks.filter((check) => check.status !== "pass");
  const liveSource = failed.length === 0 ? "matched" : github.availability === "unavailable" || runtime.availability === "unavailable" ? "unavailable" : checks[0]?.status === "blocked" ? "blocked" : "failed";
  const statusCode: M074S06StatusCode = failed.length === 0
    ? "m074_s06_ok"
    : liveSource === "blocked"
      ? "m074_s06_live_source_blocked"
      : liveSource === "unavailable"
        ? "m074_s06_live_source_unavailable"
        : runtimeCorrelation.matchedRows < 1
          ? "m074_s06_live_runtime_correlation_missing"
          : "m074_s06_live_exact_key_failed";

  return finalizeReport({
    command: COMMAND_NAME,
    generatedAt,
    success: failed.length === 0,
    statusCode,
    ...(args.expectStatus ? { expectedStatus: args.expectStatus } : {}),
    failedCheckIds: uniqueSorted(failed.map((check) => check.id)),
    checks,
    observed: {
      ...EMPTY_OBSERVED,
      sourceAvailable: liveSource === "matched",
      liveSource,
      target,
      reviewOutputKeyPresent: true,
      deliveryIdPresent: true,
      liveGithubArtifactCounts: githubCounts,
      liveRuntimeCorrelation: runtimeCorrelation,
      visibleVolume: { ...EMPTY_OBSERVED.visibleVolume, publicCommentCount: githubCounts.issueComments + githubCounts.reviews, inlineSuggestionCommentCount: githubCounts.reviewComments, reviewDetailsLineCount: githubCounts.total, maxPublicCommentCount: 1, maxInlineSuggestionCommentCount: 1, maxReviewDetailsLineCount: 3 },
      redaction: { ...EMPTY_OBSERVED.redaction, canariesAbsent: true, forbiddenCanariesAbsent: true },
    },
    issues: boundIssues(failed.flatMap((check) => check.issues.length > 0 ? check.issues.map((issue) => `${check.id}: ${issue}`) : [`${check.id}: ${check.message}`])),
  }, args);
}

function validateLiveGithub(result: M074S06LiveGithubResult): string[] {
  if (result.availability !== "matched") return [result.reason];
  const { collection } = result;
  const issues: string[] = [];
  if (collection.artifactCounts.total !== 1) issues.push(`expected exactly one artifact, found ${collection.artifactCounts.total}.`);
  const artifact = collection.artifacts[0];
  if (!artifact) return issues;
  if (artifact.prNumber <= 0 || !artifact.prUrl) issues.push("artifact target metadata is missing.");
  if (artifact.source !== "review") issues.push(`expected review artifact, found ${artifact.source}.`);
  if (artifact.reviewState !== "APPROVED") issues.push(`expected APPROVED review state, found ${artifact.reviewState ?? "missing"}.`);
  if (!artifact.sourceUrl || !artifact.updatedAt) issues.push("artifact source URL or timestamp is missing.");
  return issues;
}

function validateLiveRuntime(result: M074S06LiveRuntimeResult, correlation: M074S06Observed["liveRuntimeCorrelation"]): string[] {
  if (result.availability === "blocked") return [result.reason];
  if (result.availability === "unavailable") return [result.reason];
  const issues: string[] = [];
  if (correlation.matchedRows < 1) issues.push("no runtime rows contained both reviewOutputKey and deliveryId.");
  if (correlation.malformedRows > 0) issues.push("malformed runtime rows were returned.");
  if (correlation.missingCorrelationRows > 0) issues.push("some runtime rows missed exact key or delivery correlation.");
  return issues;
}

function summarizeGithubResult(result: M074S06LiveGithubResult): M074S06Observed["liveGithubArtifactCounts"] {
  if (result.availability === "matched") return { ...result.collection.artifactCounts, capped: Boolean(result.capped) };
  return { ...EMPTY_LIVE_GITHUB_COUNTS, ...("counts" in result ? result.counts : {}), capped: false };
}

function summarizeRuntimeResult(result: M074S06LiveRuntimeResult, reviewOutputKey: string, deliveryId: string): M074S06Observed["liveRuntimeCorrelation"] {
  const rows = result.availability === "matched" || result.availability === "unavailable" ? (result.rows ?? []) : [];
  let matchedRows = 0;
  let missingCorrelationRows = 0;
  let malformedRows = 0;
  for (const row of rows) {
    if (row.malformed) malformedRows += 1;
    const keyMatches = row.reviewOutputKey === reviewOutputKey || row.rawLog?.includes(reviewOutputKey) === true;
    const deliveryMatches = row.deliveryId === deliveryId || row.rawLog?.includes(deliveryId) === true;
    if (keyMatches && deliveryMatches && !row.malformed) matchedRows += 1;
    else missingCorrelationRows += 1;
  }
  return { matchedRows, malformedRows, missingCorrelationRows, workspaceCount: result.workspaceCount ?? 0, queried: result.availability !== "blocked" && (result.availability === "matched" ? result.queried !== false : true) };
}

function buildDefaultLiveCollectors(): M074S06LiveCollectors {
  const githubCollector = hasGithubEnv(process.env)
    ? async (args: M074S06Args): Promise<M074S06LiveGithubResult> => {
      const parsed = parseReviewOutputKey(args.reviewOutputKey ?? "");
      if (!parsed) return { availability: "blocked", reason: "missing or malformed reviewOutputKey" };
      const githubApp = createGitHubApp(buildGitHubAppConfig(readGithubPrivateKey(process.env), process.env) as never, silentLogger());
      await githubApp.initialize({ requestTimeoutMs: 15_000 });
      const octokit = await githubApp.getInstallationOctokit(parsed.installationId, { requestTimeoutMs: 15_000 }) as unknown as ReviewOutputArtifactsOctokit;
      const collection = await collectReviewOutputArtifacts({ octokit, reviewOutputKey: parsed.reviewOutputKey });
      return { availability: "matched", collection };
    }
    : undefined;

  const runtimeCollector = hasLogEnv(process.env)
    ? async (args: M074S06Args): Promise<M074S06LiveRuntimeResult> => {
      const workspaceIds = await resolveWorkspaceIds(process.env);
      if (workspaceIds.length === 0) return { availability: "blocked", reason: "missing Log Analytics workspace ids", workspaceCount: 0 };
      const result = await queryReviewAuditLogs({ workspaceIds, reviewOutputKey: args.reviewOutputKey, deliveryId: args.deliveryId, limit: 100, timespan: process.env.M074_S06_LOG_TIMESPAN ?? "P7D" });
      return { availability: "matched", rows: result.rows, workspaceCount: workspaceIds.length, queried: true };
    }
    : undefined;
  return { collectGithubArtifacts: githubCollector, queryRuntimeLogs: runtimeCollector };
}

function hasGithubEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GITHUB_APP_ID && (env.GITHUB_PRIVATE_KEY || env.GITHUB_PRIVATE_KEY_BASE64));
}

function readGithubPrivateKey(env: NodeJS.ProcessEnv): string {
  const key = env.GITHUB_PRIVATE_KEY ?? (env.GITHUB_PRIVATE_KEY_BASE64 ? Buffer.from(env.GITHUB_PRIVATE_KEY_BASE64, "base64").toString("utf8") : "");
  return key;
}

function buildGitHubAppConfig(privateKey: string, env: NodeJS.ProcessEnv) {
  return {
    githubAppId: env.GITHUB_APP_ID!,
    githubPrivateKey: privateKey,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? "unused-for-read-only-verifier",
    botUsername: env.BOT_USERNAME ?? "kodiai",
    port: 0,
  };
}

function hasLogEnv(env: NodeJS.ProcessEnv): boolean {
  return splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_ID).length > 0
    || splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_IDS).length > 0
    || splitList(env.LOG_ANALYTICS_WORKSPACE_ID).length > 0
    || splitList(env.LOG_ANALYTICS_WORKSPACE_IDS).length > 0
    || Boolean(env.AZURE_RESOURCE_GROUP ?? env.ACA_RESOURCE_GROUP ?? env.RESOURCE_GROUP);
}

async function resolveWorkspaceIds(env: NodeJS.ProcessEnv): Promise<string[]> {
  const explicit = [
    ...splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_ID),
    ...splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_IDS),
    ...splitList(env.LOG_ANALYTICS_WORKSPACE_ID),
    ...splitList(env.LOG_ANALYTICS_WORKSPACE_IDS),
  ];
  if (explicit.length > 0) return [...new Set(explicit)];
  const resourceGroup = env.AZURE_RESOURCE_GROUP ?? env.ACA_RESOURCE_GROUP ?? env.RESOURCE_GROUP;
  if (!resourceGroup) return [];
  return discoverLogAnalyticsWorkspaceIds({ resourceGroup });
}

function splitList(value: string | undefined): string[] {
  return value?.split(/[;,\s]+/).map((item) => item.trim()).filter(Boolean) ?? [];
}

function silentLogger() {
  const noop = () => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => silentLogger() };
}

function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(GITHUB_PRIVATE_KEY|GITHUB_PRIVATE_KEY_BASE64|github_pat_|ghp_|sk-)[^\s,;]*/gi, "$1[redacted]").slice(0, 180);
}

export async function main(rawArgs = Bun.argv.slice(2), options: M074S06MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let args: M074S06Args;
  try {
    args = parseM074S06Args(rawArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m074_s06_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }
  if (args.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }
  const report = await (options.evaluate ?? ((parsed) => evaluateM074S06Contract(parsed)))(args);
  if (args.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write([
      `${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`,
      `statusCode=${report.statusCode}${report.expectedStatus ? ` expected=${report.expectedStatus}` : ""}`,
      `sourceAvailable=${report.observed.sourceAvailable} liveSource=${report.observed.liveSource} target=${report.observed.target}`,
      `correlation=reviewOutputKey:${report.observed.reviewOutputKeyPresent ? "y" : "n"},deliveryId:${report.observed.deliveryIdPresent ? "y" : "n"}`,
      `liveGithubArtifacts=reviewComments:${report.observed.liveGithubArtifactCounts.reviewComments},issueComments:${report.observed.liveGithubArtifactCounts.issueComments},reviews:${report.observed.liveGithubArtifactCounts.reviews},total:${report.observed.liveGithubArtifactCounts.total},capped:${report.observed.liveGithubArtifactCounts.capped ? "y" : "n"}`,
      `liveRuntime=queried:${report.observed.liveRuntimeCorrelation.queried ? "y" : "n"},workspaces:${report.observed.liveRuntimeCorrelation.workspaceCount},matched:${report.observed.liveRuntimeCorrelation.matchedRows},malformed:${report.observed.liveRuntimeCorrelation.malformedRows},missingCorrelation:${report.observed.liveRuntimeCorrelation.missingCorrelationRows}`,
      `gates=lifecycle:${report.observed.lifecycleStatusCode},fix:${report.observed.fixEligibilityStatusCode},validation:${report.observed.validationTruthStatusCode},reviewDetails:${report.observed.reviewDetailsStatusCode}`,
      `samePrSuggestions=${report.observed.samePrSuggestionCount}/${report.observed.visibleVolume.maxInlineSuggestionCommentCount}`,
      `visibleVolume=public:${report.observed.visibleVolume.publicCommentCount}/${report.observed.visibleVolume.maxPublicCommentCount},detailsLines:${report.observed.visibleVolume.reviewDetailsLineCount}/${report.observed.visibleVolume.maxReviewDetailsLineCount}`,
      `sideEffects=branch:${report.observed.sideEffects.botBranchCreated},separatePr:${report.observed.sideEffects.separatePrCreated},push:${report.observed.sideEffects.directPushCount},unexpectedPublic:${report.observed.sideEffects.unexpectedPublicCommentCount}`,
      `redaction=${report.observed.redaction.canariesAbsent && report.observed.redaction.forbiddenCanariesAbsent ? "pass" : "fail"}`,
      ...(report.failedCheckIds.length > 0 ? [`failedCheckIds=${report.failedCheckIds.join(",")}`] : []),
      ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []),
      "",
    ].join("\n"));
  }
  return report.success ? 0 : report.statusCode === "m074_s06_invalid_arg" ? 2 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
