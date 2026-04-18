export type { RepoConfig } from "./config.ts";

import type { KnowledgeStore } from "../knowledge/types.ts";

export type ExecutionPublishEvent = {
  type: "comment";
  url: string;
  excerpt: string;
};

export type ReviewPhaseStatus = "completed" | "degraded" | "unavailable";

export type ReviewPhaseName =
  | "queue wait"
  | "workspace preparation"
  | "retrieval/context assembly"
  | "executor handoff"
  | "remote runtime"
  | "publication";

export type ReviewPhaseTiming = {
  name: ReviewPhaseName;
  status: ReviewPhaseStatus;
  durationMs?: number;
  detail?: string;
};

export type ExecutorPhaseTiming = ReviewPhaseTiming & {
  name: "executor handoff" | "remote runtime";
};

/** Everything needed to invoke Claude against a workspace */
export type ExecutionContext = {
  /** The ephemeral workspace with the cloned repo */
  workspace: { dir: string; cleanup: () => Promise<void>; token?: string };
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

  /** Optional dynamic timeout override (seconds). When set, overrides config.timeoutSeconds. */
  dynamicTimeoutSeconds?: number;

  /** Optional max turns override. When set, overrides config.maxTurns. */
  maxTurnsOverride?: number;

  /** Optional model override. When set, overrides config.model. */
  modelOverride?: string;

  /** Bot mention handles for outgoing sanitization (e.g. ['kodiai', 'claude']). */
  botHandles?: string[];

  /** Optional KnowledgeStore for checkpoint accumulation MCP tools. */
  knowledgeStore?: KnowledgeStore;
  /** Total files in the PR (used for checkpoint coverage metadata). */
  totalFiles?: number;
  /** Enable review checkpoint MCP tool (save_review_checkpoint). */
  enableCheckpointTool?: boolean;

  /** Optional overrides for MCP tool surfaces (used for retry flows). */
  enableInlineTools?: boolean;
  enableCommentTools?: boolean;

  /** Task type for LLM routing and cost tracking (e.g., "review.full", "mention.response"). */
  taskType?: string;

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
  /** Non-success SDK result subtype (e.g., "error_max_turns") when present. */
  failureSubtype?: string;
  /** Final assistant text for successful runs (when provided by SDK). */
  resultText?: string;
  /** Ordered unique tool names observed in assistant tool_use blocks during the run. */
  toolUseNames?: string[];
  /** True when the run used repository-inspection tools (Read/Grep/Glob or git diff/log/show). */
  usedRepoInspectionTools?: boolean;
  /** Structured GitHub publish metadata emitted by MCP tools during execution. */
  publishEvents?: ExecutionPublishEvent[];
  /** Normalized executor-only timing phases captured around ACA handoff/runtime. */
  executorPhaseTimings?: ExecutorPhaseTiming[];
  /** Claude Code usage limit data from the last SDKRateLimitEvent seen during the run. */
  usageLimit?: {
    utilization: number | undefined;
    rateLimitType: string | undefined;
    resetsAt: number | undefined;
  };
};
