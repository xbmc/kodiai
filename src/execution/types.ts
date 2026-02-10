export type { RepoConfig } from "./config.ts";

/** Everything needed to invoke Claude against a workspace */
export type ExecutionContext = {
  /** The ephemeral workspace with the cloned repo */
  workspace: { dir: string; cleanup: () => Promise<void> };
  installationId: number;
  owner: string;
  repo: string;
  /** Set for PR events, undefined for issue-only events */
  prNumber: number | undefined;
  /** Tracking comment ID for progress updates (set by handler, undefined initially) */
  commentId: number | undefined;
  /** The webhook event type (e.g., "pull_request.opened", "issue_comment.created") */
  eventType: string;
  /** The comment/PR body that triggered this execution */
  triggerBody: string;
  /** Optional pre-built prompt. When set, overrides the default buildPrompt() output. */
  prompt?: string;
  /** Deterministic idempotency key for one review output batch. */
  reviewOutputKey?: string;
  /** Webhook delivery identifier for correlation logging. */
  deliveryId?: string;
};

/** The outcome of a Claude execution */
export type ExecutionResult = {
  conclusion: "success" | "failure" | "error";
  costUsd: number | undefined;
  numTurns: number | undefined;
  durationMs: number | undefined;
  sessionId: string | undefined;
  /** True if the execution published a GitHub-visible output via MCP tools (best-effort). */
  published?: boolean;
  /** Populated when conclusion is "error" */
  errorMessage: string | undefined;
  /** Set to true when the execution was terminated by timeout */
  isTimeout?: boolean;
};
