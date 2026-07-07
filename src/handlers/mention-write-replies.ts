import { wrapInDetails } from "../lib/formatting.ts";
import { ok, type Result } from "../lib/result.ts";

export type IssueWriteFailureStep = "branch-push" | "create-pr" | "issue-linkback";
export type WritePermissionFailureReplyStatus = {
  status: "handled" | "not-applicable";
};
export type WritePermissionFailureReplyResult = Result<WritePermissionFailureReplyStatus>;

export function toErrorSignalText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value ?? "");
}

export function summarizeErrorForDiagnostics(err: unknown): string {
  const parts: string[] = [];

  if (err instanceof Error) {
    if (typeof err.message === "string") {
      parts.push(err.message);
    }
    const withExtras = err as Error & {
      stderr?: unknown;
      stdout?: unknown;
      cause?: unknown;
    };
    parts.push(toErrorSignalText(withExtras.stderr));
    parts.push(toErrorSignalText(withExtras.stdout));
    parts.push(toErrorSignalText(withExtras.cause));
  }

  if (typeof err === "object" && err !== null) {
    const maybeObj = err as {
      message?: unknown;
      stderr?: unknown;
      stdout?: unknown;
      response?: unknown;
    };
    parts.push(toErrorSignalText(maybeObj.message));
    parts.push(toErrorSignalText(maybeObj.stderr));
    parts.push(toErrorSignalText(maybeObj.stdout));
    parts.push(toErrorSignalText(maybeObj.response));
  }

  const firstLine = parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => part.length > 0);

  return firstLine ?? "Unknown publish failure";
}

export function buildIssueWriteSuccessReply(params: {
  prUrl: string;
  issueLinkbackUrl: string;
}): string {
  const lines = [
    "status: success",
    `pr_url: ${params.prUrl}`,
    `issue_linkback_url: ${params.issueLinkbackUrl}`,
    "",
    `Opened PR: ${params.prUrl}`,
  ];

  return wrapInDetails(lines.join("\n"), "kodiai response");
}

export function buildExistingPrReply(params: { prUrl: string }): string {
  return wrapInDetails(`Existing PR: ${params.prUrl}`, "kodiai response");
}

export function buildWriteInProgressReply(): string {
  return wrapInDetails(
    [
      "Write request already in progress.",
      "",
      "If no PR appears shortly, retry the same comment.",
    ].join("\n"),
    "kodiai response",
  );
}

export function buildWriteRateLimitedReply(params: { retryInSeconds: number }): string {
  return wrapInDetails(
    [
      "Write request rate-limited.",
      "",
      `Try again in ${params.retryInSeconds}s.`,
    ].join("\n"),
    "kodiai response",
  );
}

export function buildPrContextRequiredReply(): string {
  return wrapInDetails(
    [
      "I can only apply changes in a PR context.",
      "",
      "Try mentioning me on a pull request (top-level comment or inline diff thread).",
    ].join("\n"),
    "kodiai response",
  );
}

export function buildWriteDisabledReply(params: { retryCommand: string }): string {
  return wrapInDetails(
    [
      "Write mode is disabled for this repo.",
      "",
      "Update `.kodiai.yml`:",
      "```yml",
      "write:",
      "  enabled: true",
      "```",
      "",
      `Then re-run the same \`${params.retryCommand}\` command.`,
    ].join("\n"),
    "kodiai response",
  );
}

export function buildNoFileChangesReply(): string {
  return wrapInDetails(
    [
      "I didn't end up making any file changes.",
      "",
      "If you still want a change, re-run with a more specific request.",
    ].join("\n"),
    "kodiai response",
  );
}

export function buildEmptyPatchReply(): string {
  return wrapInDetails("No diff content to create a patch from.", "kodiai response");
}

export function buildPatchTooLargeReply(): string {
  return wrapInDetails(
    "The generated patch is too large to publish as a gist. Please split the request into smaller changes.",
    "kodiai response",
  );
}

export function buildPatchGistReply(params: {
  gistUrl: string;
  changedFiles: string[];
}): string {
  return wrapInDetails(
    [
      `Patch gist: ${params.gistUrl}`,
      "",
      "To apply this patch locally:",
      "```bash",
      `curl -sL ${params.gistUrl}.patch | git apply`,
      "```",
      "",
      `Files changed: ${params.changedFiles.join(", ")}`,
    ].join("\n"),
    "kodiai response",
  );
}

export function buildFallbackPatchGistReply(params: { gistUrl: string }): string {
  return wrapInDetails(
    [
      "Could not create a PR from the fork, but here is the patch as a gist:",
      "",
      `Patch gist: ${params.gistUrl}`,
      "",
      "To apply this patch locally:",
      "```bash",
      `curl -sL ${params.gistUrl}.patch | git apply`,
      "```",
    ].join("\n"),
    "kodiai response",
  );
}

export function buildAlreadyAppliedReply(params: { prUrl: string | undefined }): string {
  return wrapInDetails(`Already applied (idempotent): ${params.prUrl}`, "kodiai response");
}

export function buildUpdatedPrReply(params: { prUrl: string | undefined }): string {
  return wrapInDetails(`Updated PR: ${params.prUrl}`, "kodiai response");
}

export function buildIssueWriteFailureReply(params: {
  failedStep: IssueWriteFailureStep;
  diagnostics: string;
  retryCommand: string;
}): string {
  const lines = [
    "Write request failed before PR publication completed.",
    "",
    "status: pr_creation_failed",
    `failed_step: ${params.failedStep}`,
    `diagnostics: ${params.diagnostics}`,
    "",
    "Next step: Fix the failed step and retry the exact same command.",
    `Retry command: ${params.retryCommand}`,
  ];

  return wrapInDetails(lines.join("\n"), "kodiai response");
}

export function buildWritePermissionFailureReply(params: {
  retryCommand: string;
}): string {
  return wrapInDetails(
    [
      "I couldn't complete this write request because of missing GitHub App permissions.",
      "",
      "Minimum required permissions for write-mode PR creation:",
      "- `Contents: Read and write`",
      "- `Pull requests: Read and write`",
      "- `Issues: Read and write`",
      "",
      "After updating permissions on the app installation, re-run the same command:",
      `- \`${params.retryCommand}\``,
    ].join("\n"),
    "kodiai response",
  );
}

export function buildWritePolicyRefusalReply(params: { refusal: string }): string {
  return wrapInDetails(params.refusal, "kodiai response");
}

export async function maybeReplyWritePermissionFailure(params: {
  err: unknown;
  retryCommand: string;
  postReply: (body: string, options?: { sanitizeMentions?: boolean }) => Promise<void>;
}): Promise<WritePermissionFailureReplyResult> {
  if (!isLikelyWritePermissionFailure(params.err)) {
    return ok({ status: "not-applicable" });
  }
  await params.postReply(
    buildWritePermissionFailureReply({ retryCommand: params.retryCommand }),
    { sanitizeMentions: false },
  );
  return ok({ status: "handled" });
}

export async function handleIssueWritePublishFailure(params: {
  isIssueWritePublishFlow: boolean;
  failedStep: IssueWriteFailureStep;
  err: unknown;
  retryCommand: string;
  postReply: (body: string, options?: { sanitizeMentions?: boolean }) => Promise<void>;
  logger: {
    warn(fields: Record<string, unknown>, message?: string): void;
  };
  logContext: {
    deliveryId: string;
    installationId: number;
    owner: string;
    repoName: string;
    repo: string;
    sourcePrNumber?: number;
    triggerCommentId: number;
    triggerCommentUrl?: string;
    writeOutputKey: string;
  };
}): Promise<void> {
  if (!params.isIssueWritePublishFlow) {
    throw params.err instanceof Error ? params.err : new Error(String(params.err));
  }

  const diagnostics = summarizeErrorForDiagnostics(params.err);
  const replyBody = buildIssueWriteFailureReply({
    failedStep: params.failedStep,
    diagnostics,
    retryCommand: params.retryCommand,
  });

  await params.postReply(replyBody, { sanitizeMentions: false });

  params.logger.warn(
    {
      evidenceType: "write-mode",
      outcome: "pr_creation_failed",
      ...params.logContext,
      failedStep: params.failedStep,
      diagnostics,
    },
    "Issue write-mode publish failed",
  );
}

export function createIssueWriteFailurePoster(params: Omit<
  Parameters<typeof handleIssueWritePublishFailure>[0],
  "failedStep" | "err"
>): (failedStep: IssueWriteFailureStep, err: unknown) => Promise<void> {
  return async (failedStep, err) => {
    await handleIssueWritePublishFailure({
      ...params,
      failedStep,
      err,
    });
  };
}

export function isLikelyWritePermissionFailure(err: unknown): boolean {
  if (!err) {
    return false;
  }

  const status =
    typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
      ? err.status
      : undefined;

  if (status === 401 || status === 403) {
    return true;
  }

  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message);
    const errorWithExtras = err as Error & {
      stderr?: unknown;
      stdout?: unknown;
      cause?: unknown;
    };
    parts.push(toErrorSignalText(errorWithExtras.stderr));
    parts.push(toErrorSignalText(errorWithExtras.stdout));
    parts.push(toErrorSignalText(errorWithExtras.cause));
  }

  if (typeof err === "object" && err !== null) {
    const obj = err as {
      message?: unknown;
      stderr?: unknown;
      stdout?: unknown;
      response?: unknown;
    };
    parts.push(toErrorSignalText(obj.message));
    parts.push(toErrorSignalText(obj.stderr));
    parts.push(toErrorSignalText(obj.stdout));
    parts.push(toErrorSignalText(obj.response));
  }

  const signal = parts.join("\n").toLowerCase();
  if (signal.length === 0) {
    return false;
  }

  return (
    signal.includes("resource not accessible by integration") ||
    signal.includes("permission to") ||
    signal.includes("write access to repository not granted") ||
    signal.includes("permission denied") ||
    signal.includes("insufficient permission") ||
    signal.includes("forbidden") ||
    signal.includes("not permitted") ||
    signal.includes("requires write")
  );
}
