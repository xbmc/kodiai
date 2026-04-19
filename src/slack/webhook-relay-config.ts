import { z } from "zod";

const relayFilterSchema = z.object({
  eventTypes: z.array(z.string().trim().min(1, "eventTypes entries must be non-empty")).default([]),
  textIncludes: z.array(z.string().trim().min(1, "textIncludes entries must be non-empty")).default([]),
  textExcludes: z.array(z.string().trim().min(1, "textExcludes entries must be non-empty")).default([]),
}).default(() => ({
  eventTypes: [],
  textIncludes: [],
  textExcludes: [],
}));

const headerSecretAuthSchema = z.object({
  type: z.literal("header_secret"),
  headerName: z.string().trim().min(1, "headerName is required"),
  secret: z.string().min(1, "secret is required"),
});

export const webhookRelaySourceSchema = z.object({
  id: z.string().trim().min(1, "id is required"),
  targetChannel: z.string().trim().min(1, "targetChannel is required"),
  auth: headerSecretAuthSchema,
  filter: relayFilterSchema,
});

export type SlackWebhookRelaySource = z.infer<typeof webhookRelaySourceSchema>;

function describeInvalidSourceId(source: unknown, index: number): string {
  if (
    typeof source === "object"
    && source !== null
    && "id" in source
    && typeof (source as { id?: unknown }).id === "string"
    && (source as { id: string }).id.trim().length > 0
  ) {
    return (source as { id: string }).id.trim();
  }

  return `#${index}`;
}

export function parseWebhookRelaySourcesEnv(rawValue: string | undefined): SlackWebhookRelaySource[] {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("SLACK_WEBHOOK_RELAY_SOURCES must be valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("SLACK_WEBHOOK_RELAY_SOURCES must be a JSON array");
  }

  const seenIds = new Set<string>();

  return parsed.map((source, index) => {
    const result = webhookRelaySourceSchema.safeParse(source);
    if (!result.success) {
      const fieldPath = result.error.issues[0]?.path.join(".") || "unknown";
      const sourceId = describeInvalidSourceId(source, index);
      throw new Error(`SLACK_WEBHOOK_RELAY_SOURCES source "${sourceId}" invalid: ${fieldPath}`);
    }

    if (seenIds.has(result.data.id)) {
      throw new Error(`Duplicate Slack webhook relay source id: "${result.data.id}"`);
    }

    seenIds.add(result.data.id);
    return result.data;
  });
}
