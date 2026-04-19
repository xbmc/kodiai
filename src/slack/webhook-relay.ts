import { z } from "zod";
import type { SlackWebhookRelaySource } from "./webhook-relay-config.ts";

const webhookRelayPayloadSchema = z.object({
  eventType: z.string().trim().min(1, "eventType is required"),
  title: z.string().trim().min(1, "title is required"),
  summary: z.string().trim().min(1, "summary is required"),
  url: z.string().url("url must be a valid URL"),
  text: z.string().trim().min(1, "text is required"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export interface NormalizedWebhookRelayEvent {
  sourceId: string;
  targetChannel: string;
  eventType: string;
  title: string;
  summary: string;
  url: string;
  text: string;
  metadata: Record<string, unknown>;
  filterMetadata: SlackWebhookRelaySource["filter"];
}

export type WebhookRelayEvaluationResult =
  | { verdict: "accept"; event: NormalizedWebhookRelayEvent }
  | {
      verdict: "suppress";
      reason: "event_type_not_allowed" | "text_missing_required_substring" | "text_excluded_substring";
      sourceId: string;
      eventType: string;
      detail: string;
    }
  | {
      verdict: "invalid";
      reason: "malformed_payload";
      sourceId: string;
      issues: string[];
    };

function normalizePayloadIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): string[] {
  return issues
    .map((issue) => issue.path.join("."))
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));
}

export function evaluateWebhookRelayPayload(input: {
  source: SlackWebhookRelaySource;
  payload: unknown;
}): WebhookRelayEvaluationResult {
  const payloadResult = webhookRelayPayloadSchema.safeParse(input.payload);
  if (!payloadResult.success) {
    return {
      verdict: "invalid",
      reason: "malformed_payload",
      sourceId: input.source.id,
      issues: normalizePayloadIssues(payloadResult.error.issues),
    };
  }

  const payload = payloadResult.data;
  const { filter } = input.source;

  if (filter.eventTypes.length > 0 && !filter.eventTypes.includes(payload.eventType)) {
    return {
      verdict: "suppress",
      reason: "event_type_not_allowed",
      sourceId: input.source.id,
      eventType: payload.eventType,
      detail: payload.eventType,
    };
  }

  const normalizedText = payload.text.toLowerCase();
  const missingRequiredSubstring = filter.textIncludes.find(
    (substring) => !normalizedText.includes(substring.toLowerCase()),
  );
  if (missingRequiredSubstring) {
    return {
      verdict: "suppress",
      reason: "text_missing_required_substring",
      sourceId: input.source.id,
      eventType: payload.eventType,
      detail: missingRequiredSubstring,
    };
  }

  const excludedSubstring = filter.textExcludes.find(
    (substring) => normalizedText.includes(substring.toLowerCase()),
  );
  if (excludedSubstring) {
    return {
      verdict: "suppress",
      reason: "text_excluded_substring",
      sourceId: input.source.id,
      eventType: payload.eventType,
      detail: excludedSubstring,
    };
  }

  return {
    verdict: "accept",
    event: {
      sourceId: input.source.id,
      targetChannel: input.source.targetChannel,
      eventType: payload.eventType,
      title: payload.title,
      summary: payload.summary,
      url: payload.url,
      text: payload.text,
      metadata: payload.metadata ?? {},
      filterMetadata: input.source.filter,
    },
  };
}
