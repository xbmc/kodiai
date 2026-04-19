import type { SlackClient } from "./client.ts";
import type { NormalizedWebhookRelayEvent } from "./webhook-relay.ts";

export function formatWebhookRelayMessage(event: NormalizedWebhookRelayEvent): string {
  return [
    `*${event.title}*`,
    event.summary,
    event.text,
    `<${event.url}|Open event>`,
    `Source: \`${event.sourceId}\` · Event: \`${event.eventType}\``,
  ].join("\n");
}

export async function deliverWebhookRelayEvent(input: {
  slackClient: SlackClient;
  event: NormalizedWebhookRelayEvent;
}): Promise<{
  channel: string;
  timestamp: string;
  sourceId: string;
  eventType: string;
}> {
  const text = formatWebhookRelayMessage(input.event);
  const result = await input.slackClient.postStandaloneMessage({
    channel: input.event.targetChannel,
    text,
  });

  return {
    channel: input.event.targetChannel,
    timestamp: result.ts,
    sourceId: input.event.sourceId,
    eventType: input.event.eventType,
  };
}
