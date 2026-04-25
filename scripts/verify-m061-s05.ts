import { parseArgs } from "node:util";
import { queryUsageReportWithTimeout, type UsageDeliveryRow } from "./usage-report.ts";
import { evaluateM061S01BaselineProof } from "./verify-m061-s01.ts";
import { evaluateM061S02MentionContextProof } from "./verify-m061-s02.ts";
import { evaluateM061S03ReviewSectionProof } from "./verify-m061-s03.ts";
import { evaluateM061S04Proof } from "./verify-m061-s04.ts";

type AccessState = "available" | "missing" | "unavailable";

type CliOptions = {
  since: string | null;
  repo: string | null;
  json: boolean;
  help: boolean;
};

export const M061_S05_CHECK_IDS = [
  "M061-S05-PREFLIGHT",
  "M061-S05-BASELINE-COVERAGE",
  "M061-S05-MENTION-REDUCTION",
  "M061-S05-REVIEW-COMPACTION",
  "M061-S05-REUSE-TRUTHFULNESS",
  "M061-S05-INTEGRATED-TOKEN-STORY",
] as const;

export type M061S05CheckId = (typeof M061_S05_CHECK_IDS)[number];

export type Check = {
  id: M061S05CheckId;
  title: string;
  passed: boolean;
  detail: string;
};

export type RepresentativeDeliverySnapshot = {
  deliveryId: string;
  taskType: string;
  promptKinds: string[];
  sectionCount: number;
  promptEstimatedTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
};

export type IntegratedComparisons = {
  mentionVsReviewPromptReduction: number | null;
  mentionVsReviewInputReduction: number | null;
  mentionVsReviewSectionReduction: number | null;
};

export type M061S05ProofReport = {
  command: "verify:m061:s05";
  generatedAt: string;
  filters: {
    since: string | null;
    repo: string | null;
  };
  preflight: {
    databaseAccess: AccessState;
    detail: string;
  };
  overallPassed: boolean;
  checks: Check[];
  observed: {
    representativeDeliveries: {
      mention: RepresentativeDeliverySnapshot | null;
      review: RepresentativeDeliverySnapshot | null;
    };
    integratedComparisons: IntegratedComparisons;
    composedChecks: Record<string, { passed: boolean; detail: string }>;
  };
};

type UsageLikeResult = Awaited<ReturnType<typeof queryUsageReportWithTimeout>>;

function normalizeSince(value: string): string {
  const relativeMatch = value.match(/^(\d+)d$/);
  if (relativeMatch) {
    const days = Number.parseInt(relativeMatch[1] ?? "0", 10);
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --since format: '${value}'. Use Nd, YYYY-MM-DD, or ISO-8601.`);
  }

  return parsed.toISOString();
}

export function parseM061S05Args(args: string[]): CliOptions {
  const parsed = parseArgs({
    args,
    options: {
      since: { type: "string" },
      repo: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    since: parsed.values.since ? normalizeSince(parsed.values.since) : null,
    repo: parsed.values.repo ?? null,
    json: parsed.values.json ?? false,
    help: parsed.values.help ?? false,
  };
}

function buildPreflightOnlyReport(options: {
  generatedAt: string;
  accessState: AccessState;
  accessDetail: string;
  filters: { repo: string | null; since: string | null };
}): M061S05ProofReport {
  return {
    command: "verify:m061:s05",
    generatedAt: options.generatedAt,
    filters: options.filters,
    preflight: {
      databaseAccess: options.accessState,
      detail: options.accessDetail,
    },
    overallPassed: false,
    checks: [
      {
        id: "M061-S05-PREFLIGHT",
        title: "Live Postgres telemetry is reachable",
        passed: options.accessState === "available",
        detail: options.accessDetail,
      },
    ],
    observed: {
      representativeDeliveries: {
        mention: null,
        review: null,
      },
      integratedComparisons: {
        mentionVsReviewPromptReduction: null,
        mentionVsReviewInputReduction: null,
        mentionVsReviewSectionReduction: null,
      },
      composedChecks: {},
    },
  };
}

function pickRepresentativeDelivery(deliveries: UsageDeliveryRow[], taskType: string, requiredPromptKind: string): UsageDeliveryRow | null {
  return deliveries.find((row) => row.taskType === taskType && row.promptKinds.includes(requiredPromptKind)) ?? null;
}

function snapshotDelivery(row: UsageDeliveryRow | null): RepresentativeDeliverySnapshot | null {
  if (!row) {
    return null;
  }

  return {
    deliveryId: row.deliveryId,
    taskType: row.taskType,
    promptKinds: [...row.promptKinds],
    sectionCount: row.sectionCount,
    promptEstimatedTokens: row.promptEstimatedTokens,
    llmInputTokens: row.llmInputTokens,
    llmOutputTokens: row.llmOutputTokens,
    cacheReadTokens: row.cacheReadTokens,
    estimatedCostUsd: row.estimatedCostUsd,
  };
}

function formatCheckDetail(prefix: string, detail: string): string {
  return `${prefix}: ${detail}`;
}

function findCheck<T extends { id: string; passed: boolean; detail: string }>(checks: T[], id: string): T | undefined {
  return checks.find((check) => check.id === id);
}

export function evaluateM061S05Proof(input: {
  generatedAt: string;
  filters: { repo: string | null; since: string | null };
  accessState: AccessState;
  accessDetail: string;
  usageResult: UsageLikeResult | null;
}): M061S05ProofReport {
  if (input.accessState !== "available" || input.usageResult == null) {
    return buildPreflightOnlyReport({
      generatedAt: input.generatedAt,
      accessState: input.accessState,
      accessDetail: input.accessDetail,
      filters: input.filters,
    });
  }

  const usageResult = input.usageResult;
  const s01 = evaluateM061S01BaselineProof({
    generatedAt: input.generatedAt,
    filters: input.filters,
    accessState: input.accessState,
    accessDetail: input.accessDetail,
    usageResult,
  });
  const s02 = evaluateM061S02MentionContextProof({
    generatedAt: input.generatedAt,
    filters: input.filters,
    accessState: input.accessState,
    accessDetail: input.accessDetail,
    usageResult,
  });
  const s03 = evaluateM061S03ReviewSectionProof({
    generatedAt: input.generatedAt,
    filters: input.filters,
    accessState: input.accessState,
    accessDetail: input.accessDetail,
    usageResult,
  });
  const s04 = evaluateM061S04Proof({
    generatedAt: input.generatedAt,
    filters: input.filters,
    accessState: input.accessState,
    accessDetail: input.accessDetail,
    usageResult,
  });

  const baselineCheck = findCheck(s01.checks, "M061-S01-TASK-PATH-ATTRIBUTION");
  const mentionSectionCheck = findCheck(s02.checks, "M061-S02-MENTION-CONTEXT-SECTIONS");
  const mentionUserPromptCheck = findCheck(s02.checks, "M061-S02-MENTION-USER-PROMPT");
  const reviewSectionsCheck = findCheck(s03.checks, "M061-S03-REVIEW-USER-PROMPT-SECTIONS");
  const reviewTruncationCheck = findCheck(s03.checks, "M061-S03-REVIEW-SECTION-TRUNCATION");
  const reuseSurfaceCheck = findCheck(s04.checks, "M061-S04-REUSE-SURFACE");
  const retrievalReuseCheck = findCheck(s04.checks, "M061-S04-RETRIEVAL-REUSE");
  const derivedTruthfulnessCheck = findCheck(s04.checks, "M061-S04-DERIVED-CACHE-TRUTHFULNESS");

  const representativeMention = pickRepresentativeDelivery(usageResult.deliveryBreakdown, "mention.response", "mention.user-prompt");
  const representativeReview = pickRepresentativeDelivery(usageResult.deliveryBreakdown, "review.full", "review.user-prompt");

  const mentionVsReviewPromptReduction = representativeMention && representativeReview
    ? representativeReview.promptEstimatedTokens - representativeMention.promptEstimatedTokens
    : null;
  const mentionVsReviewInputReduction = representativeMention && representativeReview
    ? representativeReview.llmInputTokens - representativeMention.llmInputTokens
    : null;
  const mentionVsReviewSectionReduction = representativeMention && representativeReview
    ? representativeReview.sectionCount - representativeMention.sectionCount
    : null;

  const baselineCoveragePassed = Boolean(
    s01.overallPassed
      && baselineCheck?.passed
      && representativeMention
      && representativeReview,
  );

  const mentionReductionPassed = Boolean(
    mentionSectionCheck?.passed
      && mentionUserPromptCheck?.passed
      && representativeMention
      && representativeMention.promptEstimatedTokens > 0
      && representativeMention.sectionCount > 0,
  );

  const reviewCompactionPassed = Boolean(
    reviewSectionsCheck?.passed
      && reviewTruncationCheck?.passed
      && representativeReview
      && representativeReview.sectionCount > 0,
  );

  const reuseTruthfulnessPassed = Boolean(
    reuseSurfaceCheck?.passed
      && retrievalReuseCheck?.passed
      && derivedTruthfulnessCheck?.passed,
  );

  const integratedTokenStoryPassed = Boolean(
    representativeMention
      && representativeReview
      && reuseTruthfulnessPassed
      && (mentionVsReviewPromptReduction ?? 0) > 0
      && (mentionVsReviewInputReduction ?? 0) > 0
      && (mentionVsReviewSectionReduction ?? 0) > 0,
  );

  const checks: Check[] = [
    {
      id: "M061-S05-PREFLIGHT",
      title: "Live Postgres telemetry is reachable",
      passed: true,
      detail: input.accessDetail,
    },
    {
      id: "M061-S05-BASELINE-COVERAGE",
      title: "Baseline telemetry coverage remains intact for representative mention/review verification",
      passed: baselineCoveragePassed,
      detail: baselineCoveragePassed
        ? `Representative deliveries available: mention.response=${representativeMention?.deliveryId}; review.full=${representativeReview?.deliveryId}`
        : [
            !baselineCheck?.passed ? formatCheckDetail("baseline coverage", baselineCheck?.detail ?? "Missing S01 task-path attribution evidence") : null,
            !representativeMention ? "Missing representative mention.response delivery with mention.user-prompt attribution." : null,
            !representativeReview ? "Missing representative review.full delivery with review.user-prompt attribution." : null,
          ].filter(Boolean).join(" "),
    },
    {
      id: "M061-S05-MENTION-REDUCTION",
      title: "Mention path still shows the reduced admitted context surface",
      passed: mentionReductionPassed,
      detail: mentionReductionPassed
        ? `Representative mention delivery ${representativeMention?.deliveryId} uses ${representativeMention?.sectionCount} sections and ${representativeMention?.promptEstimatedTokens} prompt-estimated tokens.`
        : [
            !mentionSectionCheck?.passed ? formatCheckDetail("mention.context", mentionSectionCheck?.detail ?? "Missing mention.context section evidence") : null,
            !mentionUserPromptCheck?.passed ? formatCheckDetail("mention.user-prompt", mentionUserPromptCheck?.detail ?? "Missing mention.user-prompt evidence") : null,
            !representativeMention ? "No representative mention.response delivery with mention.user-prompt attribution was returned." : null,
          ].filter(Boolean).join(" "),
    },
    {
      id: "M061-S05-REVIEW-COMPACTION",
      title: "Review path retains bounded named sections plus truncation evidence",
      passed: reviewCompactionPassed,
      detail: reviewCompactionPassed
        ? `Representative review delivery ${representativeReview?.deliveryId} uses ${representativeReview?.sectionCount} sections and ${representativeReview?.promptEstimatedTokens} prompt-estimated tokens with review truncation evidence present.`
        : [
            !reviewSectionsCheck?.passed ? formatCheckDetail("review sections", reviewSectionsCheck?.detail ?? "Missing named review section evidence") : null,
            !reviewTruncationCheck?.passed ? formatCheckDetail("truncation evidence", reviewTruncationCheck?.detail ?? "Missing review truncation evidence") : null,
            !representativeReview ? "No representative review.full delivery with review.user-prompt attribution was returned." : null,
          ].filter(Boolean).join(" "),
    },
    {
      id: "M061-S05-REUSE-TRUTHFULNESS",
      title: "Reuse evidence remains truthful about hits, misses, degraded paths, and avoided work",
      passed: reuseTruthfulnessPassed,
      detail: reuseTruthfulnessPassed
        ? `${retrievalReuseCheck?.detail ?? "Retrieval reuse evidence present."} ${derivedTruthfulnessCheck?.detail ?? "Derived-cache truthfulness evidence present."}`
        : [
            !reuseSurfaceCheck?.passed ? formatCheckDetail("reuse evidence", reuseSurfaceCheck?.detail ?? "Missing reuse evidence rows") : null,
            !retrievalReuseCheck?.passed ? formatCheckDetail("reuse evidence", retrievalReuseCheck?.detail ?? "Missing retrieval hit/avoidance evidence") : null,
            !derivedTruthfulnessCheck?.passed ? formatCheckDetail("reuse evidence", derivedTruthfulnessCheck?.detail ?? "Missing truthful fallback-state evidence") : null,
          ].filter(Boolean).join(" "),
    },
    {
      id: "M061-S05-INTEGRATED-TOKEN-STORY",
      title: "Representative mention delivery remains cheaper than representative review delivery without losing proof surfaces",
      passed: integratedTokenStoryPassed,
      detail: integratedTokenStoryPassed
        ? `mention.response ${representativeMention?.deliveryId} vs review.full ${representativeReview?.deliveryId}: prompt_reduction=${mentionVsReviewPromptReduction}, input_reduction=${mentionVsReviewInputReduction}, section_reduction=${mentionVsReviewSectionReduction}.`
        : [
            !representativeMention ? "Missing representative mention.response delivery for integrated comparison." : null,
            !representativeReview ? "Missing review.full representative delivery for integrated comparison." : null,
            representativeMention && representativeReview && (mentionVsReviewPromptReduction ?? 0) <= 0
              ? `Representative mention prompt_estimated_tokens (${representativeMention.promptEstimatedTokens}) is not lower than review (${representativeReview.promptEstimatedTokens}).`
              : null,
            representativeMention && representativeReview && (mentionVsReviewInputReduction ?? 0) <= 0
              ? `Representative mention llm_input_tokens (${representativeMention.llmInputTokens}) is not lower than review (${representativeReview.llmInputTokens}).`
              : null,
            representativeMention && representativeReview && (mentionVsReviewSectionReduction ?? 0) <= 0
              ? `Representative mention section_count (${representativeMention.sectionCount}) is not lower than review (${representativeReview.sectionCount}).`
              : null,
            !reuseTruthfulnessPassed ? "Reuse truthfulness check did not pass, so the token comparison is not trustworthy." : null,
          ].filter(Boolean).join(" "),
    },
  ];

  return {
    command: "verify:m061:s05",
    generatedAt: input.generatedAt,
    filters: input.filters,
    preflight: {
      databaseAccess: "available",
      detail: input.accessDetail,
    },
    overallPassed: checks.every((check) => check.passed),
    checks,
    observed: {
      representativeDeliveries: {
        mention: snapshotDelivery(representativeMention),
        review: snapshotDelivery(representativeReview),
      },
      integratedComparisons: {
        mentionVsReviewPromptReduction,
        mentionVsReviewInputReduction,
        mentionVsReviewSectionReduction,
      },
      composedChecks: {
        "M061-S01-TASK-PATH-ATTRIBUTION": {
          passed: baselineCheck?.passed ?? false,
          detail: baselineCheck?.detail ?? "Missing composed baseline check.",
        },
        "M061-S02-MENTION-CONTEXT-SECTIONS": {
          passed: mentionSectionCheck?.passed ?? false,
          detail: mentionSectionCheck?.detail ?? "Missing composed mention-context check.",
        },
        "M061-S02-MENTION-USER-PROMPT": {
          passed: mentionUserPromptCheck?.passed ?? false,
          detail: mentionUserPromptCheck?.detail ?? "Missing composed mention-user-prompt check.",
        },
        "M061-S03-REVIEW-USER-PROMPT-SECTIONS": {
          passed: reviewSectionsCheck?.passed ?? false,
          detail: reviewSectionsCheck?.detail ?? "Missing composed review-sections check.",
        },
        "M061-S03-REVIEW-SECTION-TRUNCATION": {
          passed: reviewTruncationCheck?.passed ?? false,
          detail: reviewTruncationCheck?.detail ?? "Missing composed review-truncation check.",
        },
        "M061-S04-REUSE-SURFACE": {
          passed: reuseSurfaceCheck?.passed ?? false,
          detail: reuseSurfaceCheck?.detail ?? "Missing composed reuse-surface check.",
        },
        "M061-S04-RETRIEVAL-REUSE": {
          passed: retrievalReuseCheck?.passed ?? false,
          detail: retrievalReuseCheck?.detail ?? "Missing composed retrieval-reuse check.",
        },
        "M061-S04-DERIVED-CACHE-TRUTHFULNESS": {
          passed: derivedTruthfulnessCheck?.passed ?? false,
          detail: derivedTruthfulnessCheck?.detail ?? "Missing composed derived-cache truthfulness check.",
        },
      },
    },
  };
}

export function renderM061S05Proof(report: M061S05ProofReport): string {
  const lines = [
    "M061 S05 integrated token reduction proof",
    `Database access: ${report.preflight.databaseAccess}`,
    `Preflight detail: ${report.preflight.detail}`,
    `Generated at: ${report.generatedAt}`,
  ];

  if (report.filters.since || report.filters.repo) {
    lines.push(`Filters: since=${report.filters.since ?? "none"} repo=${report.filters.repo ?? "none"}`);
  }

  if (report.preflight.databaseAccess !== "available") {
    lines.push(
      "",
      "No live telemetry evidence available. This integrated verifier fails open so operators can inspect databaseAccess and preflight detail before rerunning the canonical report/verifier flow.",
    );
    return lines.join("\n");
  }

  lines.push("", "Checks:");
  for (const check of report.checks) {
    lines.push(`- ${check.id} ${check.passed ? "PASS" : "FAIL"}: ${check.title}. ${check.detail}`);
  }

  lines.push("", "Representative deliveries:");
  lines.push(
    report.observed.representativeDeliveries.mention
      ? `- mention.response: ${report.observed.representativeDeliveries.mention.deliveryId} prompt_tokens=${report.observed.representativeDeliveries.mention.promptEstimatedTokens} input=${report.observed.representativeDeliveries.mention.llmInputTokens} sections=${report.observed.representativeDeliveries.mention.sectionCount}`
      : "- mention.response: none",
  );
  lines.push(
    report.observed.representativeDeliveries.review
      ? `- review.full: ${report.observed.representativeDeliveries.review.deliveryId} prompt_tokens=${report.observed.representativeDeliveries.review.promptEstimatedTokens} input=${report.observed.representativeDeliveries.review.llmInputTokens} sections=${report.observed.representativeDeliveries.review.sectionCount}`
      : "- review.full: none",
  );

  lines.push(
    "",
    `Integrated comparison: prompt_reduction=${report.observed.integratedComparisons.mentionVsReviewPromptReduction ?? "n/a"} input_reduction=${report.observed.integratedComparisons.mentionVsReviewInputReduction ?? "n/a"} section_reduction=${report.observed.integratedComparisons.mentionVsReviewSectionReduction ?? "n/a"}`,
    "",
    report.overallPassed
      ? `Final verdict: PASS [${report.checks.map((check) => check.id).join(", ")}]`
      : `Final verdict: FAIL [${report.checks.filter((check) => !check.passed).map((check) => check.id).join(", ")}]`,
  );

  return lines.join("\n");
}

function printUsage(): void {
  console.log(`M061 S05 integrated token reduction proof\n\nUsage:\n  bun scripts/verify-m061-s05.ts [--repo <owner/repo>] [--since <Nd|YYYY-MM-DD|ISO>] [--json]\n\nNotes:\n  - Reads live Postgres telemetry only through queryUsageReportWithTimeout()\n  - Composes the S01-S04 proof seams into one milestone-level verdict\n  - Fails open with explicit databaseAccess and preflight detail when Postgres is unavailable`);
}

function snapshotProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env };
}

export async function runM061S05ProofCli(
  args: string[],
  env: NodeJS.ProcessEnv = snapshotProcessEnv(),
): Promise<{ report: M061S05ProofReport; exitCode: number; json: boolean }> {
  const options = parseM061S05Args(args);
  if (options.help) {
    printUsage();
    return {
      report: buildPreflightOnlyReport({
        generatedAt: new Date().toISOString(),
        accessState: "missing",
        accessDetail: "Help requested.",
        filters: { repo: options.repo, since: options.since },
      }),
      exitCode: 0,
      json: options.json,
    };
  }

  const connectionString = env.TEST_DATABASE_URL ?? env.DATABASE_URL ?? null;
  if (!connectionString) {
    return {
      report: buildPreflightOnlyReport({
        generatedAt: new Date().toISOString(),
        accessState: "missing",
        accessDetail: "Neither TEST_DATABASE_URL nor DATABASE_URL is set.",
        filters: { repo: options.repo, since: options.since },
      }),
      exitCode: 0,
      json: options.json,
    };
  }

  const [{ default: pino }, { createDbClient }] = await Promise.all([
    import("pino"),
    import("../src/db/client.ts"),
  ]);
  const logger = pino({ level: "silent" });
  let client: ReturnType<typeof createDbClient> | null = null;
  try {
    client = createDbClient({ connectionString, logger });
    const usageResult = await queryUsageReportWithTimeout(client.sql, {
      repo: options.repo,
      since: options.since,
    });
    const report = evaluateM061S05Proof({
      generatedAt: new Date().toISOString(),
      filters: { repo: options.repo, since: options.since },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult,
    });
    return {
      report,
      exitCode: report.overallPassed ? 0 : 1,
      json: options.json,
    };
  } catch (error) {
    return {
      report: buildPreflightOnlyReport({
        generatedAt: new Date().toISOString(),
        accessState: "unavailable",
        accessDetail: error instanceof Error ? error.message : String(error),
        filters: { repo: options.repo, since: options.since },
      }),
      exitCode: 0,
      json: options.json,
    };
  } finally {
    await client?.sql.end({ timeout: 0 });
  }
}

if (import.meta.main) {
  try {
    const { report, exitCode, json } = await runM061S05ProofCli(process.argv.slice(2));
    console.log(json ? JSON.stringify(report, null, 2) : renderM061S05Proof(report));
    process.exit(exitCode);
  } catch (error) {
    console.error(`verify:m061:s05 failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
