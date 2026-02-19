type SlackRecord = Record<string, unknown>;

function asRecord(value: unknown): SlackRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as SlackRecord;
}

function getString(record: SlackRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export interface SlackAddressableEvent {
  type: "message" | "app_mention";
  subtype?: string;
  channel?: string;
  channel_type?: string;
  thread_ts?: string;
  ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
}

export interface SlackGenericEvent {
  type?: string;
}

export interface SlackEventCallback {
  type: "event_callback";
  event: SlackAddressableEvent | SlackGenericEvent;
}

export interface SlackUrlVerificationPayload {
  type: "url_verification";
  challenge: string;
}

function parseAddressableEvent(event: SlackRecord, type: "message" | "app_mention"): SlackAddressableEvent {
  return {
    type,
    subtype: getString(event, "subtype"),
    channel: getString(event, "channel"),
    channel_type: getString(event, "channel_type"),
    thread_ts: getString(event, "thread_ts"),
    ts: getString(event, "ts"),
    user: getString(event, "user"),
    bot_id: getString(event, "bot_id"),
    text: getString(event, "text"),
  };
}

export function toSlackUrlVerification(payload: unknown): SlackUrlVerificationPayload | null {
  const record = asRecord(payload);
  if (!record || record.type !== "url_verification") {
    return null;
  }

  const challenge = getString(record, "challenge");
  if (!challenge) {
    return null;
  }

  return {
    type: "url_verification",
    challenge,
  };
}

export function toSlackEventCallback(payload: unknown): SlackEventCallback | null {
  const record = asRecord(payload);
  if (!record || record.type !== "event_callback") {
    return null;
  }

  const eventRecord = asRecord(record.event);
  if (!eventRecord) {
    return null;
  }

  const eventType = getString(eventRecord, "type");
  if (eventType === "message" || eventType === "app_mention") {
    return {
      type: "event_callback",
      event: parseAddressableEvent(eventRecord, eventType),
    };
  }

  return {
    type: "event_callback",
    event: {
      type: eventType,
    },
  };
}
