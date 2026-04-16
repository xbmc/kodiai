import { loadRepoConfig, type ConfigWarning } from "../src/execution/config.ts";
import {
  ensureReviewBoundednessDisclosureInSummary,
  resolveReviewBoundedness,
} from "../src/lib/review-boundedness.ts";
import { formatPartialReviewComment } from "../src/lib/partial-review-formatter.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";
import { parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import {
  evaluateM048S01,
  type M048S01Report,
} from "./verify-m048-s01.ts";

const LARGE_PR_DISCLOSURE = "Requested strict review; effective review remained strict and covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed).";
const TIMEOUT_REDUCED_DISCLOSURE = "Requested strict review; timeout risk auto-reduced the effective review to minimal and covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed).";
const SUMMARY_FIXTURE = [
  "<details>",
  "<summary>Kodiai Review Summary</summary>",
  "",
  "## What Changed",
  "- Reviewed the changed files.",
  "",
  "## Observations",
  "- [MAJOR] src/review.ts (42): Something broke.",
  "",
  "</details>",
].join("\n");

export type M048S03StatusCode =
  | "m048_s03_ok"
  | "m048_s03_invalid_arg"
  | "m048_s03_sync_config_drift"
  | "m048_s03_timeout_surface_failed"
  | "m048_s03_bounded_disclosure_failed"
  | "m048_s03_live_key_mismatch"
  | "m048_s03_live_evidence_unavailable";

export type M048S03SynchronizeConfigReport = {
  configPath: string;
  configPresent: boolean;
  effectiveOnSynchronize: boolean;
  warnings: ConfigWarning[];
  passed: boolean;
  issues: string[];
};

export type M048S03TimeoutSurfaceFixtureReport = {
  name: string;
  passed: boolean;
  partialReviewLine: string | null;
  partialReviewRetryLine: string | null;
  reviewDetailsProgressLine: string | null;
  reviewDetailsFindingLine: string | null;
  reviewDetailsRetryLine: string | null;
  issues: string[];
};

export type M048S03TimeoutSurfaceReport = {
  passed: boolean;
  fixtures: M048S03TimeoutSurfaceFixtureReport[];
  issues: string[];
};

export type M048S03BoundedDisclosureFixtureReport = {
  name: string;
  passed: boolean;
  expectedDisclosureRequired: boolean;
  actualDisclosureRequired: boolean;
  expectedSentence: string | null;
  actualSentence: string | null;
  summaryDisclosureInserted: boolean;
  issues: string[];
};

export type M048S03BoundedDisclosureReport = {
  passed: boolean;
  fixtures: M048S03BoundedDisclosureFixtureReport[];
  issues: string[];
};

export type M048S03LiveReport = {
  requested: boolean;
  skipped: boolean;
  action: string | null;
  deliveryId: string | null;
  phaseTiming: M048S01Report | null;
};

export type M048S03Report = {
  command: "verify:m048:s03";
  generated_at: string;
  review_output_key: string | null;
  success: boolean;
  status_code: M048S03StatusCode;
  local: {
    synchronizeConfig: M048S03SynchronizeConfigReport;
    timeoutSurfaces: M048S03TimeoutSurfaceReport;
    boundedDisclosure: M048S03BoundedDisclosureReport;
  };
  live: M048S03LiveReport;
  issues: string[];
};

type ParsedArgs = {
  help?: boolean;
  json?: boolean;
  reviewOutputKey: string | null;
};

type TimeoutSurfaceFixtureDefinition = {
  name: string;
  partialReviewParams: Parameters<typeof formatPartialReviewComment>[0];
  expectedPartialReviewLine: string;
  expectedPartialReviewRetryLine?: string | null;
  reviewDetailsParams: Parameters<typeof formatReviewDetailsSummary>[0];
  expectedReviewDetailsProgressLine: string;
  expectedReviewDetailsFindingLine: string;
  expectedReviewDetailsRetryLine: string;
};

type BoundedFixtureDefinition = {
  name: string;
  expectedDisclosureRequired: boolean;
  expectedSentence: string | null;
  input: Parameters<typeof resolveReviewBoundedness>[0];
};

const REVIEW_DETAILS_TIMEOUT_BASE = {
  reviewOutputKey: "timeout-proof-key",
  filesReviewed: 5,
  linesAdded: 24,
  linesRemoved: 8,
  findingCounts: { critical: 0, major: 1, medium: 2, minor: 0 },
  profileSelection: {
    selectedProfile: "strict" as const,
    source: "auto" as const,
    linesChanged: 32,
    autoBand: "small" as const,
  },
  contributorExperience: projectContributorExperienceContract({
    source: "author-cache",
    tier: "regular",
  }).reviewDetails,
};

const DEFAULT_TIMEOUT_SURFACE_FIXTURES: TimeoutSurfaceFixtureDefinition[] = [
  {
    name: "timeout-scheduled-retry",
    partialReviewParams: {
      summaryDraft: "Review timed out after partial progress was recorded.",
      filesReviewed: 2,
      totalFiles: 5,
      timedOutAfterSeconds: 600,
    },
    expectedPartialReviewLine: "> **Partial review** -- timed out after analyzing 2 of 5 files (600s).",
    reviewDetailsParams: {
      ...REVIEW_DETAILS_TIMEOUT_BASE,
      timeoutProgress: {
        analyzedFiles: 2,
        totalFiles: 5,
        findingCount: 3,
        retryState: "scheduled reduced-scope retry",
      },
    },
    expectedReviewDetailsProgressLine: "- Analyzed progress before timeout: 2/5 changed files",
    expectedReviewDetailsFindingLine: "- Findings captured before timeout: 3 total",
    expectedReviewDetailsRetryLine: "- Retry state: scheduled reduced-scope retry",
  },
  {
    name: "timeout-retry-skipped",
    partialReviewParams: {
      summaryDraft: "Review timed out after partial progress was recorded.",
      filesReviewed: 2,
      totalFiles: 5,
      timedOutAfterSeconds: 600,
      isRetrySkipped: true,
      retrySkipReason: "Retry skipped -- this repo has timed out frequently for this author.",
    },
    expectedPartialReviewLine: "> **Partial review** -- timed out after analyzing 2 of 5 files (600s).",
    expectedPartialReviewRetryLine: "> Retry skipped -- this repo has timed out frequently for this author.",
    reviewDetailsParams: {
      ...REVIEW_DETAILS_TIMEOUT_BASE,
      timeoutProgress: {
        analyzedFiles: 2,
        totalFiles: 5,
        findingCount: 3,
        retryState: "skipped (frequent timeouts for this repo/author)",
      },
    },
    expectedReviewDetailsProgressLine: "- Analyzed progress before timeout: 2/5 changed files",
    expectedReviewDetailsFindingLine: "- Findings captured before timeout: 3 total",
    expectedReviewDetailsRetryLine: "- Retry state: skipped (frequent timeouts for this repo/author)",
  },
];

const DEFAULT_BOUNDED_DISCLOSURE_FIXTURES: BoundedFixtureDefinition[] = [
  {
    name: "large-pr-strict",
    expectedDisclosureRequired: true,
    expectedSentence: LARGE_PR_DISCLOSURE,
    input: {
      requestedProfile: {
        selectedProfile: "strict",
        source: "keyword",
        autoBand: null,
        linesChanged: 100,
      },
      effectiveProfile: {
        selectedProfile: "strict",
        source: "keyword",
        autoBand: null,
        linesChanged: 100,
      },
      largePRTriage: {
        fullCount: 30,
        abbreviatedCount: 20,
        totalFiles: 60,
      },
      timeout: {
        riskLevel: "high",
        dynamicTimeoutSeconds: 900,
        shouldReduceScope: true,
        reductionApplied: false,
        reductionSkippedReason: "explicit-profile",
      },
    },
  },
  {
    name: "timeout-auto-reduced",
    expectedDisclosureRequired: true,
    expectedSentence: TIMEOUT_REDUCED_DISCLOSURE,
    input: {
      requestedProfile: {
        selectedProfile: "strict",
        source: "auto",
        autoBand: "small",
        linesChanged: 100,
      },
      effectiveProfile: {
        selectedProfile: "minimal",
        source: "auto",
        autoBand: "small",
        linesChanged: 100,
      },
      largePRTriage: {
        fullCount: 30,
        abbreviatedCount: 20,
        totalFiles: 60,
      },
      timeout: {
        riskLevel: "high",
        dynamicTimeoutSeconds: 900,
        shouldReduceScope: true,
        reductionApplied: true,
        reductionSkippedReason: null,
      },
    },
  },
  {
    name: "small-unbounded",
    expectedDisclosureRequired: false,
    expectedSentence: null,
    input: {
      requestedProfile: {
        selectedProfile: "strict",
        source: "auto",
        autoBand: "small",
        linesChanged: 80,
      },
      effectiveProfile: {
        selectedProfile: "strict",
        source: "auto",
        autoBand: "small",
        linesChanged: 80,
      },
      largePRTriage: null,
      timeout: {
        riskLevel: "low",
        dynamicTimeoutSeconds: 600,
        shouldReduceScope: false,
        reductionApplied: false,
        reductionSkippedReason: null,
      },
    },
  },
];

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

export function parseVerifyM048S03Args(args: string[]): ParsedArgs {
  let reviewOutputKey: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--review-output-key") {
      const { value, consumed } = readOptionValue(args, index);
      reviewOutputKey = value;
      if (consumed) {
        index += 1;
      }
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    reviewOutputKey,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m048:s03 -- [--review-output-key <key>] [--json]",
    "",
    "Options:",
    "  --review-output-key  Optional synchronize reviewOutputKey for live phase-evidence proof",
    "  --json               Print machine-readable JSON output",
    "  --help               Show this help",
    "",
    "Without --review-output-key, the command runs local synchronize-config and bounded-disclosure proof only.",
  ].join("\n");
}

function createBaseReport(params: {
  generatedAt?: string;
  reviewOutputKey?: string | null;
  success: boolean;
  statusCode: M048S03StatusCode;
  synchronizeConfig: M048S03SynchronizeConfigReport;
  timeoutSurfaces: M048S03TimeoutSurfaceReport;
  boundedDisclosure: M048S03BoundedDisclosureReport;
  live: M048S03LiveReport;
  issues?: string[];
}): M048S03Report {
  return {
    command: "verify:m048:s03",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    review_output_key: params.reviewOutputKey ?? null,
    success: params.success,
    status_code: params.statusCode,
    local: {
      synchronizeConfig: params.synchronizeConfig,
      timeoutSurfaces: params.timeoutSurfaces,
      boundedDisclosure: params.boundedDisclosure,
    },
    live: params.live,
    issues: params.issues ?? [],
  };
}

function buildDefaultSynchronizeConfigReport(workspaceDir: string): M048S03SynchronizeConfigReport {
  return {
    configPath: `${workspaceDir}/.kodiai.yml`,
    configPresent: false,
    effectiveOnSynchronize: false,
    warnings: [],
    passed: false,
    issues: [],
  };
}

function buildDefaultTimeoutSurfaceReport(): M048S03TimeoutSurfaceReport {
  return {
    passed: false,
    fixtures: [],
    issues: [],
  };
}

function buildDefaultBoundedDisclosureReport(): M048S03BoundedDisclosureReport {
  return {
    passed: false,
    fixtures: [],
    issues: [],
  };
}

export async function evaluateSynchronizeConfigPreflight(params: {
  workspaceDir: string;
  loadConfig?: typeof loadRepoConfig;
}): Promise<M048S03SynchronizeConfigReport> {
  const configPath = `${params.workspaceDir}/.kodiai.yml`;
  const configFile = Bun.file(configPath);
  const configPresent = await configFile.exists();

  if (!configPresent) {
    return {
      configPath,
      configPresent: false,
      effectiveOnSynchronize: false,
      warnings: [],
      passed: false,
      issues: [
        "Missing .kodiai.yml; expected checked-in review.triggers.onSynchronize=true for synchronize proof.",
      ],
    };
  }

  try {
    const { config, warnings } = await (params.loadConfig ?? loadRepoConfig)(params.workspaceDir);
    const relevantWarnings = warnings.filter((warning) =>
      warning.issues.some((issue) => issue.includes("onSynchronize"))
      || warning.section === "review" && !config.review.triggers.onSynchronize,
    );
    const issues = relevantWarnings.flatMap((warning) => warning.issues);

    if (!config.review.triggers.onSynchronize) {
      issues.unshift(
        "Effective review.triggers.onSynchronize is false; synchronize-triggered reviews are disabled.",
      );
    }

    return {
      configPath,
      configPresent: true,
      effectiveOnSynchronize: config.review.triggers.onSynchronize,
      warnings: relevantWarnings,
      passed: config.review.triggers.onSynchronize && issues.length === 0,
      issues,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      configPath,
      configPresent: true,
      effectiveOnSynchronize: false,
      warnings: [],
      passed: false,
      issues: [`Could not load .kodiai.yml: ${message}`],
    };
  }
}

function countDisclosureOccurrences(body: string, disclosureSentence: string): number {
  const escapedSentence = disclosureSentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (body.match(new RegExp(escapedSentence, "g")) ?? []).length;
}

function findMatchingLine(body: string, expectedLine: string): string | null {
  return body.split("\n").find((line) => line.trim() === expectedLine.trim()) ?? null;
}

export async function evaluateTimeoutSurfaceFixtures(params?: {
  fixtures?: TimeoutSurfaceFixtureDefinition[];
}): Promise<M048S03TimeoutSurfaceReport> {
  const fixtureReports: M048S03TimeoutSurfaceFixtureReport[] = [];

  for (const fixture of params?.fixtures ?? DEFAULT_TIMEOUT_SURFACE_FIXTURES) {
    const partialReviewBody = formatPartialReviewComment(fixture.partialReviewParams);
    const reviewDetailsBody = formatReviewDetailsSummary(fixture.reviewDetailsParams);
    const issues: string[] = [];

    const partialReviewLine = findMatchingLine(partialReviewBody, fixture.expectedPartialReviewLine);
    const partialReviewRetryLine = fixture.expectedPartialReviewRetryLine
      ? findMatchingLine(partialReviewBody, fixture.expectedPartialReviewRetryLine)
      : null;
    const reviewDetailsProgressLine = findMatchingLine(reviewDetailsBody, fixture.expectedReviewDetailsProgressLine);
    const reviewDetailsFindingLine = findMatchingLine(reviewDetailsBody, fixture.expectedReviewDetailsFindingLine);
    const reviewDetailsRetryLine = findMatchingLine(reviewDetailsBody, fixture.expectedReviewDetailsRetryLine);

    if (!partialReviewLine) {
      issues.push(`Partial review output drifted from expected analyzed-progress line for fixture ${fixture.name}.`);
    }

    if (fixture.expectedPartialReviewRetryLine && !partialReviewRetryLine) {
      issues.push(`Partial review output drifted from expected retry line for fixture ${fixture.name}.`);
    }

    if (!reviewDetailsProgressLine) {
      issues.push(`Review Details output drifted from expected analyzed-progress line for fixture ${fixture.name}.`);
    }

    if (!reviewDetailsFindingLine) {
      issues.push(`Review Details output drifted from expected finding-count line for fixture ${fixture.name}.`);
    }

    if (!reviewDetailsRetryLine) {
      issues.push(`Review Details output drifted from expected retry-state line for fixture ${fixture.name}.`);
    }

    fixtureReports.push({
      name: fixture.name,
      passed: issues.length === 0,
      partialReviewLine,
      partialReviewRetryLine,
      reviewDetailsProgressLine,
      reviewDetailsFindingLine,
      reviewDetailsRetryLine,
      issues,
    });
  }

  return {
    passed: fixtureReports.every((fixture) => fixture.passed),
    fixtures: fixtureReports,
    issues: fixtureReports.flatMap((fixture) => fixture.issues),
  };
}

export async function evaluateBoundedDisclosureFixtures(params?: {
  fixtures?: BoundedFixtureDefinition[];
}): Promise<M048S03BoundedDisclosureReport> {
  const fixtureReports: M048S03BoundedDisclosureFixtureReport[] = [];

  for (const fixture of params?.fixtures ?? DEFAULT_BOUNDED_DISCLOSURE_FIXTURES) {
    const contract = resolveReviewBoundedness(fixture.input);
    const issues: string[] = [];
    const actualDisclosureRequired = contract?.disclosureRequired ?? false;
    const actualSentence = contract?.disclosureSentence ?? null;
    let summaryDisclosureInserted = false;

    if (!contract) {
      issues.push(`Fixture ${fixture.name} did not resolve a boundedness contract.`);
    }

    if (actualDisclosureRequired !== fixture.expectedDisclosureRequired) {
      issues.push(
        `Expected disclosureRequired=${fixture.expectedDisclosureRequired} but received ${actualDisclosureRequired}.`,
      );
    }

    if (actualSentence !== fixture.expectedSentence) {
      issues.push(
        `Expected disclosure sentence ${JSON.stringify(fixture.expectedSentence)} but received ${JSON.stringify(actualSentence)}.`,
      );
    }

    if (contract) {
      const updatedSummary = ensureReviewBoundednessDisclosureInSummary(SUMMARY_FIXTURE, contract);
      if (fixture.expectedSentence) {
        const occurrences = countDisclosureOccurrences(updatedSummary, fixture.expectedSentence);
        summaryDisclosureInserted = occurrences === 1;
        if (occurrences !== 1) {
          issues.push(`Expected summary disclosure insertion count 1 but received ${occurrences}.`);
        }
      } else if (updatedSummary !== SUMMARY_FIXTURE) {
        issues.push("Summary disclosure helper changed an unbounded fixture unexpectedly.");
      }
    }

    fixtureReports.push({
      name: fixture.name,
      passed: issues.length === 0,
      expectedDisclosureRequired: fixture.expectedDisclosureRequired,
      actualDisclosureRequired,
      expectedSentence: fixture.expectedSentence,
      actualSentence,
      summaryDisclosureInserted,
      issues,
    });
  }

  return {
    passed: fixtureReports.every((fixture) => fixture.passed),
    fixtures: fixtureReports,
    issues: fixtureReports.flatMap((fixture) => fixture.issues),
  };
}

export async function evaluateM048S03(params?: {
  workspaceDir?: string;
  reviewOutputKey?: string | null;
  generatedAt?: string;
  loadConfig?: typeof loadRepoConfig;
  evaluateTimeoutSurfaces?: () => Promise<M048S03TimeoutSurfaceReport>;
  evaluateBoundedDisclosure?: () => Promise<M048S03BoundedDisclosureReport>;
  evaluateLivePhaseTiming?: (params: {
    reviewOutputKey: string;
    deliveryId: string;
  }) => Promise<M048S01Report>;
}): Promise<M048S03Report> {
  const workspaceDir = params?.workspaceDir ?? process.cwd();
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const reviewOutputKey = normalizeIdentifier(params?.reviewOutputKey);

  const synchronizeConfig = await evaluateSynchronizeConfigPreflight({
    workspaceDir,
    loadConfig: params?.loadConfig,
  });
  const timeoutSurfaces = await (params?.evaluateTimeoutSurfaces ?? (() => evaluateTimeoutSurfaceFixtures()))();
  const boundedDisclosure = await (params?.evaluateBoundedDisclosure ?? (() => evaluateBoundedDisclosureFixtures()))();
  const baseLive: M048S03LiveReport = {
    requested: reviewOutputKey !== null,
    skipped: reviewOutputKey === null,
    action: null,
    deliveryId: null,
    phaseTiming: null,
  };
  const baseIssues = [
    ...synchronizeConfig.issues,
    ...timeoutSurfaces.issues,
    ...boundedDisclosure.issues,
  ];

  if (!synchronizeConfig.passed) {
    return createBaseReport({
      generatedAt,
      reviewOutputKey,
      success: false,
      statusCode: "m048_s03_sync_config_drift",
      synchronizeConfig,
      timeoutSurfaces,
      boundedDisclosure,
      live: baseLive,
      issues: baseIssues,
    });
  }

  if (!timeoutSurfaces.passed) {
    return createBaseReport({
      generatedAt,
      reviewOutputKey,
      success: false,
      statusCode: "m048_s03_timeout_surface_failed",
      synchronizeConfig,
      timeoutSurfaces,
      boundedDisclosure,
      live: baseLive,
      issues: baseIssues,
    });
  }

  if (!boundedDisclosure.passed) {
    return createBaseReport({
      generatedAt,
      reviewOutputKey,
      success: false,
      statusCode: "m048_s03_bounded_disclosure_failed",
      synchronizeConfig,
      timeoutSurfaces,
      boundedDisclosure,
      live: baseLive,
      issues: baseIssues,
    });
  }

  if (!reviewOutputKey) {
    return createBaseReport({
      generatedAt,
      reviewOutputKey: null,
      success: true,
      statusCode: "m048_s03_ok",
      synchronizeConfig,
      timeoutSurfaces,
      boundedDisclosure,
      live: baseLive,
      issues: baseIssues,
    });
  }

  const parsedKey = parseReviewOutputKey(reviewOutputKey);
  if (!parsedKey) {
    return createBaseReport({
      generatedAt,
      reviewOutputKey,
      success: false,
      statusCode: "m048_s03_invalid_arg",
      synchronizeConfig,
      timeoutSurfaces,
      boundedDisclosure,
      live: {
        ...baseLive,
        skipped: false,
      },
      issues: [...baseIssues, "Malformed reviewOutputKey."],
    });
  }

  if (parsedKey.action !== "synchronize") {
    return createBaseReport({
      generatedAt,
      reviewOutputKey,
      success: false,
      statusCode: "m048_s03_live_key_mismatch",
      synchronizeConfig,
      timeoutSurfaces,
      boundedDisclosure,
      live: {
        requested: true,
        skipped: false,
        action: parsedKey.action,
        deliveryId: parsedKey.effectiveDeliveryId,
        phaseTiming: null,
      },
      issues: [
        ...baseIssues,
        `Expected a synchronize reviewOutputKey; received action=${parsedKey.action}.`,
      ],
    });
  }

  try {
    const phaseTiming = await (params?.evaluateLivePhaseTiming ?? ((liveParams) => evaluateM048S01(liveParams)))({
      reviewOutputKey,
      deliveryId: parsedKey.effectiveDeliveryId,
    });
    const issues = [...baseIssues, ...phaseTiming.issues];
    const statusCode = phaseTiming.success ? "m048_s03_ok" : "m048_s03_live_evidence_unavailable";

    return createBaseReport({
      generatedAt,
      reviewOutputKey,
      success: phaseTiming.success,
      statusCode,
      synchronizeConfig,
      timeoutSurfaces,
      boundedDisclosure,
      live: {
        requested: true,
        skipped: false,
        action: parsedKey.action,
        deliveryId: parsedKey.effectiveDeliveryId,
        phaseTiming,
      },
      issues,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createBaseReport({
      generatedAt,
      reviewOutputKey,
      success: false,
      statusCode: "m048_s03_live_evidence_unavailable",
      synchronizeConfig,
      timeoutSurfaces,
      boundedDisclosure,
      live: {
        requested: true,
        skipped: false,
        action: parsedKey.action,
        deliveryId: parsedKey.effectiveDeliveryId,
        phaseTiming: null,
      },
      issues: [...baseIssues, `Live synchronize evidence failed: ${message}`],
    });
  }
}

export function renderM048S03Report(report: M048S03Report): string {
  const lines = [
    "# M048 S03 — Synchronize Continuity and Bounded Review Verifier",
    "",
    `Status: ${report.status_code}`,
    `Review output key: ${report.review_output_key ?? "not provided"}`,
    `Synchronize config preflight: ${report.local.synchronizeConfig.passed ? "pass" : "fail"}`,
    `- Config path: ${report.local.synchronizeConfig.configPath}`,
    `- Config present: ${report.local.synchronizeConfig.configPresent}`,
    `- Effective review.triggers.onSynchronize: ${report.local.synchronizeConfig.effectiveOnSynchronize}`,
    `Timeout truth fixtures: ${report.local.timeoutSurfaces.passed ? "pass" : "fail"}`,
  ];

  for (const fixture of report.local.timeoutSurfaces.fixtures) {
    lines.push(`- ${fixture.name}: ${fixture.passed ? "pass" : "fail"}`);
    if (fixture.partialReviewLine) {
      lines.push(`  - Partial review: ${fixture.partialReviewLine}`);
    }
    if (fixture.partialReviewRetryLine) {
      lines.push(`  - Partial review retry: ${fixture.partialReviewRetryLine}`);
    }
    if (fixture.reviewDetailsProgressLine) {
      lines.push(`  - Review Details progress: ${fixture.reviewDetailsProgressLine}`);
    }
    if (fixture.reviewDetailsFindingLine) {
      lines.push(`  - Review Details findings: ${fixture.reviewDetailsFindingLine}`);
    }
    if (fixture.reviewDetailsRetryLine) {
      lines.push(`  - Review Details retry: ${fixture.reviewDetailsRetryLine}`);
    }
  }

  lines.push(`Bounded disclosure fixtures: ${report.local.boundedDisclosure.passed ? "pass" : "fail"}`);

  for (const fixture of report.local.boundedDisclosure.fixtures) {
    lines.push(
      `- ${fixture.name}: ${fixture.passed ? "pass" : "fail"} (required=${fixture.actualDisclosureRequired}${fixture.actualSentence ? `; sentence=${fixture.actualSentence}` : ""})`,
    );
  }

  if (report.live.skipped) {
    lines.push("Live synchronize proof: skipped (no review output key provided)");
  } else {
    lines.push(
      `Live synchronize proof: action=${report.live.action ?? "unknown"} delivery=${report.live.deliveryId ?? "unknown"}`,
    );
    if (report.live.phaseTiming) {
      lines.push(
        `- Reused phase evidence: ${report.live.phaseTiming.status_code} (azure=${report.live.phaseTiming.sourceAvailability.azureLogs})`,
        `- Outcome class: ${report.live.phaseTiming.outcome.class}`,
        `- Outcome detail: ${report.live.phaseTiming.outcome.summary}`,
      );
      if (report.live.phaseTiming.evidence?.conclusion) {
        lines.push(`- Conclusion: ${report.live.phaseTiming.evidence.conclusion}`);
      }
      if (typeof report.live.phaseTiming.evidence?.totalDurationMs === "number") {
        lines.push(`- Total wall-clock: ${report.live.phaseTiming.evidence.totalDurationMs}ms`);
      }
    }
  }

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
    evaluate?: (params: {
      workspaceDir: string;
      reviewOutputKey: string | null;
    }) => Promise<M048S03Report>;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const options = parseVerifyM048S03Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspaceDir = process.cwd();
  const reviewOutputKey = normalizeIdentifier(options.reviewOutputKey);
  const parsedKey = reviewOutputKey ? parseReviewOutputKey(reviewOutputKey) : null;

  if (reviewOutputKey && (!parsedKey || parsedKey.action !== "synchronize")) {
    const synchronizeConfig = await evaluateSynchronizeConfigPreflight({ workspaceDir });
    const timeoutSurfaces = await evaluateTimeoutSurfaceFixtures();
    const boundedDisclosure = await evaluateBoundedDisclosureFixtures();
    const issues = [
      ...synchronizeConfig.issues,
      ...timeoutSurfaces.issues,
      ...boundedDisclosure.issues,
      parsedKey
        ? `Expected a synchronize reviewOutputKey; received action=${parsedKey.action}.`
        : "Malformed reviewOutputKey.",
    ];
    const report = createBaseReport({
      reviewOutputKey,
      success: false,
      statusCode: parsedKey ? "m048_s03_live_key_mismatch" : "m048_s03_invalid_arg",
      synchronizeConfig,
      timeoutSurfaces,
      boundedDisclosure,
      live: {
        requested: true,
        skipped: false,
        action: parsedKey?.action ?? null,
        deliveryId: parsedKey?.effectiveDeliveryId ?? null,
        phaseTiming: null,
      },
      issues,
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM048S03Report(report));
    return 1;
  }

  try {
    const report = await (deps?.evaluate ?? ((params) => evaluateM048S03(params)))({
      workspaceDir,
      reviewOutputKey,
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM048S03Report(report));
    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m048:s03 failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
