import type { SlackAddressableEvent, SlackEventCallback } from "./types.ts";
import type { SlackThreadSessionKeyInput } from "./thread-session-store.ts";

export type SlackV1IgnoreReason =
  | "unsupported_event_type"
  | "outside_kodiai_channel"
  | "dm_surface_not_allowed"
  | "unsupported_message_subtype"
  | "bot_or_system_message"
  | "thread_follow_up_out_of_scope"
  | "missing_bootstrap_mention"
  | "missing_event_ts"
  | "missing_user"
  | "missing_text";

export interface SlackV1BootstrapPayload {
  channel: string;
  threadTs: string;
  messageTs: string;
  user: string;
  text: string;
  replyTarget: "thread-only";
}

export type SlackV1RailDecision =
  | {
      decision: "allow";
      reason: "mention_only_bootstrap" | "thread_session_follow_up";
      bootstrap: SlackV1BootstrapPayload;
    }
  | {
      decision: "ignore";
      reason: SlackV1IgnoreReason;
    };

interface EvaluateSlackV1RailsInput {
  payload: SlackEventCallback;
  slackBotUserId: string;
  slackKodiaiChannelId: string;
  isThreadSessionStarted?: (input: SlackThreadSessionKeyInput) => boolean;
}

function isSlackAddressableEvent(event: SlackEventCallback["event"]): event is SlackAddressableEvent {
  return event.type === "message" || event.type === "app_mention";
}

function isDmSurface(event: SlackAddressableEvent): boolean {
  return event.channel_type === "im" || event.channel_type === "mpim";
}

function buildMentionToken(slackBotUserId: string): string {
  return `<@${slackBotUserId}>`;
}

export function evaluateSlackV1Rails(input: EvaluateSlackV1RailsInput): SlackV1RailDecision {
  const { payload, slackBotUserId, slackKodiaiChannelId, isThreadSessionStarted } = input;
  const event = payload.event;

  if (!isSlackAddressableEvent(event)) {
    return { decision: "ignore", reason: "unsupported_event_type" };
  }

  if (isDmSurface(event)) {
    return { decision: "ignore", reason: "dm_surface_not_allowed" };
  }

  if (event.channel !== slackKodiaiChannelId) {
    return { decision: "ignore", reason: "outside_kodiai_channel" };
  }

  if (event.subtype) {
    return { decision: "ignore", reason: "unsupported_message_subtype" };
  }

  if (event.bot_id) {
    return { decision: "ignore", reason: "bot_or_system_message" };
  }

  if (!event.user) {
    return { decision: "ignore", reason: "missing_user" };
  }

  if (!event.text) {
    return { decision: "ignore", reason: "missing_text" };
  }

  if (!event.ts) {
    return { decision: "ignore", reason: "missing_event_ts" };
  }

  if (event.thread_ts) {
    if (
      isThreadSessionStarted?.({
        channel: event.channel,
        threadTs: event.thread_ts,
      })
    ) {
      return {
        decision: "allow",
        reason: "thread_session_follow_up",
        bootstrap: {
          channel: event.channel,
          threadTs: event.thread_ts,
          messageTs: event.ts,
          user: event.user,
          text: event.text,
          replyTarget: "thread-only",
        },
      };
    }

    return { decision: "ignore", reason: "thread_follow_up_out_of_scope" };
  }

  const mentionToken = buildMentionToken(slackBotUserId);
  const hasFormattedMention = event.text.includes(mentionToken);
  const hasPlainMention = /(?<![\w-])@kodiai(?![\w-])/i.test(event.text);
  if (!hasFormattedMention && !hasPlainMention) {
    return { decision: "ignore", reason: "missing_bootstrap_mention" };
  }

  return {
    decision: "allow",
    reason: "mention_only_bootstrap",
    bootstrap: {
      channel: event.channel,
      threadTs: event.ts,
      messageTs: event.ts,
      user: event.user,
      text: event.text,
      replyTarget: "thread-only",
    },
  };
}
