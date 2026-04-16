import type { ReviewPhaseTiming } from "../src/execution/types.ts";
import { parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import {
  discoverAuditWorkspaceIds,
  evaluateM048S01,
  formatDuration,
  type M048S01OutcomeClass,
  type M048S01Report,
} from "./verify-m048-s01.ts";

const TARGET_LATENCY_PHASES = [
  "workspace preparation",
  "executor handoff",
  "remote runtime",
] as const;

export type M048S02StatusCode =
  | "m048_s02_ok"
  | "m048_s02_skipped_missing_review_output_keys"
  | "m048_s02_invalid_arg"
  | "m048_s02_inconclusive"
  | "m048_s02_no_improvement"
  | "m048_s02_timeout_class_persisted"
  | "m048_s02_timeout_class_regressed"
  | "m048_s02_publication_regressed";

export type M048S02ComparisonOutcome = "latency-improved" | "no-improvement" | "inconclusive";
export type M048S02DeltaDirection = "faster" | "slower" | "unchanged" | "unavailable";
export type M048S02PublicationContinuityState = "preserved" | "regressed" | "improved" | "unknown";
export type M048S02TimeoutClassState = "retired" | "persisted" | "introduced" | "preserved" | "unknown";

type CompareTarget = {
  reviewOutputKey: string;
  deliveryId: string;
};

type ParsedArgs = {
  help?: boolean;
  json?: boolean;
  baselineReviewOutputKey: string | null;
  baselineDeliveryId: string | null;
  candidateReviewOutputKey: string | null;
  candidateDeliveryId: string | null;
};

export type M048S02PhaseDelta = {
  name: (typeof TARGET_LATENCY_PHASES)[number];
  baseline: ReviewPhaseTiming | null;
  candidate: ReviewPhaseTiming | null;
  deltaMs: number | null;
  direction: M048S02DeltaDirection;
};

export type M048S02PublicationContinuity = {
  state: M048S02PublicationContinuityState;
  baselinePublished: boolean | null;
  candidatePublished: boolean | null;
  baselinePhase: ReviewPhaseTiming | null;
  candidatePhase: ReviewPhaseTiming | null;
  issue: string | null;
};

export type M048S02TimeoutClass = {
  state: M048S02TimeoutClassState;
  baselineClass: M048S01OutcomeClass;
  candidateClass: M048S01OutcomeClass;
  issue: string | null;
};

export type M048S02Report = {
  command: "verify:m048:s02";
  generated_at: string;
  success: boolean;
  status_code: M048S02StatusCode;
  baseline: M048S01Report;
  candidate: M048S01Report;
  comparison: {
    outcome: M048S02ComparisonOutcome;
    targetedPhases: M048S02PhaseDelta[];
    targetedTotal: {
      baselineMs: number | null;
      candidateMs: number | null;
      deltaMs: number | null;
      direction: M048S02DeltaDirection;
    };
    timeoutClass: M048S02TimeoutClass;
    publicationContinuity: M048S02PublicationContinuity;
  };
  issues: string[];
};

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function readOptionValue(args: string[], index: number): { value: string | null; consumed: boolean } {
  const candidate = args[index + 1];
  if (typeof candidate !== "string" || candidate.startsWith("--")) {
    return {
      value: null,
      consumed: false,
    };
  }

  return {
    value: candidate,
    consumed: true,
  };
}

export function parseVerifyM048S02Args(args: string[]): ParsedArgs {
  let baselineReviewOutputKey: string | null = null;
  let baselineDeliveryId: string | null = null;
  let candidateReviewOutputKey: string | null = null;
  let candidateDeliveryId: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--baseline-review-output-key") {
      const { value, consumed } = readOptionValue(args, index);
      baselineReviewOutputKey = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    if (arg === "--baseline-delivery-id") {
      const { value, consumed } = readOptionValue(args, index);
      baselineDeliveryId = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    if (arg === "--candidate-review-output-key") {
      const { value, consumed } = readOptionValue(args, index);
      candidateReviewOutputKey = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    if (arg === "--candidate-delivery-id") {
      const { value, consumed } = readOptionValue(args, index);
      candidateDeliveryId = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    baselineReviewOutputKey,
    baselineDeliveryId,
    candidateReviewOutputKey,
    candidateDeliveryId,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m048:s02 -- --baseline-review-output-key <key> --candidate-review-output-key <key> [--baseline-delivery-id <id>] [--candidate-delivery-id <id>] [--json]",
    "",
    "Options:",
    "  --baseline-review-output-key  Required baseline reviewOutputKey to compare",
    "  --baseline-delivery-id        Optional baseline delivery id override; must match the encoded key when both are provided",
    "  --candidate-review-output-key Required candidate reviewOutputKey to compare",
    "  --candidate-delivery-id       Optional candidate delivery id override; must match the encoded key when both are provided",
    "  --json                        Print machine-readable JSON output",
    "  --help                        Show this help",
    "",
    "Environment:",
    "  ACA_RESOURCE_GROUP / AZURE_LOG_WORKSPACE_IDS  Optional Azure workspace discovery overrides",
  ].join("\n");
}

function validateTarget(options: {
  label: "Baseline" | "Candidate";
  reviewOutputKey: string | null;
  deliveryId: string | null;
  reviewOutputKeyOptionName: string;
  deliveryIdOptionName: string;
}): { target: CompareTarget | null; issues: string[] } {
  const issues: string[] = [];
  const normalizedReviewOutputKey = normalizeIdentifier(options.reviewOutputKey);
  if (!normalizedReviewOutputKey) {
    issues.push(`Missing required ${options.reviewOutputKeyOptionName}.`);
    return { target: null, issues };
  }

  const parsedKey = parseReviewOutputKey(normalizedReviewOutputKey);
  const encodedDeliveryId = parsedKey?.effectiveDeliveryId ?? null;
  const normalizedDeliveryId = normalizeIdentifier(options.deliveryId);

  if (normalizedDeliveryId && encodedDeliveryId && normalizedDeliveryId !== encodedDeliveryId) {
    issues.push(
      `${options.label} ${options.deliveryIdOptionName} does not match the delivery id encoded in ${options.reviewOutputKeyOptionName}.`,
    );
  }

  const deliveryId = normalizedDeliveryId ?? encodedDeliveryId;
  if (!deliveryId) {
    issues.push(
      `Could not determine ${options.label.toLowerCase()} delivery id from ${options.reviewOutputKeyOptionName}; provide ${options.deliveryIdOptionName} explicitly.`,
    );
  }

  return issues.length > 0
    ? { target: null, issues }
    : {
      target: {
        reviewOutputKey: normalizedReviewOutputKey,
        deliveryId: deliveryId!,
      },
      issues,
    };
}

function validateArgs(options: ParsedArgs): {
  baseline: CompareTarget;
  candidate: CompareTarget;
} | {
  issues: string[];
} {
  const baseline = validateTarget({
    label: "Baseline",
    reviewOutputKey: options.baselineReviewOutputKey,
    deliveryId: options.baselineDeliveryId,
    reviewOutputKeyOptionName: "--baseline-review-output-key",
    deliveryIdOptionName: "--baseline-delivery-id",
  });
  const candidate = validateTarget({
    label: "Candidate",
    reviewOutputKey: options.candidateReviewOutputKey,
    deliveryId: options.candidateDeliveryId,
    reviewOutputKeyOptionName: "--candidate-review-output-key",
    deliveryIdOptionName: "--candidate-delivery-id",
  });

  const issues = [...baseline.issues, ...candidate.issues];
  return issues.length > 0 || !baseline.target || !candidate.target
    ? { issues }
    : {
      baseline: baseline.target,
      candidate: candidate.target,
    };
}

function createPlaceholderS01Report(params: {
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
  statusCode?: M048S01Report["status_code"];
  success?: boolean;
  sourceAvailability?: M048S01Report["sourceAvailability"]["azureLogs"];
  issues?: string[];
}): M048S01Report {
  return {
    command: "verify:m048:s01",
    generated_at: new Date().toISOString(),
    review_output_key: params.reviewOutputKey ?? null,
    delivery_id: params.deliveryId ?? null,
    success: params.success ?? false,
    status_code: params.statusCode ?? "m048_s01_invalid_arg",
    sourceAvailability: {
      azureLogs: params.sourceAvailability ?? "missing",
    },
    query: {
      text: null,
      timespan: "P14D",
      workspaceCount: 0,
      matchedRowCount: 0,
      duplicateRowCount: 0,
      driftedRowCount: 0,
    },
    outcome: {
      class: "unknown",
      conclusion: null,
      published: null,
      summary: "no correlated phase evidence available",
    },
    evidence: null,
    issues: params.issues ?? [],
  };
}

function createBaseReport(params: {
  generatedAt?: string;
  statusCode: M048S02StatusCode;
  success: boolean;
  baseline: M048S01Report;
  candidate: M048S01Report;
  comparison?: M048S02Report["comparison"];
  issues?: string[];
}): M048S02Report {
  return {
    command: "verify:m048:s02",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: params.success,
    status_code: params.statusCode,
    baseline: params.baseline,
    candidate: params.candidate,
    comparison: params.comparison ?? {
      outcome: "inconclusive",
      targetedPhases: TARGET_LATENCY_PHASES.map((name) => ({
        name,
        baseline: null,
        candidate: null,
        deltaMs: null,
        direction: "unavailable",
      })),
      targetedTotal: {
        baselineMs: null,
        candidateMs: null,
        deltaMs: null,
        direction: "unavailable",
      },
      timeoutClass: {
        state: "unknown",
        baselineClass: "unknown",
        candidateClass: "unknown",
        issue: null,
      },
      publicationContinuity: {
        state: "unknown",
        baselinePublished: null,
        candidatePublished: null,
        baselinePhase: null,
        candidatePhase: null,
        issue: null,
      },
    },
    issues: params.issues ?? [],
  };
}

function getPhase(report: M048S01Report, name: ReviewPhaseTiming["name"]): ReviewPhaseTiming | null {
  return report.evidence?.phases.find((phase) => phase.name === name) ?? null;
}

function toDeltaDirection(deltaMs: number | null): M048S02DeltaDirection {
  if (deltaMs === null) {
    return "unavailable";
  }
  if (deltaMs < 0) {
    return "faster";
  }
  if (deltaMs > 0) {
    return "slower";
  }
  return "unchanged";
}

function buildTargetedPhaseDeltas(baseline: M048S01Report, candidate: M048S01Report): M048S02PhaseDelta[] {
  return TARGET_LATENCY_PHASES.map((name) => {
    const baselinePhase = getPhase(baseline, name);
    const candidatePhase = getPhase(candidate, name);
    const baselineDuration = baselinePhase?.status === "unavailable" ? null : baselinePhase?.durationMs ?? null;
    const candidateDuration = candidatePhase?.status === "unavailable" ? null : candidatePhase?.durationMs ?? null;
    const deltaMs = baselineDuration === null || candidateDuration === null
      ? null
      : candidateDuration - baselineDuration;

    return {
      name,
      baseline: baselinePhase,
      candidate: candidatePhase,
      deltaMs,
      direction: toDeltaDirection(deltaMs),
    };
  });
}

function buildTargetedTotal(targetedPhases: M048S02PhaseDelta[]): M048S02Report["comparison"]["targetedTotal"] {
  if (targetedPhases.some((phase) => phase.deltaMs === null || phase.baseline?.durationMs === undefined || phase.candidate?.durationMs === undefined)) {
    return {
      baselineMs: null,
      candidateMs: null,
      deltaMs: null,
      direction: "unavailable",
    };
  }

  const baselineMs = targetedPhases.reduce((sum, phase) => sum + phase.baseline!.durationMs!, 0);
  const candidateMs = targetedPhases.reduce((sum, phase) => sum + phase.candidate!.durationMs!, 0);
  const deltaMs = candidateMs - baselineMs;

  return {
    baselineMs,
    candidateMs,
    deltaMs,
    direction: toDeltaDirection(deltaMs),
  };
}

function isTimeoutClass(outcomeClass: M048S01OutcomeClass): boolean {
  return outcomeClass === "timeout" || outcomeClass === "timeout_partial";
}

function buildTimeoutClass(baseline: M048S01Report, candidate: M048S01Report): M048S02TimeoutClass {
  const baselineClass = baseline.outcome.class;
  const candidateClass = candidate.outcome.class;

  if (baselineClass === "unknown" || candidateClass === "unknown") {
    return {
      state: "unknown",
      baselineClass,
      candidateClass,
      issue: "Timeout-class comparison is unavailable because one side lacks correlated phase evidence.",
    };
  }

  if (isTimeoutClass(baselineClass) && !isTimeoutClass(candidateClass)) {
    return {
      state: "retired",
      baselineClass,
      candidateClass,
      issue: null,
    };
  }

  if (isTimeoutClass(baselineClass) && isTimeoutClass(candidateClass)) {
    return {
      state: "persisted",
      baselineClass,
      candidateClass,
      issue: `Candidate remained in the small-PR timeout class (${candidateClass}) instead of retiring it.`,
    };
  }

  if (!isTimeoutClass(baselineClass) && isTimeoutClass(candidateClass)) {
    return {
      state: "introduced",
      baselineClass,
      candidateClass,
      issue: `Candidate regressed into the small-PR timeout class (${candidateClass}) even though baseline was ${baselineClass}.`,
    };
  }

  return {
    state: "preserved",
    baselineClass,
    candidateClass,
    issue: null,
  };
}

function buildPublicationContinuity(
  baseline: M048S01Report,
  candidate: M048S01Report,
): M048S02PublicationContinuity {
  const baselinePhase = getPhase(baseline, "publication");
  const candidatePhase = getPhase(candidate, "publication");
  const baselinePublished = baseline.evidence?.published ?? null;
  const candidatePublished = candidate.evidence?.published ?? null;

  if (!baseline.evidence || !candidate.evidence || !baselinePhase || !candidatePhase) {
    return {
      state: "unknown",
      baselinePublished,
      candidatePublished,
      baselinePhase,
      candidatePhase,
      issue: "Publication continuity could not be evaluated because one side lacks phase evidence.",
    };
  }

  if (baselinePublished === true && candidatePublished !== true) {
    return {
      state: "regressed",
      baselinePublished,
      candidatePublished,
      baselinePhase,
      candidatePhase,
      issue: "Candidate lost publication continuity: baseline published successfully but candidate did not.",
    };
  }

  if (baselinePhase.status === "completed" && candidatePhase.status !== "completed") {
    return {
      state: "regressed",
      baselinePublished,
      candidatePublished,
      baselinePhase,
      candidatePhase,
      issue: `Candidate lost publication continuity: publication phase became ${candidatePhase.status}.`,
    };
  }

  if (baselinePublished === false && candidatePublished === true && candidatePhase.status === "completed") {
    return {
      state: "improved",
      baselinePublished,
      candidatePublished,
      baselinePhase,
      candidatePhase,
      issue: null,
    };
  }

  if (baselinePublished === candidatePublished && baselinePhase.status === candidatePhase.status) {
    return {
      state: "preserved",
      baselinePublished,
      candidatePublished,
      baselinePhase,
      candidatePhase,
      issue: null,
    };
  }

  return {
    state: "unknown",
    baselinePublished,
    candidatePublished,
    baselinePhase,
    candidatePhase,
    issue: "Publication continuity changed in a way that needs operator review.",
  };
}

function buildComparison(baseline: M048S01Report, candidate: M048S01Report): {
  success: boolean;
  statusCode: M048S02StatusCode;
  comparison: M048S02Report["comparison"];
  issues: string[];
} {
  const issues: string[] = [];
  if (!baseline.success || !baseline.evidence) {
    issues.push(`Baseline evidence is unavailable: ${baseline.status_code}.`);
  }
  if (!candidate.success || !candidate.evidence) {
    issues.push(`Candidate evidence is unavailable: ${candidate.status_code}.`);
  }

  const targetedPhases = buildTargetedPhaseDeltas(baseline, candidate);
  const targetedTotal = buildTargetedTotal(targetedPhases);
  const timeoutClass = buildTimeoutClass(baseline, candidate);
  const publicationContinuity = buildPublicationContinuity(baseline, candidate);
  const comparison: M048S02Report["comparison"] = {
    outcome: "inconclusive",
    targetedPhases,
    targetedTotal,
    timeoutClass,
    publicationContinuity,
  };

  for (const phase of targetedPhases) {
    if (phase.candidate?.status === "degraded") {
      issues.push(`Candidate ${phase.name} phase is degraded${phase.candidate.detail ? `: ${phase.candidate.detail}` : "."}`);
    }
    if (phase.candidate?.status === "unavailable") {
      issues.push(`Candidate ${phase.name} phase is unavailable${phase.candidate.detail ? `: ${phase.candidate.detail}` : "."}`);
    }
  }

  if (issues.some((issue) => issue.startsWith("Baseline evidence is unavailable") || issue.startsWith("Candidate evidence is unavailable"))) {
    return {
      success: false,
      statusCode: "m048_s02_inconclusive",
      comparison,
      issues,
    };
  }

  if (timeoutClass.issue) {
    issues.push(timeoutClass.issue);
  }

  if (targetedTotal.deltaMs === null) {
    issues.push("Targeted latency delta is unavailable because one or more targeted phases lack numeric durations.");
    return {
      success: false,
      statusCode: "m048_s02_inconclusive",
      comparison,
      issues,
    };
  }

  comparison.outcome = targetedTotal.deltaMs < 0 ? "latency-improved" : "no-improvement";

  if (timeoutClass.state === "persisted") {
    if (publicationContinuity.issue) {
      issues.push(publicationContinuity.issue);
    }
    return {
      success: false,
      statusCode: "m048_s02_timeout_class_persisted",
      comparison,
      issues,
    };
  }

  if (timeoutClass.state === "introduced") {
    if (publicationContinuity.issue) {
      issues.push(publicationContinuity.issue);
    }
    return {
      success: false,
      statusCode: "m048_s02_timeout_class_regressed",
      comparison,
      issues,
    };
  }

  if (publicationContinuity.issue) {
    issues.push(publicationContinuity.issue);
  }

  if (publicationContinuity.state === "regressed") {
    return {
      success: false,
      statusCode: "m048_s02_publication_regressed",
      comparison,
      issues,
    };
  }

  if (targetedTotal.deltaMs >= 0) {
    issues.push("Candidate did not improve the targeted latency phases.");
    return {
      success: false,
      statusCode: "m048_s02_no_improvement",
      comparison,
      issues,
    };
  }

  return {
    success: true,
    statusCode: "m048_s02_ok",
    comparison,
    issues,
  };
}

export async function evaluateM048S02(params: {
  baseline: CompareTarget;
  candidate: CompareTarget;
  generatedAt?: string;
  workspaceIds?: string[];
  discoverWorkspaceIds?: () => Promise<string[]>;
  evaluate?: (params: CompareTarget) => Promise<M048S01Report>;
}): Promise<M048S02Report> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();

  if (params.evaluate) {
    const [baseline, candidate] = await Promise.all([
      params.evaluate(params.baseline),
      params.evaluate(params.candidate),
    ]);
    const comparisonResult = buildComparison(baseline, candidate);
    return createBaseReport({
      generatedAt,
      success: comparisonResult.success,
      statusCode: comparisonResult.statusCode,
      baseline,
      candidate,
      comparison: comparisonResult.comparison,
      issues: comparisonResult.issues,
    });
  }

  let workspaceIds = params.workspaceIds ?? [];
  if (!params.workspaceIds) {
    try {
      workspaceIds = await (params.discoverWorkspaceIds ?? discoverAuditWorkspaceIds)();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const baseline = createPlaceholderS01Report({
        reviewOutputKey: params.baseline.reviewOutputKey,
        deliveryId: params.baseline.deliveryId,
        statusCode: "m048_s01_azure_unavailable",
        sourceAvailability: "unavailable",
        issues: [`Azure workspace discovery failed: ${message}`],
      });
      const candidate = createPlaceholderS01Report({
        reviewOutputKey: params.candidate.reviewOutputKey,
        deliveryId: params.candidate.deliveryId,
        statusCode: "m048_s01_azure_unavailable",
        sourceAvailability: "unavailable",
        issues: [`Azure workspace discovery failed: ${message}`],
      });
      return createBaseReport({
        generatedAt,
        success: false,
        statusCode: "m048_s02_inconclusive",
        baseline,
        candidate,
        issues: [
          `Baseline evidence is unavailable: ${baseline.status_code}.`,
          `Candidate evidence is unavailable: ${candidate.status_code}.`,
        ],
      });
    }
  }

  const [baseline, candidate] = await Promise.all([
    evaluateM048S01({
      reviewOutputKey: params.baseline.reviewOutputKey,
      deliveryId: params.baseline.deliveryId,
      generatedAt,
      workspaceIds,
    }),
    evaluateM048S01({
      reviewOutputKey: params.candidate.reviewOutputKey,
      deliveryId: params.candidate.deliveryId,
      generatedAt,
      workspaceIds,
    }),
  ]);

  const comparisonResult = buildComparison(baseline, candidate);
  return createBaseReport({
    generatedAt,
    success: comparisonResult.success,
    statusCode: comparisonResult.statusCode,
    baseline,
    candidate,
    comparison: comparisonResult.comparison,
    issues: comparisonResult.issues,
  });
}

function formatPhaseSummary(phase: ReviewPhaseTiming | null): string {
  if (!phase) {
    return "unavailable";
  }

  if (phase.status === "unavailable") {
    return `unavailable${phase.detail ? ` (${phase.detail})` : ""}`;
  }

  const durationText = typeof phase.durationMs === "number" ? formatDuration(phase.durationMs) : "unavailable";
  if (phase.status === "degraded") {
    return `${durationText} (degraded${phase.detail ? `: ${phase.detail}` : ""})`;
  }

  return durationText;
}

function formatDelta(deltaMs: number | null): string {
  if (deltaMs === null) {
    return "Δ unavailable";
  }

  const sign = deltaMs > 0 ? "+" : deltaMs < 0 ? "-" : "±";
  return `Δ ${sign}${formatDuration(Math.abs(deltaMs))}`;
}

export function renderM048S02Report(report: M048S02Report): string {
  const lines = [
    "# M048 S02 — Review Latency Compare Report",
    "",
    `Status: ${report.status_code}`,
    `Outcome: ${report.comparison.outcome}`,
    `Baseline: ${report.baseline.review_output_key ?? "unavailable"} (delivery ${report.baseline.delivery_id ?? "unavailable"}) status=${report.baseline.status_code} azure=${report.baseline.sourceAvailability.azureLogs}`,
    `Candidate: ${report.candidate.review_output_key ?? "unavailable"} (delivery ${report.candidate.delivery_id ?? "unavailable"}) status=${report.candidate.status_code} azure=${report.candidate.sourceAvailability.azureLogs}`,
    `Targeted total: baseline=${report.comparison.targetedTotal.baselineMs === null ? "unavailable" : formatDuration(report.comparison.targetedTotal.baselineMs)} candidate=${report.comparison.targetedTotal.candidateMs === null ? "unavailable" : formatDuration(report.comparison.targetedTotal.candidateMs)} ${formatDelta(report.comparison.targetedTotal.deltaMs)} (${report.comparison.targetedTotal.direction})`,
    `Timeout class: ${report.comparison.timeoutClass.state} (baseline=${report.comparison.timeoutClass.baselineClass}, candidate=${report.comparison.timeoutClass.candidateClass})`,
    `Publication continuity: ${report.comparison.publicationContinuity.state} (baseline published=${report.comparison.publicationContinuity.baselinePublished === null ? "unknown" : String(report.comparison.publicationContinuity.baselinePublished)}, candidate published=${report.comparison.publicationContinuity.candidatePublished === null ? "unknown" : String(report.comparison.publicationContinuity.candidatePublished)})`,
    "",
    "Targeted phase deltas:",
  ];

  for (const phase of report.comparison.targetedPhases) {
    lines.push(
      `- ${phase.name}: baseline ${formatPhaseSummary(phase.baseline)} → candidate ${formatPhaseSummary(phase.candidate)} (${formatDelta(phase.deltaMs)}, ${phase.direction})`,
    );
  }

  lines.push(
    "",
    `Publication phase: baseline ${formatPhaseSummary(report.comparison.publicationContinuity.baselinePhase)} → candidate ${formatPhaseSummary(report.comparison.publicationContinuity.candidatePhase)}`,
  );

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: (params: CompareTarget) => Promise<M048S01Report>;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const options = parseVerifyM048S02Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const baselineReviewOutputKeyMissingValue = args.includes("--baseline-review-output-key")
    && normalizeIdentifier(options.baselineReviewOutputKey) === null;
  const candidateReviewOutputKeyMissingValue = args.includes("--candidate-review-output-key")
    && normalizeIdentifier(options.candidateReviewOutputKey) === null;

  if (baselineReviewOutputKeyMissingValue && candidateReviewOutputKeyMissingValue) {
    const report = createBaseReport({
      statusCode: "m048_s02_skipped_missing_review_output_keys",
      success: true,
      baseline: createPlaceholderS01Report({
        reviewOutputKey: null,
        deliveryId: normalizeIdentifier(options.baselineDeliveryId),
        statusCode: "m048_s01_skipped_missing_review_output_key",
        success: true,
      }),
      candidate: createPlaceholderS01Report({
        reviewOutputKey: null,
        deliveryId: normalizeIdentifier(options.candidateDeliveryId),
        statusCode: "m048_s01_skipped_missing_review_output_key",
        success: true,
      }),
      issues: ["No baseline/candidate review output keys provided; skipped live latency compare verification."],
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM048S02Report(report));
    return 0;
  }

  const validated = validateArgs(options);
  if ("issues" in validated) {
    const report = createBaseReport({
      statusCode: "m048_s02_invalid_arg",
      success: false,
      baseline: createPlaceholderS01Report({
        reviewOutputKey: normalizeIdentifier(options.baselineReviewOutputKey),
        deliveryId: normalizeIdentifier(options.baselineDeliveryId),
      }),
      candidate: createPlaceholderS01Report({
        reviewOutputKey: normalizeIdentifier(options.candidateReviewOutputKey),
        deliveryId: normalizeIdentifier(options.candidateDeliveryId),
      }),
      issues: validated.issues,
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM048S02Report(report));
    return 1;
  }

  try {
    const report = await evaluateM048S02({
      baseline: validated.baseline,
      candidate: validated.candidate,
      ...(deps?.evaluate ? { evaluate: deps.evaluate } : {}),
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM048S02Report(report));
    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m048:s02 failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
