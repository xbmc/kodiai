import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import { evaluateSlackV1Rails, type SlackV1BootstrapPayload } from "../slack/safety-rails.ts";
import { createSlackThreadSessionStore, type SlackThreadSessionStore } from "../slack/thread-session-store.ts";
import { toSlackEventCallback } from "../slack/types.ts";
import type { WebhookEvent } from "../webhook/types.ts";
import type { WebhookQueueEntry } from "./types.ts";

export type ReplayQueuedWebhookResult =
  | { status: "dispatched"; source: "github" | "slack" }
  | { status: "ignored"; source: "github" | "slack"; reason: "malformed_json" }
  | { status: "ignored"; source: "slack"; reason: string }
  | { status: "ignored"; source: string; reason: "unsupported_source" };

export async function replayQueuedWebhook(params: {
  entry: WebhookQueueEntry;
  config: AppConfig;
  logger: Logger;
  dispatchGitHubEvent: (event: WebhookEvent) => Promise<void> | void;
  handleSlackAllowedEvent: (payload: SlackV1BootstrapPayload) => Promise<void> | void;
  slackThreadSessionStore?: SlackThreadSessionStore;
}): Promise<ReplayQueuedWebhookResult> {
  const { entry, config, logger, dispatchGitHubEvent, handleSlackAllowedEvent } = params;

  if (entry.source === "github") {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(entry.body) as Record<string, unknown>;
    } catch (err) {
      logger.warn({ err, id: entry.id, source: entry.source }, "Failed to parse queued GitHub webhook body");
      return { status: "ignored", source: "github", reason: "malformed_json" };
    }
    const installation = payload.installation as { id?: unknown } | undefined;
    const installationId = typeof installation?.id === "number" ? installation.id : 0;
    if (typeof installation?.id !== "number") {
      logger.warn({ id: entry.id, source: entry.source }, "Queued GitHub webhook replay missing installation id; dispatching with legacy sentinel");
    }
    await dispatchGitHubEvent({
      id: entry.deliveryId ?? `replay-${entry.id}`,
      name: entry.eventName ?? "unknown",
      payload,
      installationId,
    });
    return { status: "dispatched", source: "github" };
  }

  if (entry.source === "slack") {
    let payload: unknown;
    try {
      payload = JSON.parse(entry.body) as unknown;
    } catch (err) {
      logger.warn({ err, id: entry.id, source: entry.source }, "Failed to parse queued Slack webhook body");
      return { status: "ignored", source: "slack", reason: "malformed_json" };
    }
    const eventCallback = toSlackEventCallback(payload);
    if (!eventCallback) {
      logger.info({ id: entry.id, source: entry.source, reason: "unsupported_payload" }, "Queued Slack webhook replay ignored");
      return { status: "ignored", source: "slack", reason: "unsupported_payload" };
    }

    const threadSessionStore = params.slackThreadSessionStore ?? createSlackThreadSessionStore();
    const decision = evaluateSlackV1Rails({
      payload: eventCallback,
      slackBotUserId: config.slackBotUserId,
      slackKodiaiChannelId: config.slackKodiaiChannelId,
      isThreadSessionStarted: ({ channel, threadTs }) => threadSessionStore.isThreadStarted({ channel, threadTs }),
    });

    if (decision.decision === "ignore") {
      logger.info({ id: entry.id, source: entry.source, reason: decision.reason }, "Queued Slack webhook replay ignored by safety rails");
      return { status: "ignored", source: "slack", reason: decision.reason };
    }

    if (decision.reason === "mention_only_bootstrap") {
      const started = threadSessionStore.markThreadStarted({
        channel: decision.bootstrap.channel,
        threadTs: decision.bootstrap.threadTs,
      });
      if (!started) {
        logger.info({ id: entry.id, source: entry.source, reason: "duplicate_bootstrap" }, "Queued Slack webhook replay ignored as duplicate thread starter");
        return { status: "ignored", source: "slack", reason: "duplicate_bootstrap" };
      }
    }

    await handleSlackAllowedEvent(decision.bootstrap);
    return { status: "dispatched", source: "slack" };
  }

  logger.warn({ id: entry.id, source: entry.source }, "Queued webhook replay ignored: unsupported source");
  return { status: "ignored", source: entry.source, reason: "unsupported_source" };
}
