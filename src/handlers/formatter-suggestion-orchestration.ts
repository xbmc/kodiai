import type { Logger } from "pino";
import { $ } from "bun";
import {
  buildPrDiffCommentabilityIndex,
  mapFormatterDiffToSuggestions,
  resolveFormatterCommand,
  runFormatterCommand,
  type FormatterCommandResult,
  type FormatterCommandStatus,
  type FormatterSuggestionCounts,
  type FormatterSuggestionPayload,
} from "../execution/formatter-suggestions.ts";
import {
  publishFormatterSuggestionReview,
  type FormatterSuggestionPublisherOctokit,
  type FormatterSuggestionPublisherResult,
  type FormatterSuggestionPublisherStatus,
} from "../execution/formatter-suggestion-publisher.ts";
import { collectDiffContext } from "./review.ts";
import { buildReviewOutputKey } from "./review-idempotency.ts";

const DEFAULT_FORMATTER_REVIEW_OUTPUT_ACTION = "mention-format-suggestions";
const DEFAULT_FORMATTER_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_FILES_FOR_FULL_FORMATTER_DIFF = Number.MAX_SAFE_INTEGER;
const VISIBLE_REASON_MAX_CHARS = 500;

type DiffFallbackFile = {
  filename: string;
  status?: string;
  previousFilename?: string;
  additions?: number | null;
  deletions?: number | null;
  patch?: string | null;
};

type DiffCollectionResult = Awaited<ReturnType<typeof collectDiffContext>>;

export type FormatterSuggestionSubflowStatus =
  | "setup-needed"
  | "no-op"
  | "pr-diff-unavailable"
  | "mapped-no-suggestions"
  | "posted"
  | "duplicate"
  | "blocked"
  | "failed";

export interface FormatterSuggestionSubflowLogger {
  debug?(fields: Record<string, unknown>, message?: string): void;
  info?(fields: Record<string, unknown>, message?: string): void;
  warn?(fields: Record<string, unknown>, message?: string): void;
  error?(fields: Record<string, unknown>, message?: string): void;
}

export interface FormatterSuggestionSubflowOptions {
  owner: string;
  repo: string;
  prNumber: number;
  workspaceDir: string;
  baseRef: string;
  headRef: string;
  diffRange?: string;
  formatterCommand?: string;
  formatterTimeoutMs?: number;
  maxSuggestions: number;
  installationId: number;
  deliveryId: string;
  reviewOutputAction?: string;
  octokit: FormatterSuggestionPublisherOctokit;
  token?: string;
  botHandles?: string[];
  fallbackFileProvider?: () => Promise<string[]>;
  fallbackDiffProvider?: () => Promise<DiffFallbackFile[]>;
  logger?: FormatterSuggestionSubflowLogger;
}

export interface FormatterSuggestionSubflowDependencies {
  runFormatterCommand?: typeof runFormatterCommand;
  collectDiffContext?: typeof collectDiffContext;
  publishFormatterSuggestionReview?: typeof publishFormatterSuggestionReview;
  resolveHeadSha?: (workspaceDir: string) => Promise<string>;
}

export interface FormatterSuggestionSubflowResult {
  status: FormatterSuggestionSubflowStatus;
  commandStatus?: FormatterCommandStatus;
  publisherStatus?: FormatterSuggestionPublisherStatus;
  suggestions: number;
  skipped: number;
  capped: number;
  posted?: number;
  reviewUrl?: string;
  reviewId?: number;
  reason?: string;
  visibleMessage?: string;
  reviewOutputKey?: string;
  headSha?: string;
  diffRange?: string;
  mapperCounts?: FormatterSuggestionCounts;
  publisherSkipped?: number;
  publisherFailed?: boolean;
  partialFailure?: boolean;
}

function noopLogger(): Required<FormatterSuggestionSubflowLogger> {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function safeLog(
  logger: FormatterSuggestionSubflowLogger | undefined,
  level: "debug" | "info" | "warn" | "error",
  fields: Record<string, unknown>,
  message: string,
): void {
  try {
    logger?.[level]?.(fields, message);
  } catch {
    // Observability must not affect formatter subflow behavior.
  }
}

function boundedReason(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text
    .replace(/\bgh[pors]_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-ant-[a-z0-9]+-[A-Za-z0-9_\-]+\b/gi, "[REDACTED_ANTHROPIC_API_KEY]")
    .slice(0, VISIBLE_REASON_MAX_CHARS);
}

function resultBase(overrides: Partial<FormatterSuggestionSubflowResult>): FormatterSuggestionSubflowResult {
  return {
    status: "failed",
    suggestions: 0,
    skipped: 0,
    capped: 0,
    ...overrides,
  };
}

function makeSetupNeededResult(): FormatterSuggestionSubflowResult {
  return resultBase({
    status: "setup-needed",
    commandStatus: "no-command",
    visibleMessage: "Formatter suggestions are not configured. Add review.formatterSuggestions.command to .kodiai.yml to enable explicit formatter suggestion requests.",
  });
}

function makeCommandFailureResult(commandResult: FormatterCommandResult): FormatterSuggestionSubflowResult {
  const reason = boundedReason(commandResult.stderrSummary || `formatter exited with status ${commandResult.exitCode ?? "unknown"}`);
  const timedOut = commandResult.status === "timed-out";
  return resultBase({
    status: "failed",
    commandStatus: commandResult.status,
    reason,
    visibleMessage: timedOut
      ? `The formatter command timed out before producing suggestions. ${reason}`.trim()
      : `The formatter command failed before suggestions could be published. ${reason}`.trim(),
  });
}

function makeNoOpResult(commandResult: FormatterCommandResult): FormatterSuggestionSubflowResult {
  return resultBase({
    status: "no-op",
    commandStatus: commandResult.status,
    visibleMessage: "The formatter command completed but produced no formatter changes to suggest.",
  });
}

function makePrDiffUnavailableResult(params: {
  commandStatus?: FormatterCommandStatus;
  reason: string;
  diffRange?: string;
}): FormatterSuggestionSubflowResult {
  return resultBase({
    status: "pr-diff-unavailable",
    commandStatus: params.commandStatus,
    reason: params.reason,
    diffRange: params.diffRange,
    visibleMessage: `Formatter suggestions could not be mapped because the full PR diff was unavailable. ${params.reason}`.trim(),
  });
}

function makeMappedNoSuggestionsResult(params: {
  commandStatus: FormatterCommandStatus;
  counts: FormatterSuggestionCounts;
  skipped: number;
  capped: number;
  diffRange?: string;
}): FormatterSuggestionSubflowResult {
  return resultBase({
    status: "mapped-no-suggestions",
    commandStatus: params.commandStatus,
    suggestions: 0,
    skipped: params.skipped,
    capped: params.capped,
    mapperCounts: params.counts,
    diffRange: params.diffRange,
    visibleMessage: `No formatter suggestions could be mapped onto commentable PR lines (${params.skipped} skipped, ${params.capped} capped).`,
  });
}

function mapPublisherResult(params: {
  publisherResult: FormatterSuggestionPublisherResult;
  commandStatus: FormatterCommandStatus;
  suggestions: FormatterSuggestionPayload[];
  mapperCounts: FormatterSuggestionCounts;
  capped: number;
  reviewOutputKey: string;
  headSha: string;
  diffRange?: string;
}): FormatterSuggestionSubflowResult {
  const { publisherResult } = params;
  const common = {
    commandStatus: params.commandStatus,
    publisherStatus: publisherResult.status,
    suggestions: params.suggestions.length,
    skipped: publisherResult.skipped,
    capped: params.capped,
    posted: publisherResult.posted,
    reviewUrl: publisherResult.review?.url,
    reviewId: publisherResult.review?.id,
    reviewOutputKey: params.reviewOutputKey,
    headSha: params.headSha,
    diffRange: params.diffRange,
    mapperCounts: params.mapperCounts,
    publisherSkipped: publisherResult.skipped,
    publisherFailed: publisherResult.failed,
  } satisfies Partial<FormatterSuggestionSubflowResult>;

  switch (publisherResult.status) {
    case "posted":
      return resultBase({
        ...common,
        status: "posted",
      });
    case "skipped":
      return resultBase({
        ...common,
        status: "duplicate",
        reason: publisherResult.reviewOutput.idempotencyDecision ?? "skip-existing-output",
        visibleMessage: "Formatter suggestions were already published for this delivery and head commit, so Kodiai skipped the duplicate review.",
      });
    case "blocked": {
      const location = publisherResult.blocked?.location ?? "comment";
      return resultBase({
        ...common,
        status: "blocked",
        reason: `${location} matched blocked secret pattern`,
        visibleMessage: "Formatter suggestions were blocked because the outgoing review content matched a secret-scan pattern.",
      });
    }
    case "no-suggestions":
      return resultBase({
        ...common,
        status: "mapped-no-suggestions",
        visibleMessage: `No formatter suggestions could be published (${publisherResult.skipped} skipped).`,
      });
    case "failed":
      return resultBase({
        ...common,
        status: "failed",
        reason: boundedReason(publisherResult.rejection?.message ?? publisherResult.error ?? "formatter suggestion publication failed"),
        visibleMessage: publisherResult.rejection
          ? `GitHub rejected the formatter suggestion review. ${boundedReason(publisherResult.rejection.message)}`.trim()
          : `The formatter suggestions could not be published. ${boundedReason(publisherResult.error ?? "publisher failed")}`.trim(),
      });
    default:
      return resultBase({
        ...common,
        status: "failed",
        reason: `unknown publisher status ${(publisherResult as { status?: unknown }).status}`,
        visibleMessage: "The formatter suggestion publisher returned an unknown status.",
      });
  }
}

function buildLogFields(options: FormatterSuggestionSubflowOptions): Record<string, unknown> {
  return {
    event: "formatter-suggestion-subflow",
    owner: options.owner,
    repo: options.repo,
    prNumber: options.prNumber,
    mode: "explicit",
    reviewOutputAction: options.reviewOutputAction ?? DEFAULT_FORMATTER_REVIEW_OUTPUT_ACTION,
  };
}

function logResult(options: FormatterSuggestionSubflowOptions, result: FormatterSuggestionSubflowResult): void {
  const fields = {
    ...buildLogFields(options),
    status: result.status,
    commandStatus: result.commandStatus,
    publisherStatus: result.publisherStatus,
    suggestions: result.suggestions,
    skipped: result.skipped,
    capped: result.capped,
    posted: result.posted,
    reviewUrl: result.reviewUrl,
    reviewId: result.reviewId,
    reason: result.reason,
    partialFailure: result.partialFailure,
  };
  const level = result.status === "posted" || result.status === "no-op" ? "info" : result.status === "failed" || result.status === "blocked" ? "warn" : "info";
  safeLog(options.logger, level, fields, "Formatter suggestion subflow completed");
}

async function defaultResolveHeadSha(workspaceDir: string): Promise<string> {
  const result = await $`git -C ${workspaceDir} rev-parse HEAD`.quiet();
  return result.stdout.toString().trim();
}

export function renderFormatterSuggestionVisibleMessage(
  result: FormatterSuggestionSubflowResult,
): string | undefined {
  return result.visibleMessage;
}

export async function runFormatterSuggestionSubflow(
  options: FormatterSuggestionSubflowOptions,
  dependencies: FormatterSuggestionSubflowDependencies = {},
): Promise<FormatterSuggestionSubflowResult> {
  const runCommand = dependencies.runFormatterCommand ?? runFormatterCommand;
  const collectDiff = dependencies.collectDiffContext ?? collectDiffContext;
  const publishReview = dependencies.publishFormatterSuggestionReview ?? publishFormatterSuggestionReview;
  const resolveHeadSha = dependencies.resolveHeadSha ?? defaultResolveHeadSha;
  const diffRange = options.diffRange ?? `origin/${options.baseRef}...HEAD`;

  safeLog(options.logger, "info", {
    ...buildLogFields(options),
    stage: "request",
    hasCommand: Boolean(resolveFormatterCommand({
      command: options.formatterCommand,
      baseRef: options.baseRef,
      headRef: options.headRef,
      diffRange,
    })),
    maxSuggestions: options.maxSuggestions,
  }, "Formatter suggestion subflow requested");

  if (!resolveFormatterCommand({
    command: options.formatterCommand,
    baseRef: options.baseRef,
    headRef: options.headRef,
    diffRange,
  })) {
    const result = makeSetupNeededResult();
    logResult(options, result);
    return result;
  }

  const commandResult = await runCommand({
    command: options.formatterCommand,
    baseRef: options.baseRef,
    headRef: options.headRef,
    diffRange,
    workspaceDir: options.workspaceDir,
    timeoutMs: options.formatterTimeoutMs ?? DEFAULT_FORMATTER_TIMEOUT_MS,
  });

  if (commandResult.status === "failed" || commandResult.status === "timed-out") {
    const result = makeCommandFailureResult(commandResult);
    logResult(options, result);
    return result;
  }

  if (commandResult.status === "no-op" || commandResult.stdout.trim().length === 0) {
    const result = makeNoOpResult(commandResult);
    logResult(options, result);
    return result;
  }

  let diffContext: DiffCollectionResult;
  try {
    diffContext = await collectDiff({
      workspaceDir: options.workspaceDir,
      baseRef: options.baseRef,
      maxFilesForFullDiff: DEFAULT_MAX_FILES_FOR_FULL_FORMATTER_DIFF,
      logger: (options.logger ?? noopLogger()) as Logger,
      baseLog: {
        owner: options.owner,
        repo: options.repo,
        prNumber: options.prNumber,
        gate: "formatter-suggestion-subflow",
      },
      token: options.token,
      fallbackFileProvider: options.fallbackFileProvider,
      fallbackDiffProvider: options.fallbackDiffProvider,
    });
  } catch (error) {
    const result = makePrDiffUnavailableResult({
      commandStatus: commandResult.status,
      reason: boundedReason(error),
      diffRange,
    });
    logResult(options, result);
    return result;
  }

  if (!diffContext.diffContent || diffContext.diffContent.trim().length === 0) {
    const result = makePrDiffUnavailableResult({
      commandStatus: commandResult.status,
      reason: `diff strategy ${diffContext.strategy} did not provide diffContent`,
      diffRange: diffContext.diffRange,
    });
    logResult(options, result);
    return result;
  }

  const prDiffIndex = buildPrDiffCommentabilityIndex(diffContext.diffContent);
  const mapped = mapFormatterDiffToSuggestions({
    formatterDiff: commandResult.stdout,
    prDiffIndex,
    maxSuggestions: options.maxSuggestions,
  });

  if (mapped.suggestions.length === 0) {
    const result = makeMappedNoSuggestionsResult({
      commandStatus: commandResult.status,
      counts: mapped.counts,
      skipped: mapped.counts.skipped,
      capped: mapped.counts.capped,
      diffRange: diffContext.diffRange,
    });
    logResult(options, result);
    return result;
  }

  let headSha: string;
  try {
    headSha = await resolveHeadSha(options.workspaceDir);
  } catch (error) {
    const result = resultBase({
      status: "failed",
      commandStatus: commandResult.status,
      suggestions: mapped.suggestions.length,
      skipped: mapped.counts.skipped,
      capped: mapped.counts.capped,
      mapperCounts: mapped.counts,
      diffRange: diffContext.diffRange,
      reason: boundedReason(error),
      visibleMessage: `Formatter suggestions could not be published because the PR head commit could not be resolved. ${boundedReason(error)}`.trim(),
    });
    logResult(options, result);
    return result;
  }

  const reviewOutputKey = buildReviewOutputKey({
    installationId: options.installationId,
    owner: options.owner,
    repo: options.repo,
    prNumber: options.prNumber,
    action: options.reviewOutputAction ?? DEFAULT_FORMATTER_REVIEW_OUTPUT_ACTION,
    deliveryId: options.deliveryId,
    headSha,
  });

  let publisherResult: FormatterSuggestionPublisherResult;
  try {
    publisherResult = await publishReview({
      octokit: options.octokit,
      owner: options.owner,
      repo: options.repo,
      prNumber: options.prNumber,
      commitId: headSha,
      suggestions: mapped.suggestions,
      skipped: mapped.skipped,
      reviewOutputKey,
      botHandles: options.botHandles,
      logger: options.logger,
    });
  } catch (error) {
    const result = resultBase({
      status: "failed",
      commandStatus: commandResult.status,
      publisherStatus: "failed",
      suggestions: mapped.suggestions.length,
      skipped: mapped.counts.skipped,
      capped: mapped.counts.capped,
      mapperCounts: mapped.counts,
      reviewOutputKey,
      headSha,
      diffRange: diffContext.diffRange,
      reason: boundedReason(error),
      visibleMessage: `The formatter suggestions could not be published. ${boundedReason(error)}`.trim(),
    });
    logResult(options, result);
    return result;
  }

  const result = mapPublisherResult({
    publisherResult,
    commandStatus: commandResult.status,
    suggestions: mapped.suggestions,
    mapperCounts: mapped.counts,
    capped: mapped.counts.capped,
    reviewOutputKey,
    headSha,
    diffRange: diffContext.diffRange,
  });
  logResult(options, result);
  return result;
}
