import { buildShadowSpecialistReviewDetailsProjection } from "../src/specialists/shadow-specialist-review-details.ts";
import { projectShadowSpecialistMetrics } from "../src/specialists/shadow-specialist-metrics.ts";
import { normalizeShadowSpecialistOutput } from "../src/specialists/shadow-specialist.ts";

export const COMMAND_NAME = "verify:m069:s04" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m069-s04.ts" as const;

export const M069_S04_CHECK_IDS = [
  "M069-S04-PACKAGE-WIRING",
  "M069-S04-TRIGGERED-EVIDENCE",
  "M069-S04-CORRELATION-SHAPE",
  "M069-S04-COUNT-METRIC-SHAPE",
  "M069-S04-REDACTION-DENIALS",
  "M069-S04-NO-RAW-PAYLOAD-LEAKAGE",
  "M069-S04-NO-VISIBLE-PUBLICATION",
] as const;

export type M069S04CheckId = (typeof M069_S04_CHECK_IDS)[number];
export type M069S04StatusCode =
  | "m069_ok"
  | "m069_blocked_live_access"
  | "m069_not_triggered"
  | "m069_degraded"
  | "m069_visible_publication_violation"
  | "m069_malformed_evidence";
export type M069S04CheckStatus = "pass" | "fail" | "skip";
export type M069S04EvidenceStatus = "ok" | "skipped" | "degraded" | "error" | "unclassifiable";

export type M069S04Check = {
  readonly id: M069S04CheckId;
  readonly passed: boolean;
  readonly status: M069S04CheckStatus;
  readonly detail: string;
};

export type M069S04Evidence = {
  readonly requestedLiveProof?: boolean;
  readonly liveAccessBlocked?: boolean;
  readonly triggered: boolean;
  readonly status: M069S04EvidenceStatus;
  readonly reason: string | null;
  readonly laneId: string | null;
  readonly reviewOutputKey: string | null;
  readonly deliveryId: string | null;
  readonly correlationKey: string | null;
  readonly reviewDetailsLine: string | null;
  readonly log: Record<string, unknown> | null;
  readonly verifier: Record<string, unknown> | null;
};

export type M069S04Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "local-fixture-static";
  readonly proofScope: "non-live-review-details-log-verifier-contract";
  readonly success: boolean;
  readonly status_code: M069S04StatusCode;
  readonly status_reason: string;
  readonly check_ids: readonly M069S04CheckId[];
  readonly checks: readonly M069S04Check[];
  readonly failing_check_id: M069S04CheckId | null;
  readonly lane: string | null;
  readonly reviewOutputKey: string | null;
  readonly deliveryId: string | null;
  readonly correlationKey: string | null;
  readonly counts: {
    readonly candidateCount: number | null;
    readonly decisionCount: number | null;
    readonly duplicateCount: number | null;
    readonly disagreementCount: number | null;
  };
  readonly metricAvailability: {
    readonly tokenCountAvailable: boolean | null;
    readonly costAvailable: boolean | null;
    readonly latencyMsAvailable: boolean | null;
  };
  readonly redactionFlags: {
    readonly discardedRawPayload: boolean | null;
    readonly discardedPublicationFields: boolean | null;
    readonly discardedApprovalFields: boolean | null;
    readonly unsafeFieldCount: number | null;
  };
  readonly publicationDenials: {
    readonly visiblePublicationDenied: boolean | null;
    readonly approvalPublicationDenied: boolean | null;
    readonly publishesFindings: boolean | null;
    readonly visibleSpecialistFindingPublished: boolean;
    readonly visibleSpecialistCommentPublished: boolean;
    readonly visibleSpecialistApprovalPublished: boolean;
  };
  readonly leakSummary: {
    readonly rawPayloadLeakCount: number;
    readonly rawPayloadLeakFields: readonly string[];
    readonly visiblePublicationFieldCount: number;
    readonly approvalFieldCount: number;
    readonly tierModeFieldCount: number;
  };
  readonly summary: {
    readonly packageScriptWired: boolean;
    readonly triggered: boolean;
    readonly liveServiceRequired: false;
    readonly readsGitignoredPaths: false;
    readonly malformedEvidence: boolean;
    readonly boundedMetricShape: boolean;
  };
  readonly issues: readonly string[];
};

export type EvaluateM069S04Options = {
  readonly generatedAt?: string;
  readonly evidence?: M069S04Evidence;
  readonly readPackageJsonText?: () => Promise<string>;
};

export type M069S04Args = {
  readonly json: boolean;
  readonly help: boolean;
};

type LineFields = {
  readonly lane: string | null;
  readonly status: string | null;
  readonly reason: string | null;
  readonly candidateCount: number | null;
  readonly decisionCount: number | null;
  readonly duplicateCount: number | null;
  readonly disagreementCount: number | null;
  readonly tokenCountAvailable: boolean | null;
  readonly costAvailable: boolean | null;
  readonly latencyMsAvailable: boolean | null;
  readonly visiblePublicationDenied: boolean | null;
  readonly approvalPublicationDenied: boolean | null;
  readonly correlationKey: string | null;
  readonly deliveryId: string | null;
  readonly reviewOutputKey: string | null;
  readonly discardedRawPayload: boolean | null;
  readonly discardedPublicationFields: boolean | null;
  readonly discardedApprovalFields: boolean | null;
  readonly unsafeFieldCount: number | null;
};

const LEAK_SENTINELS = [
  "candidate-body-visible",
  "candidate-fingerprint-visible",
  "raw prompt visible",
  "raw model visible",
  "tool payload visible",
  "inline comment visible",
  "issue comment visible",
  "approval visible",
  "tier-mode-visible",
] as const;

const RAW_LEAK_FIELDS = [
  "candidateBody",
  "candidateBodies",
  "candidateFingerprint",
  "candidateFingerprints",
  "rawPrompt",
  "prompt",
  "modelOutput",
  "rawModelOutput",
  "toolPayload",
  "body",
  "commentBody",
  "inlineComment",
  "content",
] as const;

const PUBLICATION_FIELDS = [
  "finding",
  "findings",
  "visibleFinding",
  "visibleFindings",
  "publishedFinding",
  "publishedFindings",
  "comment",
  "comments",
  "visibleComment",
  "reviewComment",
  "inlineComment",
  "issueComment",
] as const;

const APPROVAL_FIELDS = ["approval", "approvalBody", "approved", "pullReviewEvent"] as const;
const TARGETED_TEST_COMMANDS = ["bun test scripts/verify-m069-s04.test.ts", "bun run verify:m069:s04 --json"] as const;

export function parseM069S04Args(args: readonly string[]): M069S04Args {
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

export async function evaluateM069S04Contract(options: EvaluateM069S04Options = {}): Promise<M069S04Report> {
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const packageJsonText = await readPackageJsonText();
  const evidence = options.evidence ?? buildSyntheticPassingEvidence();
  const packageCheck = buildPackageWiringCheck(packageJsonText);
  const evaluation = evaluateEvidence(evidence);
  const checks = [packageCheck, ...evaluation.checks];
  const issues = [...(packageCheck.passed ? [] : [packageCheck.detail]), ...evaluation.issues];
  const failingCheck = checks.find((check) => !check.passed) ?? null;
  const statusCode = !packageCheck.passed && evaluation.status_code === "m069_ok"
    ? "m069_malformed_evidence"
    : evaluation.status_code;

  return {
    command: COMMAND_NAME,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    proofMode: "local-fixture-static",
    proofScope: "non-live-review-details-log-verifier-contract",
    success: statusCode === "m069_ok" && packageCheck.passed,
    status_code: statusCode,
    status_reason: statusCode === "m069_ok" && packageCheck.passed ? "bounded local S04 evidence passed" : issues[0] ?? evaluation.status_reason,
    check_ids: [...M069_S04_CHECK_IDS],
    checks,
    failing_check_id: failingCheck?.id ?? null,
    lane: evaluation.lane,
    reviewOutputKey: evidence.reviewOutputKey,
    deliveryId: evidence.deliveryId,
    correlationKey: evidence.correlationKey,
    counts: evaluation.counts,
    metricAvailability: evaluation.metricAvailability,
    redactionFlags: evaluation.redactionFlags,
    publicationDenials: evaluation.publicationDenials,
    leakSummary: evaluation.leakSummary,
    summary: {
      packageScriptWired: packageCheck.passed,
      triggered: evidence.triggered,
      liveServiceRequired: false,
      readsGitignoredPaths: false,
      malformedEvidence: evaluation.status_code === "m069_malformed_evidence",
      boundedMetricShape: evaluation.boundedMetricShape,
    },
    issues,
  };
}

export function buildSyntheticPassingEvidence(): M069S04Evidence {
  const projection = buildShadowSpecialistReviewDetailsProjection(projectShadowSpecialistMetrics(normalizeShadowSpecialistOutput({
    status: "ok",
    deliveryId: "m069-s04-fixture-delivery",
    reviewOutputKey: "m069-s04-fixture-review-output",
    correlationKey: "m069-s04-fixture-correlation",
    metrics: { tokenCount: 42, costUsd: 0.02, latencyMs: 7 },
    candidates: [
      { fingerprint: "candidate-fingerprint-visible", decision: "candidate", body: "candidate-body-visible" },
      { fingerprint: "duplicate-fingerprint", decision: "candidate" },
      { fingerprint: "duplicate-fingerprint", decision: "candidate" },
      { fingerprint: "disagreement-fingerprint", decision: "disagreement", disagreementCategory: "tier-mode-visible" },
      { fingerprint: "dismissed-fingerprint", decision: "dismissed", inlineComment: "inline comment visible" },
      { fingerprint: "unknown-fingerprint", decision: "unknown", commentBody: "issue comment visible" },
    ],
    prompt: "raw prompt visible",
    modelOutput: "raw model visible",
    toolPayload: { payload: "tool payload visible" },
    approval: "approval visible",
  })));

  const log = {
    laneId: projection.laneId,
    status: projection.status,
    reason: projection.reason,
    candidateCount: projection.candidateCount,
    decisionCount: projection.decisionCount,
    duplicateCount: projection.duplicateCount,
    disagreementCount: projection.disagreementCount,
    metricAvailability: projection.metricAvailability,
    tokenCountAvailable: projection.tokenCountAvailable,
    costAvailable: projection.costAvailable,
    latencyMsAvailable: projection.latencyMsAvailable,
    deliveryId: projection.deliveryId,
    reviewOutputKey: projection.reviewOutputKey,
    correlationKey: projection.correlationKey,
    discardedRawPayload: projection.redactionFlags.discardedRawPayload,
    discardedPublicationFields: projection.redactionFlags.discardedPublicationFields,
    discardedApprovalFields: projection.redactionFlags.discardedApprovalFields,
    unsafeFieldCount: projection.redactionFlags.unsafeFieldCount,
    visiblePublicationDenied: projection.visiblePublicationDenied,
    approvalPublicationDenied: projection.approvalPublicationDenied,
    publishesFindings: projection.publishesFindings,
    rawContentFieldCount: projection.rawContentFieldCount,
    candidateBodyFieldCount: projection.candidateBodyFieldCount,
    githubPublicationFieldCount: projection.githubPublicationFieldCount,
    approvalFieldCount: projection.approvalFieldCount,
    specialistContentIncluded: projection.specialistContentIncluded,
    candidateFingerprintsIncluded: projection.candidateFingerprintsIncluded,
    candidateBodiesIncluded: projection.candidateBodiesIncluded,
    rawModelOutputIncluded: projection.rawModelOutputIncluded,
    toolPayloadIncluded: projection.toolPayloadIncluded,
    approvalFieldsIncluded: projection.approvalFieldsIncluded,
    tierModeIncluded: projection.tierModeIncluded,
  };

  return {
    triggered: true,
    status: "ok",
    reason: projection.reason,
    laneId: projection.laneId,
    reviewOutputKey: projection.reviewOutputKey,
    deliveryId: projection.deliveryId,
    correlationKey: projection.correlationKey,
    reviewDetailsLine: projection.reviewDetailsLine,
    log,
    verifier: { ...log, reviewDetailsLinePresent: true },
  };
}

function evaluateEvidence(evidence: M069S04Evidence): Omit<M069S04Report,
  "command" | "generated_at" | "proofMode" | "proofScope" | "success" | "check_ids" | "checks" | "failing_check_id" | "reviewOutputKey" | "deliveryId" | "correlationKey" | "summary" | "issues" | "status_reason" | "status_code"
> & {
  readonly checks: readonly M069S04Check[];
  readonly issues: readonly string[];
  readonly status_code: M069S04StatusCode;
  readonly status_reason: string;
  readonly boundedMetricShape: boolean;
} {
  const line = parseReviewDetailsLine(evidence.reviewDetailsLine);
  const requiredShapeIssues = requiredShapeFailures(evidence, line);
  const leakSummary = summarizeLeaks(evidence);
  const visiblePublicationViolation = leakSummary.visiblePublicationFieldCount > 0
    || leakSummary.approvalFieldCount > 0
    || getBoolean(evidence.log, "visibleSpecialistFindingPublished") === true
    || getBoolean(evidence.log, "visibleSpecialistCommentPublished") === true
    || getBoolean(evidence.log, "visibleSpecialistApprovalPublished") === true
    || getBoolean(evidence.verifier, "visibleSpecialistFindingPublished") === true
    || getBoolean(evidence.verifier, "visibleSpecialistCommentPublished") === true
    || getBoolean(evidence.verifier, "visibleSpecialistApprovalPublished") === true;
  const degraded = evidence.status === "degraded" || evidence.status === "error";

  const counts = {
    candidateCount: firstNumber(line.candidateCount, getNumber(evidence.log, "candidateCount"), getNumber(evidence.verifier, "candidateCount")),
    decisionCount: firstNumber(line.decisionCount, getNumber(evidence.log, "decisionCount"), getNumber(evidence.verifier, "decisionCount")),
    duplicateCount: firstNumber(line.duplicateCount, getNumber(evidence.log, "duplicateCount"), getNumber(evidence.verifier, "duplicateCount")),
    disagreementCount: firstNumber(line.disagreementCount, getNumber(evidence.log, "disagreementCount"), getNumber(evidence.verifier, "disagreementCount")),
  };
  const metricAvailability = {
    tokenCountAvailable: firstBoolean(line.tokenCountAvailable, getBoolean(evidence.log, "tokenCountAvailable"), getBoolean(evidence.verifier, "tokenCountAvailable")),
    costAvailable: firstBoolean(line.costAvailable, getBoolean(evidence.log, "costAvailable"), getBoolean(evidence.verifier, "costAvailable")),
    latencyMsAvailable: firstBoolean(line.latencyMsAvailable, getBoolean(evidence.log, "latencyMsAvailable"), getBoolean(evidence.verifier, "latencyMsAvailable")),
  };
  const redactionFlags = {
    discardedRawPayload: firstBoolean(line.discardedRawPayload, getBoolean(evidence.log, "discardedRawPayload"), getBoolean(evidence.verifier, "discardedRawPayload")),
    discardedPublicationFields: firstBoolean(line.discardedPublicationFields, getBoolean(evidence.log, "discardedPublicationFields"), getBoolean(evidence.verifier, "discardedPublicationFields")),
    discardedApprovalFields: firstBoolean(line.discardedApprovalFields, getBoolean(evidence.log, "discardedApprovalFields"), getBoolean(evidence.verifier, "discardedApprovalFields")),
    unsafeFieldCount: firstNumber(line.unsafeFieldCount, getNumber(evidence.log, "unsafeFieldCount"), getNumber(evidence.verifier, "unsafeFieldCount")),
  };
  const publicationDenials = {
    visiblePublicationDenied: firstBoolean(line.visiblePublicationDenied, getBoolean(evidence.log, "visiblePublicationDenied"), getBoolean(evidence.verifier, "visiblePublicationDenied")),
    approvalPublicationDenied: firstBoolean(line.approvalPublicationDenied, getBoolean(evidence.log, "approvalPublicationDenied"), getBoolean(evidence.verifier, "approvalPublicationDenied")),
    publishesFindings: firstBoolean(getBoolean(evidence.log, "publishesFindings"), getBoolean(evidence.verifier, "publishesFindings")),
    visibleSpecialistFindingPublished: getBoolean(evidence.log, "visibleSpecialistFindingPublished") === true || getBoolean(evidence.verifier, "visibleSpecialistFindingPublished") === true,
    visibleSpecialistCommentPublished: getBoolean(evidence.log, "visibleSpecialistCommentPublished") === true || getBoolean(evidence.verifier, "visibleSpecialistCommentPublished") === true,
    visibleSpecialistApprovalPublished: getBoolean(evidence.log, "visibleSpecialistApprovalPublished") === true || getBoolean(evidence.verifier, "visibleSpecialistApprovalPublished") === true,
  };
  const boundedMetricShape = Object.values(counts).every((value) => typeof value === "number")
    && Object.values(metricAvailability).every((value) => typeof value === "boolean");

  const checks = [
    makeCheck("M069-S04-TRIGGERED-EVIDENCE", evidence.triggered, "bounded shadow specialist evidence was triggered", "shadow specialist evidence was not triggered"),
    makeCheck("M069-S04-CORRELATION-SHAPE", requiredShapeIssues.filter((issue) => /correlation|reviewOutputKey|deliveryId|lane|line|log|verifier/.test(issue)).length === 0, "correlation keys are present across Review Details, log, and verifier evidence", requiredShapeIssues.join(" ") || "correlation shape missing"),
    makeCheck("M069-S04-COUNT-METRIC-SHAPE", boundedMetricShape, "candidate/decision/duplicate/disagreement counts and metric availability are bounded", "count or metric availability fields are missing or malformed"),
    makeCheck("M069-S04-REDACTION-DENIALS", publicationDenials.visiblePublicationDenied === true && publicationDenials.approvalPublicationDenied === true && publicationDenials.publishesFindings === false, "redaction fields and explicit publication denial booleans are present", "publication denial booleans are missing or not deny-only"),
    makeCheck("M069-S04-NO-RAW-PAYLOAD-LEAKAGE", leakSummary.rawPayloadLeakCount === 0, "verifier JSON excludes raw payload, prompt, candidate body, fingerprint, and tier-mode sentinels", `raw payload leakage detected in bounded fields: ${leakSummary.rawPayloadLeakFields.join(", ")}`),
    makeCheck("M069-S04-NO-VISIBLE-PUBLICATION", !visiblePublicationViolation, "no visible specialist finding/comment/approval/publication fields are present", "visible specialist publication/approval fields are present"),
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => check.detail);

  let status_code: M069S04StatusCode = "m069_ok";
  let status_reason = "bounded local S04 evidence passed";
  if (evidence.requestedLiveProof && evidence.liveAccessBlocked) {
    status_code = "m069_blocked_live_access";
    status_reason = "live proof was requested but live credentials/configuration are blocked or absent";
  } else if (!evidence.triggered || evidence.status === "skipped") {
    status_code = "m069_not_triggered";
    status_reason = "shadow specialist evidence was not triggered";
  } else if (visiblePublicationViolation) {
    status_code = "m069_visible_publication_violation";
    status_reason = "visible specialist publication or approval evidence was present";
  } else if (leakSummary.rawPayloadLeakCount > 0 || requiredShapeIssues.length > 0) {
    status_code = "m069_malformed_evidence";
    status_reason = requiredShapeIssues[0] ?? "raw payload leakage makes evidence malformed";
  } else if (degraded) {
    status_code = "m069_degraded";
    status_reason = "bounded evidence reported degraded/error status";
  }

  return {
    status_code,
    status_reason,
    checks,
    lane: evidence.laneId ?? line.lane,
    counts,
    metricAvailability,
    redactionFlags,
    publicationDenials,
    leakSummary,
    issues,
    boundedMetricShape,
  };
}

function buildPackageWiringCheck(packageJsonText: string): M069S04Check {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return makeCheck("M069-S04-PACKAGE-WIRING", false, "package.json exposes verify:m069:s04 as a local verifier", "package.json must be parseable JSON");
  }
  const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
  return makeCheck(
    "M069-S04-PACKAGE-WIRING",
    scripts[COMMAND_NAME] === EXPECTED_PACKAGE_SCRIPT,
    "package.json exposes verify:m069:s04 as a local no-live-service verifier",
    `package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

function requiredShapeFailures(evidence: M069S04Evidence, line: LineFields): string[] {
  const failures: string[] = [];
  if (!evidence.reviewDetailsLine) failures.push("Review Details compact line is missing.");
  if (!evidence.log) failures.push("structured log object is missing.");
  if (!evidence.verifier) failures.push("verifier evidence object is missing.");
  if (evidence.laneId !== "docs-config-truth" || line.lane !== "docs-config-truth") failures.push("lane must be docs-config-truth in evidence and Review Details line.");
  for (const key of ["reviewOutputKey", "deliveryId", "correlationKey"] as const) {
    const value = evidence[key];
    if (!value) failures.push(`${key} is missing.`);
    if (line[key] !== value) failures.push(`${key} is absent or mismatched in Review Details line.`);
    if (getString(evidence.log, key) !== value) failures.push(`${key} is absent or mismatched in structured log.`);
    if (getString(evidence.verifier, key) !== value) failures.push(`${key} is absent or mismatched in verifier object.`);
  }
  return failures;
}

function summarizeLeaks(evidence: M069S04Evidence): M069S04Report["leakSummary"] {
  const fields: string[] = [];
  const containers = [
    ["reviewDetailsLine", evidence.reviewDetailsLine],
    ["log", evidence.log],
    ["verifier", evidence.verifier],
  ] as const;
  for (const [prefix, value] of containers) {
    collectForbiddenFields(prefix, value, fields);
    const serialized = safeStringify(value);
    for (const sentinel of LEAK_SENTINELS) {
      if (serialized.includes(sentinel)) fields.push(`${prefix}:forbidden-sentinel:${sentinelLabel(sentinel)}`);
    }
  }
  const visiblePublicationFieldCount = countForbiddenKeys(evidence.log, PUBLICATION_FIELDS) + countForbiddenKeys(evidence.verifier, PUBLICATION_FIELDS);
  const approvalFieldCount = countForbiddenKeys(evidence.log, APPROVAL_FIELDS) + countForbiddenKeys(evidence.verifier, APPROVAL_FIELDS);
  const tierModeFieldCount = countKey(evidence.log, "tierMode") + countKey(evidence.verifier, "tierMode") + fields.filter((field) => field.includes("tier-mode-visible")).length;
  return {
    rawPayloadLeakCount: fields.length,
    rawPayloadLeakFields: fields.slice(0, 20),
    visiblePublicationFieldCount,
    approvalFieldCount,
    tierModeFieldCount,
  };
}

function parseReviewDetailsLine(line: string | null): LineFields {
  const text = line ?? "";
  const metric = /metricAvailability=token:(y|n),cost:(y|n),latency:(y|n)/.exec(text);
  const redacted = /redacted=raw:(y|n),publication:(y|n),approval:(y|n),unsafe:(\d+)/.exec(text);
  return {
    lane: capture(text, /lane=([^\s]+)/),
    status: capture(text, /status=([^\s]+)/),
    reason: capture(text, /reason=([^\s]+)/),
    candidateCount: captureNumber(text, /candidateCount=(\d+)/),
    decisionCount: captureNumber(text, /decisionCount=(\d+)/),
    duplicateCount: captureNumber(text, /duplicateCount=(\d+)/),
    disagreementCount: captureNumber(text, /disagreementCount=(\d+)/),
    tokenCountAvailable: metric ? metric[1] === "y" : null,
    costAvailable: metric ? metric[2] === "y" : null,
    latencyMsAvailable: metric ? metric[3] === "y" : null,
    visiblePublicationDenied: captureBoolean(text, /visiblePublicationDenied=(true|false)/),
    approvalPublicationDenied: captureBoolean(text, /approvalPublicationDenied=(true|false)/),
    correlationKey: capture(text, /correlationKey=([^\s]+)/),
    deliveryId: capture(text, /deliveryId=([^\s]+)/),
    reviewOutputKey: capture(text, /reviewOutputKey=([^\s]+)/),
    discardedRawPayload: redacted ? redacted[1] === "y" : null,
    discardedPublicationFields: redacted ? redacted[2] === "y" : null,
    discardedApprovalFields: redacted ? redacted[3] === "y" : null,
    unsafeFieldCount: redacted ? Number(redacted[4]) : null,
  };
}

function renderM069S04Report(report: M069S04Report): string {
  return [
    "M069 S04 Review Details/log/verifier contract",
    `status: ${report.status_code}`,
    `success: ${report.success ? "yes" : "no"}`,
    `proof: ${report.proofMode} / ${report.proofScope}`,
    `correlationKey: ${report.correlationKey ?? "none"}`,
    "",
    "checks:",
    ...report.checks.map((check) => `- [${check.passed ? "x" : " "}] ${check.id}: ${check.detail}`),
    "",
    "bounded evidence:",
    `- lane: ${report.lane ?? "none"}`,
    `- reviewOutputKey: ${report.reviewOutputKey ?? "none"}`,
    `- deliveryId: ${report.deliveryId ?? "none"}`,
    `- candidateCount: ${report.counts.candidateCount ?? "missing"}`,
    `- decisionCount: ${report.counts.decisionCount ?? "missing"}`,
    `- rawPayloadLeakCount: ${report.leakSummary.rawPayloadLeakCount}`,
    `- visiblePublicationFieldCount: ${report.leakSummary.visiblePublicationFieldCount}`,
    `- approvalFieldCount: ${report.leakSummary.approvalFieldCount}`,
    "",
    "targeted tests:",
    ...TARGETED_TEST_COMMANDS.map((command) => `- ${command}`),
    ...(report.issues.length > 0 ? ["", "issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

export function renderHelp(): string {
  return [
    "M069 S04 Review Details/log/verifier contract",
    "",
    "Usage:",
    "  bun run verify:m069:s04 [--json]",
    "",
    "Notes:",
    "  - Uses package.json plus one synthetic bounded Review Details/log/verifier fixture only.",
    "  - Does not read .gsd, .planning, .audits, .env, GitHub, Azure, databases, or credentials.",
    "  - Emits counts, booleans, status, reason, lane, reviewOutputKey, deliveryId, and correlationKey only.",
    "  - Proof is local fixture/static, not live operational proof.",
    "",
  ].join("\n");
}

export async function main(args: readonly string[] = process.argv.slice(2), io?: {
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  evaluate?: typeof evaluateM069S04Contract;
}): Promise<number> {
  const stdout = io?.stdout ?? process.stdout;
  const stderr = io?.stderr ?? process.stderr;
  const evaluate = io?.evaluate ?? evaluateM069S04Contract;
  let parsed: M069S04Args;
  try {
    parsed = parseM069S04Args(args);
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
  stdout.write(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : renderM069S04Report(report));
  if (!report.success) stderr.write(`${COMMAND_NAME} failed: ${report.failing_check_id ?? report.status_code}\n`);
  return report.success ? 0 : 1;
}

function buildInvalidArgReport(issue: string): M069S04Report {
  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    proofMode: "local-fixture-static",
    proofScope: "non-live-review-details-log-verifier-contract",
    success: false,
    status_code: "m069_malformed_evidence",
    status_reason: "invalid CLI argument",
    check_ids: [...M069_S04_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    lane: null,
    reviewOutputKey: null,
    deliveryId: null,
    correlationKey: null,
    counts: { candidateCount: null, decisionCount: null, duplicateCount: null, disagreementCount: null },
    metricAvailability: { tokenCountAvailable: null, costAvailable: null, latencyMsAvailable: null },
    redactionFlags: { discardedRawPayload: null, discardedPublicationFields: null, discardedApprovalFields: null, unsafeFieldCount: null },
    publicationDenials: {
      visiblePublicationDenied: null,
      approvalPublicationDenied: null,
      publishesFindings: null,
      visibleSpecialistFindingPublished: false,
      visibleSpecialistCommentPublished: false,
      visibleSpecialistApprovalPublished: false,
    },
    leakSummary: { rawPayloadLeakCount: 0, rawPayloadLeakFields: [], visiblePublicationFieldCount: 0, approvalFieldCount: 0, tierModeFieldCount: 0 },
    summary: { packageScriptWired: false, triggered: false, liveServiceRequired: false, readsGitignoredPaths: false, malformedEvidence: true, boundedMetricShape: false },
    issues: [issue],
  };
}

function makeCheck(id: M069S04CheckId, passed: boolean, okDetail: string, failDetail: string): M069S04Check {
  return { id, passed, status: passed ? "pass" : "fail", detail: passed ? okDetail : failDetail };
}

function collectForbiddenFields(prefix: string, value: unknown, fields: string[]): void {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if ((RAW_LEAK_FIELDS as readonly string[]).includes(key)) fields.push(`${prefix}.${key}`);
    if (isRecord(child)) collectForbiddenFields(`${prefix}.${key}`, child, fields);
    if (Array.isArray(child)) {
      child.forEach((item, index) => collectForbiddenFields(`${prefix}.${key}[${index}]`, item, fields));
    }
  }
}

function countForbiddenKeys(value: unknown, keys: readonly string[]): number {
  if (!isRecord(value)) return 0;
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key)) count += 1;
    if (isRecord(child)) count += countForbiddenKeys(child, keys);
    if (Array.isArray(child)) count += child.reduce((sum, item) => sum + countForbiddenKeys(item, keys), 0);
  }
  return count;
}

function countKey(value: unknown, needle: string): number {
  return countForbiddenKeys(value, [needle]);
}

function sentinelLabel(sentinel: string): string {
  if (sentinel.includes("tier-mode")) return "tier-mode";
  if (sentinel.includes("fingerprint")) return "candidate-fingerprint";
  if (sentinel.includes("candidate-body")) return "candidate-body";
  if (sentinel.includes("prompt")) return "prompt";
  if (sentinel.includes("model")) return "model-output";
  if (sentinel.includes("tool payload")) return "tool-payload";
  if (sentinel.includes("inline comment")) return "inline-comment";
  if (sentinel.includes("issue comment")) return "issue-comment";
  if (sentinel.includes("approval")) return "approval";
  return "unknown";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function capture(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[1] ?? null;
}

function captureNumber(text: string, pattern: RegExp): number | null {
  const value = capture(text, pattern);
  return value === null ? null : Number(value);
}

function captureBoolean(text: string, pattern: RegExp): boolean | null {
  const value = capture(text, pattern);
  return value === null ? null : value === "true";
}

function getString(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : null;
}

function getNumber(value: unknown, key: string): number | null {
  return isRecord(value) && typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : null;
}

function getBoolean(value: unknown, key: string): boolean | null {
  return isRecord(value) && typeof value[key] === "boolean" ? value[key] : null;
}

function firstNumber(...values: readonly (number | null)[]): number | null {
  return values.find((value): value is number => typeof value === "number") ?? null;
}

function firstBoolean(...values: readonly (boolean | null)[]): boolean | null {
  return values.find((value): value is boolean => typeof value === "boolean") ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
