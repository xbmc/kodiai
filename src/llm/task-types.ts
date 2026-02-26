/**
 * Task type taxonomy for LLM routing.
 *
 * Uses dot-separated hierarchy (e.g., "review.full", "slack.response").
 * Task types determine which model and SDK are used for each invocation.
 */

/** All known task type string literals. */
export const TASK_TYPES = {
  /** Full PR review (agentic, Agent SDK default). */
  REVIEW_FULL: "review.full",
  /** PR summary label generation (non-agentic). */
  REVIEW_SUMMARY: "review.summary",
  /** @mention handling (agentic, Agent SDK default). */
  MENTION_RESPONSE: "mention.response",
  /** Slack thread responses (agentic, Agent SDK default). */
  SLACK_RESPONSE: "slack.response",
  /** Cluster label generation (non-agentic, future Phase 100). */
  CLUSTER_LABEL: "cluster.label",
  /** Wiki staleness evaluation (non-agentic, future Phase 99). */
  STALENESS_EVIDENCE: "staleness.evidence",
} as const;

/** Union type of all valid task type strings. */
export type TaskType = (typeof TASK_TYPES)[keyof typeof TASK_TYPES];

/**
 * Set of task types that default to Agent SDK (agentic tasks).
 * These are tasks that use MCP tools and ephemeral workspaces.
 */
export const AGENTIC_TASK_TYPES: Set<string> = new Set([
  TASK_TYPES.REVIEW_FULL,
  TASK_TYPES.MENTION_RESPONSE,
  TASK_TYPES.SLACK_RESPONSE,
]);

/**
 * Returns true for task types that default to Agent SDK.
 * Agentic task types use MCP tools and ephemeral workspaces.
 */
export function isAgenticTaskType(taskType: string): boolean {
  return AGENTIC_TASK_TYPES.has(taskType);
}
