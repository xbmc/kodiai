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

  /** Bot mention handles for outgoing sanitization (e.g. ['kodiai', 'claude']). */
  botHandles?: string[];

  /**
   * Enables write-mode execution.
   *
   * When true, the model may edit files in the workspace, but GitHub publishing
   * tools are disabled so writes are finalized by trusted code.
   */
  writeMode?: boolean;
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
  /** Primary model used for execution (from SDK modelUsage keys) */
  model: string | undefined;
  /** Total input tokens across all models */
  inputTokens: number | undefined;
  /** Total output tokens across all models */
  outputTokens: number | undefined;
  /** Total cache read input tokens across all models */
  cacheReadTokens: number | undefined;
  /** Total cache creation input tokens across all models */
  cacheCreationTokens: number | undefined;
  /** SDK stop reason (e.g., "end_turn", "max_tokens") */
  stopReason: string | undefined;
};
