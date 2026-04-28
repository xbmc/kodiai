import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import { evaluateSlackV1Rails, type SlackV1BootstrapPayload } from "../slack/safety-rails.ts";
import { createSlackThreadSessionStore, type SlackThreadSessionStore } from "../slack/thread-session-store.ts";
import { toSlackEventCallback } from "../slack/types.ts";
import type { WebhookEvent } from "../webhook/types.ts";
import type { WebhookQueueEntry } from "./types.ts";

export type ReplayQueuedWebhookResult =
  | { status: "dispatched"; source: "github" | "slack" }
  | { status: "ignored"; source: "slack"; reason: string }
  | { status: "ignored"; source: string; reason: "unsupported_source" };

export async function replayQueuedWebhook(params: {
  entry: WebhookQueueEntry;
  config: AppConfig;
  logger: Logger;
  dispatchGitHubEvent: (event: WebhookEvent) => Promise<void> | void;
  handleSlackBootstrap: (payload: SlackV1BootstrapPayload) => Promise<void> | void;
  slackThreadSessionStore?: SlackThreadSessionStore;
}): Promise<ReplayQueuedWebhookResult> {
  const { entry, config, logger, dispatchGitHubEvent, handleSlackBootstrap } = params;

  if (entry.source === "github") {
    const payload = JSON.parse(entry.body) as Record<string, unknown>;
    const installation = payload.installation as { id: number } | undefined;
    await dispatchGitHubEvent({
      id: entry.deliveryId ?? `replay-${entry.id}`,
      name: entry.eventName ?? "unknown",
      payload,
      installationId: installation?.id ?? 0,
    });
    return { status: "dispatched", source: "github" };
  }

  if (entry.source === "slack") {
    const payload = JSON.parse(entry.body) as unknown;
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

    await handleSlackBootstrap(decision.bootstrap);
    return { status: "dispatched", source: "slack" };
  }

  logger.warn({ id: entry.id, source: entry.source }, "Queued webhook replay ignored: unsupported source");
  return { status: "ignored", source: entry.source, reason: "unsupported_source" };
}
