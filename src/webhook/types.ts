export interface WebhookEvent {
  /** The X-GitHub-Delivery header value */
  id: string;
  /** The X-GitHub-Event header value (e.g., "pull_request", "issue_comment") */
  name: string;
  /** The parsed webhook payload */
  payload: Record<string, unknown>;
}

export type EventHandler = (event: WebhookEvent) => Promise<void>;

export type { AppConfig } from "../config.ts";
