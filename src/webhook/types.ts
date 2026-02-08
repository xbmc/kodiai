export interface WebhookEvent {
  /** The X-GitHub-Delivery header value */
  id: string;
  /** The X-GitHub-Event header value (e.g., "pull_request", "issue_comment") */
  name: string;
  /** The parsed webhook payload */
  payload: Record<string, unknown>;
  /** Installation ID extracted from payload.installation.id */
  installationId: number;
}

export type EventHandler = (event: WebhookEvent) => Promise<void>;

export interface BotFilter {
  /** Returns true if the event from this sender should be processed, false to drop it. */
  shouldProcess(sender: { type: string; login: string }): boolean;
}

export interface EventRouter {
  /** Register a handler for a specific event key (e.g., "pull_request.opened" or "pull_request"). */
  register(eventKey: string, handler: EventHandler): void;
  /** Dispatch a webhook event to all matching registered handlers. */
  dispatch(event: WebhookEvent): Promise<void>;
}

export type { AppConfig } from "../config.ts";
