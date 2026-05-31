import { wrapInDetails } from "../lib/formatting.ts";

export type IssueWriteFailureStep = "branch-push" | "create-pr" | "issue-linkback";

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
