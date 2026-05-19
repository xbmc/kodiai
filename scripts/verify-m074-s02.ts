import { attachReviewFindingLifecycle, type BoundedReviewFindingSummary } from "../src/review-lifecycle/handler-lifecycle.ts";
import { createReviewCandidateFindingExecutionResult } from "../src/review-orchestration/review-candidate-finding.ts";

export const COMMAND_NAME = "verify:m074:s02" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m074-s02.ts" as const;

export type M074S02Check = {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type M074S02Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: "m074_s02_ok" | "m074_s02_contract_failed" | "m074_s02_invalid_arg";
  readonly gate: "review-finding-lifecycle";
  readonly automatic: TriggerSummary;
  readonly mention: TriggerSummary;
  readonly equivalentAggregateProjection: boolean;
  readonly stableIdDeterministic: boolean;
  readonly boundedReferences: boolean;
  readonly redactionFlags: TriggerSummary["redaction"];
  readonly checks: readonly M074S02Check[];
  readonly issues: readonly string[];
};

export type TriggerSummary = {
  readonly source: "automatic" | "mention";
  readonly trigger: string;
  readonly normalizedStatus: string;
  readonly reviewOutputKeyPresent: boolean;
  readonly deliveryIdPresent: boolean;
  readonly counts: {
    readonly input: number;
    readonly recorded: number;
    readonly rejected: number;
    readonly unsafeInputFields: number;
  };
  readonly statusSummary: Record<string, number>;
  readonly severitySummary: Record<string, number>;
  readonly actionabilitySummary: Record<string, number>;
  readonly validationNeedSummary: Record<string, number>;
  readonly revalidationStateSummary: Record<string, number>;
  readonly rejectionReasonCodes: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly referenceCount: number;
  readonly omittedReferences: number;
  readonly redaction: {
    readonly privateOnly: true;
    readonly rawPromptsIncluded: false;
    readonly rawModelOutputIncluded: false;
    readonly candidateBodiesIncluded: false;
    readonly toolPayloadsIncluded: false;
    readonly secretLikeStringsIncluded: false;
    readonly diffsIncluded: false;
    readonly unboundedArraysIncluded: false;
    readonly unsafeInputFieldCount: number;
  };
};

export type M074S02Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type M074S02EvaluationOptions = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly automaticFindings?: readonly BoundedReviewFindingSummary[];
  readonly mentionFindings?: readonly BoundedReviewFindingSummary[];
};

const HELP_TEXT = `Usage: bun scripts/verify-m074-s02.ts [--json] [--help]\n\nVerifies automatic and @kodiai mention review trigger lifecycle attachment equivalence with bounded in-memory fixtures.\n`;

const CORRELATION = {
  repo: "acme/widgets",
  pullNumber: 74,
  reviewOutputKey: "m074-s02-review-output",
  deliveryId: "delivery-m074-s02",
  commitSha: "abc123def456",
  headRef: "feature/m074-s02",
  baseRef: "main",
} as const;

const FORBIDDEN_CANARIES = [
  "PRIVATE_BODY_CANARY",
  "RAW_PROMPT_CANARY",
  "RAW_MODEL_OUTPUT_CANARY",
  "CANDIDATE_BODY_CANARY",
  "TOOL_PAYLOAD_CANARY",
  "SECRET_TOKEN_CANARY",
  "sk-supersecret12345",
  "DIFF_TEXT_CANARY",
  "diff --git",
] as const;

function finding(index: number, overrides: Partial<BoundedReviewFindingSummary> = {}): BoundedReviewFindingSummary {
  return {
    filePath: `src/review-${index}.ts`,
    startLine: index + 10,
    endLine: index + 10,
    severity: index % 2 === 0 ? "major" : "critical",
    category: index % 2 === 0 ? "correctness" : "security",
    title: `Lifecycle trigger finding ${index}`,
    confidence: 90,
    actionability: index % 2 === 0 ? "actionable" : "needs-reproduction",
    validationNeeds: index % 2 === 0 ? ["needs-tests"] : ["needs-security-review"],
    revalidationState: index % 3 === 0 ? "pending" : "not-required",
    reasonCodes: [`trigger-reason-${index}`],
    commentId: `comment-${index}`,
    candidateFingerprint: `candidate-${index}`,
    ...overrides,
  };
}

function candidateFinding() {
  return createReviewCandidateFindingExecutionResult({
    repo: CORRELATION.repo,
    pullNumber: CORRELATION.pullNumber,
    reviewOutputKey: CORRELATION.reviewOutputKey,
    deliveryId: CORRELATION.deliveryId,
    artifactPresent: true,
    candidates: [
      {
        filePath: "src/candidate.ts",
        startLine: 33,
        severity: "major",
        category: "correctness",
        title: "Candidate lifecycle attachment is bounded",
        body: "PRIVATE_BODY_CANARY candidate body must stay private",
        evidence: "PRIVATE_BODY_CANARY candidate evidence must stay private",
      },
    ],
  });
}

export function parseM074S02Args(args: readonly string[]): M074S02Args {
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

export async function evaluateM074S02Contract(options: M074S02EvaluationOptions = {}): Promise<M074S02Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const automaticResult = attachReviewFindingLifecycle({
    source: "automatic",
    trigger: "pull_request",
    correlation: CORRELATION,
    findings: options.automaticFindings ?? [finding(0), finding(1)],
    candidateFinding: candidateFinding(),
  });
  const mentionResult = attachReviewFindingLifecycle({
    source: "mention",
    trigger: "issue_comment",
    correlation: CORRELATION,
    findings: options.mentionFindings ?? [finding(0), finding(1)],
    candidateFinding: candidateFinding(),
  });
  const repeatResult = attachReviewFindingLifecycle({
    source: "automatic",
    trigger: "pull_request",
    correlation: CORRELATION,
    findings: [finding(0, { commentId: "different-comment" })],
  });
  const missingCorrelationResult = attachReviewFindingLifecycle({
    source: "mention",
    trigger: "issue_comment",
    correlation: { ...CORRELATION, reviewOutputKey: "" },
    findings: [finding(10), finding(11)],
  });
  const unsafeResult = attachReviewFindingLifecycle({
    source: "automatic",
    trigger: "pull_request",
    correlation: CORRELATION,
    findings: [
      {
        ...finding(20, { title: "Unsafe raw finding" }),
        body: "PRIVATE_BODY_CANARY token=sk-supersecret12345",
        rawPrompt: "RAW_PROMPT_CANARY BEGIN PROMPT",
        rawModelOutput: "RAW_MODEL_OUTPUT_CANARY model output",
        candidateBody: "CANDIDATE_BODY_CANARY candidate body",
        toolPayload: { private: "TOOL_PAYLOAD_CANARY" },
        diffText: "DIFF_TEXT_CANARY diff --git a/file b/file",
      } as BoundedReviewFindingSummary,
      finding(21),
    ],
  });

  const packageJsonText = await readPackageJsonText();
  const automatic = summarizeTrigger(automaticResult);
  const mention = summarizeTrigger(mentionResult);
  const automaticComparable = comparableAggregate(automatic);
  const mentionComparable = comparableAggregate(mention);
  const equivalentAggregateProjection = JSON.stringify(automaticComparable) === JSON.stringify(mentionComparable);
  const stableIdDeterministic = automaticResult.lifecycle.records[0]?.id === repeatResult.lifecycle.records[0]?.id;
  const boundedReferences = automaticResult.projection.references.length <= 5
    && mentionResult.projection.references.length <= 5
    && automaticResult.projection.reasonCodes.length <= 8
    && mentionResult.projection.reasonCodes.length <= 8;
  const safeProjectionJson = JSON.stringify({ automatic, mention, unsafe: unsafeResult.projection });
  const forbiddenCanariesAbsent = FORBIDDEN_CANARIES.every((canary) => !safeProjectionJson.includes(canary));
  const missingCorrelationFailsClosed = missingCorrelationResult.status === "unavailable"
    && missingCorrelationResult.lifecycle.records.length === 0
    && missingCorrelationResult.lifecycle.counts.rejected === 2
    && missingCorrelationResult.projection.rejectedReasonCodes.includes("missing-correlation");
  const packageWiringPresent = hasExpectedPackageScript(packageJsonText);

  const checks: M074S02Check[] = [
    {
      id: "automatic-mention-equivalence",
      passed: equivalentAggregateProjection,
      detail: `automaticRecorded=${automatic.counts.recorded} mentionRecorded=${mention.counts.recorded}`,
    },
    {
      id: "gate-log-evidence",
      passed: automaticResult.logEvidence.gate === "review-finding-lifecycle"
        && mentionResult.logEvidence.gate === "review-finding-lifecycle"
        && automatic.reviewOutputKeyPresent
        && mention.deliveryIdPresent,
      detail: `gate=${automaticResult.logEvidence.gate} automaticStatus=${automatic.normalizedStatus} mentionStatus=${mention.normalizedStatus}`,
    },
    {
      id: "stable-id-determinism",
      passed: stableIdDeterministic,
      detail: `stableIds=${stableIdDeterministic ? "pass" : "fail"}`,
    },
    {
      id: "bounded-references",
      passed: boundedReferences,
      detail: `automaticRefs=${automatic.referenceCount} mentionRefs=${mention.referenceCount}`,
    },
    {
      id: "redaction-flags-and-canaries",
      passed: automatic.redaction.privateOnly === true
        && mention.redaction.privateOnly === true
        && automatic.redaction.rawPromptsIncluded === false
        && mention.redaction.rawModelOutputIncluded === false
        && forbiddenCanariesAbsent,
      detail: `redaction=${forbiddenCanariesAbsent ? "pass" : "fail"}`,
    },
    {
      id: "missing-correlation-negative",
      passed: missingCorrelationFailsClosed,
      detail: `status=${missingCorrelationResult.status} rejected=${missingCorrelationResult.lifecycle.counts.rejected}`,
    },
    {
      id: "package-wiring",
      passed: packageWiringPresent,
      detail: `expected=${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`,
    },
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.detail}`);

  return {
    command: COMMAND_NAME,
    generatedAt,
    success: issues.length === 0,
    statusCode: issues.length === 0 ? "m074_s02_ok" : "m074_s02_contract_failed",
    gate: "review-finding-lifecycle",
    automatic,
    mention,
    equivalentAggregateProjection,
    stableIdDeterministic,
    boundedReferences,
    redactionFlags: automatic.redaction,
    checks,
    issues,
  };
}

type AttachResult = ReturnType<typeof attachReviewFindingLifecycle>;

function summarizeTrigger(result: AttachResult): TriggerSummary {
  return {
    source: result.source,
    trigger: result.trigger,
    normalizedStatus: result.status,
    reviewOutputKeyPresent: result.projection.correlation.reviewOutputKeyPresent,
    deliveryIdPresent: result.projection.correlation.deliveryIdPresent,
    counts: {
      input: result.projection.counts.input,
      recorded: result.projection.counts.recorded,
      rejected: result.projection.counts.rejected,
      unsafeInputFields: result.projection.counts.unsafeInputFields,
    },
    statusSummary: result.projection.counts.status,
    severitySummary: result.projection.counts.severity,
    actionabilitySummary: result.projection.counts.actionability,
    validationNeedSummary: result.projection.counts.validationNeeds,
    revalidationStateSummary: result.projection.counts.revalidationState,
    rejectionReasonCodes: result.projection.rejectedReasonCodes,
    reasonCodes: result.projection.reasonCodes,
    referenceCount: result.projection.references.length,
    omittedReferences: result.projection.omitted.references,
    redaction: result.projection.redaction,
  };
}

function comparableAggregate(summary: TriggerSummary): Omit<TriggerSummary, "source" | "trigger" | "reasonCodes"> {
  const { source: _source, trigger: _trigger, reasonCodes: _reasonCodes, ...rest } = summary;
  return rest;
}

function hasExpectedPackageScript(packageJsonText: string): boolean {
  try {
    const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> };
    return parsed.scripts?.[COMMAND_NAME] === EXPECTED_PACKAGE_SCRIPT;
  } catch {
    return packageJsonText.includes(`"${COMMAND_NAME}": "${EXPECTED_PACKAGE_SCRIPT}"`)
      || packageJsonText.includes(`"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"`);
  }
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  let parsed: M074S02Args;
  try {
    parsed = parseM074S02Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    process.stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m074_s02_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const report = await evaluateM074S02Contract();
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write([
      `${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`,
      `gate=${report.gate}`,
      `automatic=${JSON.stringify(report.automatic.counts)} status=${report.automatic.normalizedStatus}`,
      `mention=${JSON.stringify(report.mention.counts)} status=${report.mention.normalizedStatus}`,
      `equivalentAggregateProjection=${report.equivalentAggregateProjection ? "pass" : "fail"}`,
      `stableIds=${report.stableIdDeterministic ? "pass" : "fail"}`,
      `boundedReferences=${report.boundedReferences ? "pass" : "fail"}`,
      `redaction=${report.checks.find((check) => check.id === "redaction-flags-and-canaries")?.passed ? "pass" : "fail"}`,
      ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []),
      "",
    ].join("\n"));
  }
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
