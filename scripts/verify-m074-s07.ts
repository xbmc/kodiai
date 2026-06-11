import { dirname, isAbsolute, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_DOCTRINE_CONTRACT_TYPES, REPO_DOCTRINE_LIMITS, type RepoDoctrineContractType } from "../src/repo-doctrine/contracts.ts";

export const COMMAND_NAME = "verify:m074:s07" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m074-s07.ts" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m074-s07-repo-doctrine-proof.json" as const;

export const S07_CHECK_IDS = [
  "fixture.shape",
  "source.available",
  "config.schema.supported",
  "contract-types.covered",
  "review-plan.consumed",
  "prompt.consumed",
  "reducer.consumed",
  "review-details.aggregate",
  "handler.correlation",
  "redaction.safe",
  "caps.enforced",
  "side-effects.absent",
  "package-wiring.present",
] as const;

export type M074S07CheckId = typeof S07_CHECK_IDS[number];
export type M074S07CheckStatus = "pass" | "fail" | "blocked";
export type M074S07StatusCode =
  | "m074_s07_ok"
  | "m074_s07_contract_failed"
  | "m074_s07_malformed_evidence"
  | "m074_s07_fixture_read_failed"
  | "m074_s07_invalid_json"
  | "m074_s07_invalid_arg";

type ReasonCode =
  | "disabled"
  | "skipped"
  | "parse-fallback"
  | "malformed-contract"
  | "unconsumed-contract"
  | "redaction-applied"
  | "redaction-failed"
  | "bounded"
  | "source-missing"
  | "none";

export type M074S07Args = {
  readonly json: boolean;
  readonly help: boolean;
  readonly fixturePath?: string;
  readonly expectStatus?: M074S07StatusCode;
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type M074S07Check = {
  readonly id: M074S07CheckId;
  readonly status: M074S07CheckStatus;
  readonly message: string;
  readonly issues: readonly string[];
};

type EvidenceGate = {
  readonly status: "applied" | "disabled" | "skipped" | "degraded";
  readonly consumed: boolean;
  readonly aggregateOnly: boolean;
  readonly correlationPresent?: boolean;
  readonly contractCount: number;
  readonly matchedCount: number;
  readonly omittedCount: number;
  readonly reasonCodes: readonly ReasonCode[];
};

export type M074S07EvidenceSnapshot = {
  readonly schema: "m074-s07-repo-doctrine-proof.v1";
  readonly generatedAt: string;
  readonly source: {
    readonly mode: "source-fixture";
    readonly kind: "fixture";
    readonly available: boolean;
    readonly externalWritesPerformed: boolean;
  };
  readonly config: EvidenceGate & {
    readonly schemaSupported: boolean;
    readonly parseFallbackCovered: boolean;
    readonly malformedContractFallbackCovered: boolean;
  };
  readonly doctrine: {
    readonly enabled: boolean;
    readonly contractCount: number;
    readonly consumedContractCount: number;
    readonly omittedContractCount: number;
    readonly matchedPathCandidateCount: number;
    readonly omittedMatchedPathCandidateCount: number;
    readonly contractTypes: readonly RepoDoctrineContractType[];
    readonly maxContracts: number;
    readonly maxPromptContracts: number;
    readonly maxReasonCodes: number;
    readonly reasonCodes: readonly ReasonCode[];
  };
  readonly reviewPlan: EvidenceGate & { readonly detailsSummaryContainsDoctrine: boolean };
  readonly prompt: EvidenceGate & { readonly boundedContractLines: number; readonly rawDoctrineTextIncluded: boolean };
  readonly reducer: EvidenceGate & { readonly detailsSummaryContainsDoctrine: boolean };
  readonly reviewDetails: EvidenceGate & {
    readonly statusLineCount: number;
    readonly maxStatusLineCount: number;
    readonly rawDoctrineTextIncluded: boolean;
  };
  readonly handler: EvidenceGate & {
    readonly logGate: "repo-doctrine";
    readonly reviewPlanProjectionPresent: boolean;
    readonly promptProjectionPresent: boolean;
    readonly reducerProjectionPresent: boolean;
    readonly reviewDetailsProjectionPresent: boolean;
  };
  readonly sideEffects: {
    readonly botBranchCreated: number;
    readonly separatePrCreated: number;
    readonly directPushCount: number;
    readonly publicCommentCreated: number;
  };
  readonly redaction: {
    readonly rawPromptsIncluded: boolean;
    readonly rawDoctrineTextIncluded: boolean;
    readonly rawModelOutputIncluded: boolean;
    readonly toolPayloadsIncluded: boolean;
    readonly diffsIncluded: boolean;
    readonly secretLikeStringsIncluded: boolean;
    readonly unboundedArraysIncluded: boolean;
    readonly canariesAbsent: boolean;
  };
};

export type M074S07Observed = {
  readonly sourceAvailable: boolean;
  readonly statusCounts: Record<string, number>;
  readonly contractCount: number;
  readonly consumedContractCount: number;
  readonly matchedPathCandidateCount: number;
  readonly omittedCount: number;
  readonly typeCoverageCount: number;
  readonly expectedTypeCount: number;
  readonly reasonCodes: readonly ReasonCode[];
  readonly sideEffects: M074S07EvidenceSnapshot["sideEffects"];
  readonly redactionPass: boolean;
};

export type M074S07Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: M074S07StatusCode;
  readonly fixturePath?: string;
  readonly expectedStatus?: M074S07StatusCode;
  readonly failedCheckIds: readonly M074S07CheckId[];
  readonly checks: readonly M074S07Check[];
  readonly observed: M074S07Observed;
  readonly issues: readonly string[];
};

export type M074S07EvidenceSource = {
  readonly load: (args: M074S07Args) => Promise<{ readonly available: true; readonly text: string; readonly fixturePath?: string } | { readonly available: false; readonly reason: string }>;
};

export type M074S07SourceTexts = Partial<Record<"config" | "contracts" | "reviewPlan" | "prompt" | "reducer" | "handler", string>>;
export type EvaluateM074S07Options = {
  readonly generatedAt?: string;
  readonly source?: M074S07EvidenceSource;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly readSourceTexts?: () => Promise<M074S07SourceTexts>;
};

export type M074S07Writer = { readonly write: (chunk: string) => unknown };
export type M074S07MainOptions = {
  readonly stdout?: M074S07Writer;
  readonly stderr?: M074S07Writer;
  readonly evaluate?: (args: M074S07Args) => Promise<M074S07Report>;
};

const HELP_TEXT = `Usage: bun scripts/verify-m074-s07.ts [--fixture <path>] [--expect-status <status>] [--json] [--help]\n\nVerifies bounded M074/S07 repository doctrine contract evidence. Output is aggregate-only and never prints raw doctrine text, prompts, model output, tool payloads, diffs, or secrets.\n`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);
const MAX_ISSUES = 24;
const MAX_REASON_CODES = 12;
const FORBIDDEN_PATH_PREFIXES = [".gsd/", ".planning/", ".audits/", "live-only/"] as const;
const FORBIDDEN_RAW_KEY = /(^|_)(rawPrompt|rawPrompts|promptText|rawDoctrine|rawDoctrineText|instructions|evidence|rawModelOutput|modelOutput|toolPayload|toolPayloads|diff|diffText|patch|hunk|secret|token|apiKey|body|content|text)$/i;
const FORBIDDEN_RAW_VALUE = /(RAW_DOCTRINE_CANARY|RAW_PROMPT_CANARY|RAW_MODEL_OUTPUT_CANARY|TOOL_PAYLOAD_CANARY|SECRET_TOKEN_CANARY|DIFF_TEXT_CANARY|PRIVATE_DOCTRINE_TEXT|diff --git|ghp_|github_pat_|sk-[a-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

const EMPTY_SIDE_EFFECTS = { botBranchCreated: 0, separatePrCreated: 0, directPushCount: 0, publicCommentCreated: 0 };
const EMPTY_OBSERVED: M074S07Observed = {
  sourceAvailable: false,
  statusCounts: {},
  contractCount: 0,
  consumedContractCount: 0,
  matchedPathCandidateCount: 0,
  omittedCount: 0,
  typeCoverageCount: 0,
  expectedTypeCount: REPO_DOCTRINE_CONTRACT_TYPES.length,
  reasonCodes: [],
  sideEffects: EMPTY_SIDE_EFFECTS,
  redactionPass: false,
};

export function parseM074S07Args(args: readonly string[]): M074S07Args {
  const parsed: Partial<Mutable<M074S07Args>> = { json: false, help: false };
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
    if (arg === "--fixture" || arg === "--expect-status") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`invalid_cli_args: ${arg} requires a value`);
      if (arg === "--fixture") parsed.fixturePath = value;
      if (arg === "--expect-status") parsed.expectStatus = value as M074S07StatusCode;
      index += 1;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  if (parsed.fixturePath) assertSafeFixturePath(parsed.fixturePath);
  if (parsed.expectStatus && !isStatusCode(parsed.expectStatus)) throw new Error(`invalid_cli_args: unsupported --expect-status ${parsed.expectStatus}`);
  return parsed as M074S07Args;
}

export async function evaluateM074S07Contract(args: M074S07Args = parseM074S07Args(["--fixture", DEFAULT_FIXTURE_PATH]), options: EvaluateM074S07Options = {}): Promise<M074S07Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const source = options.source ?? fixtureSource;
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const readSourceTexts = options.readSourceTexts ?? readDefaultSourceTexts;

  let packageJsonText = "";
  try {
    packageJsonText = await readPackageJsonText();
  } catch {
    packageJsonText = "{}";
  }

  const loaded = await source.load({ ...args, fixturePath: args.fixturePath ?? DEFAULT_FIXTURE_PATH });
  if (!loaded.available) {
    return finalizeReport({
      command: COMMAND_NAME,
      generatedAt,
      success: false,
      statusCode: "m074_s07_fixture_read_failed",
      fixturePath: args.fixturePath ?? DEFAULT_FIXTURE_PATH,
      ...(args.expectStatus ? { expectedStatus: args.expectStatus } : {}),
      failedCheckIds: ["fixture.shape"],
      checks: [fail("fixture.shape", "Fixture could not be read.", ["fixture missing or unreadable"])],
      observed: EMPTY_OBSERVED,
      issues: ["fixture.shape: fixture missing or unreadable"],
    }, args);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(loaded.text);
  } catch {
    return finalizeReport(buildReadFailure(generatedAt, loaded.fixturePath, args, "m074_s07_invalid_json", "Fixture JSON could not be parsed."), args);
  }

  let sourceTexts: M074S07SourceTexts = {};
  try {
    sourceTexts = await readSourceTexts();
  } catch {
    sourceTexts = {};
  }

  const evaluation = evaluateM074S07Evidence(parsed, {
    packageWiringPresent: hasExpectedPackageScript(packageJsonText),
    sourceTexts,
  });
  const failed = evaluation.checks.filter((check) => check.status !== "pass");
  const shapeFailed = failed.some((check) => check.id === "fixture.shape");
  const statusCode: M074S07StatusCode = failed.length === 0 ? "m074_s07_ok" : shapeFailed ? "m074_s07_malformed_evidence" : "m074_s07_contract_failed";
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

export function evaluateM074S07Evidence(
  fixture: unknown,
  options: { readonly packageWiringPresent?: boolean; readonly sourceTexts?: M074S07SourceTexts } = {},
): { readonly checks: readonly M074S07Check[]; readonly observed: M074S07Observed } {
  const shapeIssues = validateShape(fixture);
  if (shapeIssues.length > 0) {
    return {
      checks: [fail("fixture.shape", "Evidence shape is malformed.", shapeIssues), packageWiringCheck(Boolean(options.packageWiringPresent))],
      observed: EMPTY_OBSERVED,
    };
  }

  const proof = fixture as M074S07EvidenceSnapshot;
  const forbiddenCanaryPaths = findForbiddenCanaryPaths(proof);
  const sourceProbe = probeSourceTexts(options.sourceTexts ?? {});
  const observed = buildObserved(proof, forbiddenCanaryPaths.length === 0);
  const checks: M074S07Check[] = [];

  checks.push(pass("fixture.shape", "Evidence has the bounded S07 repo doctrine proof shape."));
  checks.push(proof.source.available ? pass("source.available", "Evidence source is available.") : blocked("source.available", "Evidence source reported unavailable.", ["source.available must be true"]));

  checks.push(configCheck(proof, sourceProbe));
  checks.push(contractTypesCheck(proof, sourceProbe));
  checks.push(gateConsumptionCheck("review-plan.consumed", proof.reviewPlan, sourceProbe.reviewPlan, ["detailsSummaryContainsDoctrine"]));
  checks.push(gateConsumptionCheck("prompt.consumed", proof.prompt, sourceProbe.prompt, ["boundedContractLines"]));
  checks.push(gateConsumptionCheck("reducer.consumed", proof.reducer, sourceProbe.reducer, ["detailsSummaryContainsDoctrine"]));
  checks.push(reviewDetailsCheck(proof, sourceProbe.reviewDetails));
  checks.push(handlerCheck(proof, sourceProbe.handler));

  const redactionIssues = validateRedaction(proof, forbiddenCanaryPaths.length === 0);
  checks.push(redactionIssues.length === 0 ? pass("redaction.safe", "Bounded proof surface contains no raw doctrine or payload canaries.") : fail("redaction.safe", "Unsafe raw evidence reached S07 proof output.", redactionIssues));

  const capIssues = validateCaps(proof);
  checks.push(capIssues.length === 0 ? pass("caps.enforced", "Contract, prompt, path, and reason-code arrays are bounded before reporting.") : fail("caps.enforced", "S07 proof exceeded bounded reporting caps.", capIssues));

  const sideEffectIssues = validateSideEffects(proof);
  checks.push(sideEffectIssues.length === 0 ? pass("side-effects.absent", "Verifier proof has no branch, PR, push, or public-comment side effects.") : fail("side-effects.absent", "Forbidden side effects were observed.", sideEffectIssues));
  checks.push(packageWiringCheck(Boolean(options.packageWiringPresent)));

  return { checks, observed };
}

function configCheck(proof: M074S07EvidenceSnapshot, sourceProbe: SourceProbe): M074S07Check {
  const issues: string[] = [];
  if (!proof.config.schemaSupported || !proof.config.parseFallbackCovered || !proof.config.malformedContractFallbackCovered) issues.push("config schema, parse fallback, and malformed-contract fallback must be covered.");
  if (!proof.config.aggregateOnly) issues.push("config proof must be aggregate-only.");
  if (!sourceProbe.config) issues.push("source tokens for review.doctrine schema and fallback parsing were not found.");
  return issues.length === 0 ? pass("config.schema.supported", "review.doctrine config schema and fallback support are present.") : fail("config.schema.supported", "Config schema evidence is missing or config-only.", issues);
}

function contractTypesCheck(proof: M074S07EvidenceSnapshot, sourceProbe: SourceProbe): M074S07Check {
  const missing = REPO_DOCTRINE_CONTRACT_TYPES.filter((type) => !proof.doctrine.contractTypes.includes(type));
  const issues: string[] = [];
  if (missing.length > 0) issues.push(`missing contract type coverage count=${missing.length}`);
  if (proof.doctrine.contractTypes.length > REPO_DOCTRINE_CONTRACT_TYPES.length) issues.push("contract type evidence contains unexpected expansion.");
  if (!sourceProbe.contracts) issues.push("source tokens for repo doctrine contract constants were not found.");
  return issues.length === 0 ? pass("contract-types.covered", "All repo doctrine contract types are represented in bounded evidence.") : fail("contract-types.covered", "Repo doctrine contract type evidence is incomplete.", issues);
}

function gateConsumptionCheck(id: M074S07CheckId, gate: EvidenceGate, sourcePresent: boolean, extraFields: readonly string[]): M074S07Check {
  const issues: string[] = [];
  if (gate.status !== "applied") issues.push("gate status must be applied.");
  if (!gate.consumed) issues.push("gate did not consume repo doctrine evidence.");
  if (!gate.aggregateOnly) issues.push("gate must expose aggregate-only doctrine evidence.");
  if (gate.contractCount < 1 || gate.consumed === false) issues.push("gate contract counts indicate unconsumed doctrine.");
  if (gate.reasonCodes.includes("unconsumed-contract")) issues.push("gate carries unconsumed-contract reason code.");
  if (!sourcePresent) issues.push("matching source consumption tokens were not found.");
  for (const field of extraFields) {
    const value = (gate as unknown as Record<string, unknown>)[field];
    if (typeof value === "boolean" && !value) issues.push(`${field} must be true.`);
    if (typeof value === "number" && value < 1) issues.push(`${field} must be positive.`);
  }
  return issues.length === 0 ? pass(id, `${id} consumed bounded repo doctrine evidence.`) : fail(id, `${id} did not prove repo doctrine consumption.`, issues);
}

function reviewDetailsCheck(proof: M074S07EvidenceSnapshot, sourcePresent: boolean): M074S07Check {
  const issues: string[] = [];
  const details = proof.reviewDetails;
  if (details.status !== "applied" || !details.consumed || !details.correlationPresent) issues.push("Review Details must be applied, consumed, and correlated.");
  if (!details.aggregateOnly || details.rawDoctrineTextIncluded) issues.push("Review Details must expose aggregate diagnostics only.");
  if (details.statusLineCount < 1 || details.statusLineCount > details.maxStatusLineCount) issues.push("Review Details doctrine status line count exceeds bounds or is absent.");
  if (!sourcePresent) issues.push("source tokens for Review Details aggregate projection were not found.");
  return issues.length === 0 ? pass("review-details.aggregate", "Review Details exposes bounded aggregate doctrine diagnostics.") : fail("review-details.aggregate", "Review Details aggregate doctrine evidence failed.", issues);
}

function handlerCheck(proof: M074S07EvidenceSnapshot, sourcePresent: boolean): M074S07Check {
  const h = proof.handler;
  const issues: string[] = [];
  if (h.logGate !== "repo-doctrine" || !h.correlationPresent) issues.push("handler log gate and correlation must be present.");
  if (!h.reviewPlanProjectionPresent || !h.promptProjectionPresent || !h.reducerProjectionPresent || !h.reviewDetailsProjectionPresent) issues.push("handler must thread doctrine projection through plan, prompt, reducer, and Review Details.");
  if (!h.aggregateOnly) issues.push("handler must expose aggregate-only log fields.");
  if (!sourcePresent) issues.push("source tokens for handler repo doctrine correlation were not found.");
  return issues.length === 0 ? pass("handler.correlation", "Real review handler correlates bounded doctrine projection across review surfaces.") : fail("handler.correlation", "Handler correlation evidence is missing.", issues);
}

function validateShape(value: unknown): string[] {
  const issues: string[] = [];
  const proof = value as Partial<M074S07EvidenceSnapshot> | null;
  if (!proof || typeof proof !== "object") return ["Evidence root must be an object."];
  if (proof.schema !== "m074-s07-repo-doctrine-proof.v1") issues.push("schema must be m074-s07-repo-doctrine-proof.v1.");
  for (const field of ["source", "config", "doctrine", "reviewPlan", "prompt", "reducer", "reviewDetails", "handler", "sideEffects", "redaction"] as const) {
    if (!isRecord(proof[field])) issues.push(`${field} must be an object.`);
  }
  if (isRecord(proof.doctrine) && !Array.isArray(proof.doctrine.contractTypes)) issues.push("doctrine.contractTypes must be an array.");
  for (const field of ["config", "reviewPlan", "prompt", "reducer", "reviewDetails", "handler"] as const) {
    if (isRecord(proof[field]) && !isEvidenceGate(proof[field])) issues.push(`${field} gate fields are malformed.`);
  }
  return issues;
}

function isEvidenceGate(value: unknown): value is EvidenceGate {
  return isRecord(value)
    && ["applied", "disabled", "skipped", "degraded"].includes(String(value.status))
    && typeof value.consumed === "boolean"
    && typeof value.aggregateOnly === "boolean"
    && typeof value.contractCount === "number"
    && typeof value.matchedCount === "number"
    && typeof value.omittedCount === "number"
    && Array.isArray(value.reasonCodes);
}

function buildObserved(proof: M074S07EvidenceSnapshot, redactionSafe: boolean): M074S07Observed {
  const gates = [proof.config, proof.reviewPlan, proof.prompt, proof.reducer, proof.reviewDetails, proof.handler];
  const statusCounts: Record<string, number> = {};
  for (const gate of gates) statusCounts[gate.status] = (statusCounts[gate.status] ?? 0) + 1;
  return {
    sourceAvailable: proof.source.available,
    statusCounts,
    contractCount: proof.doctrine.contractCount,
    consumedContractCount: proof.doctrine.consumedContractCount,
    matchedPathCandidateCount: proof.doctrine.matchedPathCandidateCount,
    omittedCount: proof.doctrine.omittedContractCount + proof.doctrine.omittedMatchedPathCandidateCount,
    typeCoverageCount: proof.doctrine.contractTypes.length,
    expectedTypeCount: REPO_DOCTRINE_CONTRACT_TYPES.length,
    reasonCodes: uniqueSorted([...proof.doctrine.reasonCodes, ...gates.flatMap((gate) => gate.reasonCodes)]).slice(0, MAX_REASON_CODES) as ReasonCode[],
    sideEffects: proof.sideEffects,
    redactionPass: redactionSafe && proof.redaction.canariesAbsent,
  };
}

function validateRedaction(proof: M074S07EvidenceSnapshot, forbiddenCanariesAbsent: boolean): string[] {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(proof.redaction)) {
    if (key === "canariesAbsent") continue;
    if (value !== false) issues.push(`${key} must be false.`);
  }
  if (!proof.redaction.canariesAbsent) issues.push("canariesAbsent flag must be true.");
  if (!forbiddenCanariesAbsent) issues.push("forbidden raw key or value canary detected at bounded proof surface.");
  if (proof.prompt.rawDoctrineTextIncluded || proof.reviewDetails.rawDoctrineTextIncluded) issues.push("raw doctrine text reached prompt or Review Details evidence flags.");
  return issues;
}

function validateCaps(proof: M074S07EvidenceSnapshot): string[] {
  const issues: string[] = [];
  if (proof.doctrine.contractCount > proof.doctrine.maxContracts) issues.push("contract count exceeds fixture maxContracts.");
  if (proof.doctrine.maxContracts > REPO_DOCTRINE_LIMITS.maxContracts) issues.push("fixture maxContracts exceeds implementation cap.");
  if (proof.prompt.boundedContractLines > proof.doctrine.maxPromptContracts) issues.push("prompt contract lines exceed prompt cap.");
  if (proof.doctrine.maxPromptContracts > 8) issues.push("prompt cap exceeds implementation cap.");
  if (proof.doctrine.reasonCodes.length > proof.doctrine.maxReasonCodes) issues.push("reason code array exceeds fixture maxReasonCodes.");
  if (proof.doctrine.maxReasonCodes > REPO_DOCTRINE_LIMITS.maxReasonCodes) issues.push("fixture maxReasonCodes exceeds implementation cap.");
  if (proof.reviewDetails.statusLineCount > proof.reviewDetails.maxStatusLineCount) issues.push("Review Details status lines exceed cap.");
  return issues;
}

function validateSideEffects(proof: M074S07EvidenceSnapshot): string[] {
  const effects = proof.sideEffects;
  const issues: string[] = [];
  if (effects.botBranchCreated > 0) issues.push("bot branch creation counter is non-zero.");
  if (effects.separatePrCreated > 0) issues.push("separate PR creation counter is non-zero.");
  if (effects.directPushCount > 0) issues.push("direct push counter is non-zero.");
  if (effects.publicCommentCreated > 0) issues.push("public comment counter is non-zero.");
  if (proof.source.externalWritesPerformed) issues.push("source reports external writes performed by verifier.");
  return issues;
}

type SourceProbe = { config: boolean; contracts: boolean; reviewPlan: boolean; prompt: boolean; reducer: boolean; reviewDetails: boolean; handler: boolean };
function probeSourceTexts(texts: M074S07SourceTexts): SourceProbe {
  return {
    config: includesAll(texts.config, ["repoDoctrineSchema", "sanitizeParsedDoctrine", "review.doctrine", "using default disabled doctrine"]),
    contracts: includesAll(texts.contracts, ["REPO_DOCTRINE_CONTRACT_TYPES", "normalizeRepoDoctrineProjection", "redaction-applied", "maxContracts"]),
    reviewPlan: includesAll(texts.reviewPlan, ["repoDoctrine: normalizeRepoDoctrinePlan", "doctrine=${formatRepoDoctrinePlan", "RepoDoctrinePlanProjection"]),
    prompt: includesAll(texts.prompt, ["buildRepoDoctrinePromptSection", "Only aggregate contract metadata", "repoDoctrineSection"]),
    reducer: includesAll(texts.reducer, ["normalizeRepoDoctrineReducerProjection(input.repoDoctrine)", "doctrine=${formatRepoDoctrineReducerProjection", "toReviewReducerDetailsSummary"]),
    reviewDetails: includesAny(texts.handler, ["repoDoctrine: repoDoctrineReviewSurface", "repoDoctrine: repoDoctrineProjection"]) && includesAll(texts.reducer, ["detailsSummary", "doctrine="]),
    handler: includesAll(texts.handler, ["normalizeRepoDoctrineProjection(config.review.doctrine", "Resolved bounded repository doctrine projection", "gate: \"repo-doctrine\"", "buildRepoDoctrineLogFields"]),
  };
}

function includesAll(text: string | undefined, tokens: readonly string[]): boolean {
  return Boolean(text && tokens.every((token) => text.includes(token)));
}

function includesAny(text: string | undefined, tokens: readonly string[]): boolean {
  return Boolean(text && tokens.some((token) => text.includes(token)));
}

async function readDefaultSourceTexts(): Promise<M074S07SourceTexts> {
  const read = (path: string) => Bun.file(`${PROJECT_ROOT}/${path}`).text().catch(() => "");
  const [config, contracts, reviewPlan, prompt, reducer, handler] = await Promise.all([
    read("src/execution/config.ts"),
    read("src/repo-doctrine/contracts.ts"),
    read("src/review-orchestration/review-plan.ts"),
    read("src/execution/review-prompt.ts"),
    read("src/review-orchestration/review-reducer.ts"),
    read("src/handlers/review.ts"),
  ]);
  return { config, contracts, reviewPlan, prompt, reducer, handler };
}

async function fixtureSourceLoad(args: M074S07Args) {
  const fixturePath = args.fixturePath ?? DEFAULT_FIXTURE_PATH;
  assertSafeFixturePath(fixturePath);
  try {
    return { available: true as const, text: await Bun.file(resolveFixtureReadPath(fixturePath)).text(), fixturePath };
  } catch {
    return { available: false as const, reason: "fixture-read-failed" };
  }
}
const fixtureSource: M074S07EvidenceSource = { load: fixtureSourceLoad };

function buildReadFailure(generatedAt: string, fixturePath: string | undefined, args: M074S07Args, statusCode: M074S07StatusCode, issue: string): M074S07Report {
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

function packageWiringCheck(packageWiringPresent: boolean): M074S07Check {
  return packageWiringPresent
    ? pass("package-wiring.present", "package.json exposes verify:m074:s07.")
    : fail("package-wiring.present", "package.json verify:m074:s07 wiring is absent or drifted.", [`expected ${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`]);
}

function pass(id: M074S07CheckId, message: string): M074S07Check {
  return { id, status: "pass", message, issues: [] };
}
function fail(id: M074S07CheckId, message: string, issues: readonly string[]): M074S07Check {
  return { id, status: "fail", message, issues: boundIssues(issues) };
}
function blocked(id: M074S07CheckId, message: string, issues: readonly string[]): M074S07Check {
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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundIssues(issues: readonly string[]): readonly string[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 220 ? `${issue.slice(0, 217)}...` : issue);
}
function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}
function isStatusCode(value: string): value is M074S07StatusCode {
  return ["m074_s07_ok", "m074_s07_contract_failed", "m074_s07_malformed_evidence", "m074_s07_fixture_read_failed", "m074_s07_invalid_json", "m074_s07_invalid_arg"].includes(value);
}
function finalizeReport(report: M074S07Report, args: M074S07Args): M074S07Report {
  const expectedStatusPass = !args.expectStatus || report.statusCode === args.expectStatus;
  return {
    ...report,
    success: expectedStatusPass && (report.success || Boolean(args.expectStatus)),
    issues: boundIssues([
      ...report.issues,
      ...(expectedStatusPass ? [] : [`expect-status: expected ${args.expectStatus}, got ${report.statusCode}`]),
    ]),
  };
}

export async function main(rawArgs = Bun.argv.slice(2), options: M074S07MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let args: M074S07Args;
  try {
    args = parseM074S07Args(rawArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m074_s07_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }
  if (args.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }
  const report = await (options.evaluate ?? ((parsed) => evaluateM074S07Contract(parsed)))(args);
  if (args.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write([
      `${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`,
      `statusCode=${report.statusCode}${report.expectedStatus ? ` expected=${report.expectedStatus}` : ""}`,
      `sourceAvailable=${report.observed.sourceAvailable}`,
      `doctrine=contracts:${report.observed.contractCount},consumed:${report.observed.consumedContractCount},matched:${report.observed.matchedPathCandidateCount},omitted:${report.observed.omittedCount},types:${report.observed.typeCoverageCount}/${report.observed.expectedTypeCount}`,
      `statuses=${Object.entries(report.observed.statusCounts).map(([key, value]) => `${key}:${value}`).join(",")}`,
      `reasons=${report.observed.reasonCodes.join(",") || "none"}`,
      `sideEffects=branch:${report.observed.sideEffects.botBranchCreated},separatePr:${report.observed.sideEffects.separatePrCreated},push:${report.observed.sideEffects.directPushCount},publicComment:${report.observed.sideEffects.publicCommentCreated}`,
      `redaction=${report.observed.redactionPass ? "pass" : "fail"}`,
      ...(report.failedCheckIds.length > 0 ? [`failedCheckIds=${report.failedCheckIds.join(",")}`] : []),
      ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []),
      "",
    ].join("\n"));
  }
  return report.success ? 0 : report.statusCode === "m074_s07_invalid_arg" ? 2 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
