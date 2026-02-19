import { describe, expect, test } from "bun:test";
import { evaluateSlackV1Rails } from "./safety-rails.ts";
import type { SlackAddressableEvent, SlackEventCallback } from "./types.ts";

const SLACK_BOT_USER_ID = "U123BOT";
const SLACK_KODIAI_CHANNEL_ID = "C123KODIAI";

function messageEventCallback(overrides: Partial<SlackAddressableEvent> = {}): SlackEventCallback {
  return {
    type: "event_callback",
    event: {
      type: "message",
      channel: SLACK_KODIAI_CHANNEL_ID,
      channel_type: "channel",
      ts: "1700000000.000001",
      user: "U123USER",
      text: "<@U123BOT> help me with this",
      ...overrides,
    },
  };
}

function appMentionEventCallback(overrides: Partial<SlackAddressableEvent> = {}): SlackEventCallback {
  return {
    type: "event_callback",
    event: {
      type: "app_mention",
      channel: SLACK_KODIAI_CHANNEL_ID,
      channel_type: "channel",
      ts: "1700000000.000002",
      user: "U123USER",
      text: "<@U123BOT> help me with this",
      ...overrides,
    },
  };
}

describe("evaluateSlackV1Rails", () => {
  test("allows top-level bootstrap in #kodiai and returns thread-only target", () => {
    const decision = evaluateSlackV1Rails({
      payload: messageEventCallback(),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(decision).toEqual({
      decision: "allow",
      reason: "mention_only_bootstrap",
      bootstrap: {
        channel: SLACK_KODIAI_CHANNEL_ID,
        threadTs: "1700000000.000001",
        messageTs: "1700000000.000001",
        user: "U123USER",
        text: "<@U123BOT> help me with this",
        replyTarget: "thread-only",
      },
    });
  });

  test("allows app_mention bootstrap in #kodiai and returns thread-only target", () => {
    const decision = evaluateSlackV1Rails({
      payload: appMentionEventCallback(),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(decision).toEqual({
      decision: "allow",
      reason: "mention_only_bootstrap",
      bootstrap: {
        channel: SLACK_KODIAI_CHANNEL_ID,
        threadTs: "1700000000.000002",
        messageTs: "1700000000.000002",
        user: "U123USER",
        text: "<@U123BOT> help me with this",
        replyTarget: "thread-only",
      },
    });
  });

  test("ignores event callbacks that are not message events", () => {
    const decision = evaluateSlackV1Rails({
      payload: {
        type: "event_callback",
        event: { type: "reaction_added" },
      },
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(decision).toEqual({ decision: "ignore", reason: "unsupported_event_type" });
  });

  test("ignores DM and group DM surfaces", () => {
    const dmDecision = evaluateSlackV1Rails({
      payload: messageEventCallback({ channel_type: "im" }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });
    const mpimDecision = evaluateSlackV1Rails({
      payload: messageEventCallback({ channel_type: "mpim" }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(dmDecision).toEqual({ decision: "ignore", reason: "dm_surface_not_allowed" });
    expect(mpimDecision).toEqual({ decision: "ignore", reason: "dm_surface_not_allowed" });
  });

  test("ignores messages outside #kodiai", () => {
    const decision = evaluateSlackV1Rails({
      payload: messageEventCallback({ channel: "C999OTHER" }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(decision).toEqual({ decision: "ignore", reason: "outside_kodiai_channel" });
  });

  test("ignores bot and system messages", () => {
    const subtypeDecision = evaluateSlackV1Rails({
      payload: messageEventCallback({ subtype: "message_changed" }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });
    const botDecision = evaluateSlackV1Rails({
      payload: messageEventCallback({ bot_id: "B123BOT" }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(subtypeDecision).toEqual({ decision: "ignore", reason: "unsupported_message_subtype" });
    expect(botDecision).toEqual({ decision: "ignore", reason: "bot_or_system_message" });
  });

  test("ignores thread follow-ups for v1 bootstrap-only behavior", () => {
    const decision = evaluateSlackV1Rails({
      payload: messageEventCallback({ thread_ts: "1700000000.000001" }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(decision).toEqual({ decision: "ignore", reason: "thread_follow_up_out_of_scope" });
  });

  test("allows in-thread follow-up when thread session is started", () => {
    const decision = evaluateSlackV1Rails({
      payload: messageEventCallback({
        thread_ts: "1700000000.000001",
        text: "follow-up without mention",
      }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
      isThreadSessionStarted: () => true,
    });

    expect(decision).toEqual({
      decision: "allow",
      reason: "thread_session_follow_up",
      bootstrap: {
        channel: SLACK_KODIAI_CHANNEL_ID,
        threadTs: "1700000000.000001",
        messageTs: "1700000000.000001",
        user: "U123USER",
        text: "follow-up without mention",
        replyTarget: "thread-only",
      },
    });
  });

  test("ignores in-thread follow-up when thread session is not started", () => {
    const decision = evaluateSlackV1Rails({
      payload: messageEventCallback({
        thread_ts: "1700000000.000001",
        text: "follow-up without mention",
      }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
      isThreadSessionStarted: () => false,
    });

    expect(decision).toEqual({ decision: "ignore", reason: "thread_follow_up_out_of_scope" });
  });

  test("ignores top-level messages without @kodiai mention", () => {
    const decision = evaluateSlackV1Rails({
      payload: messageEventCallback({ text: "hello team" }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(decision).toEqual({ decision: "ignore", reason: "missing_bootstrap_mention" });
  });

  test("ignores malformed messages with missing required fields", () => {
    const missingUser = evaluateSlackV1Rails({
      payload: messageEventCallback({ user: undefined }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });
    const missingText = evaluateSlackV1Rails({
      payload: messageEventCallback({ text: undefined }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });
    const missingTs = evaluateSlackV1Rails({
      payload: messageEventCallback({ ts: undefined }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(missingUser).toEqual({ decision: "ignore", reason: "missing_user" });
    expect(missingText).toEqual({ decision: "ignore", reason: "missing_text" });
    expect(missingTs).toEqual({ decision: "ignore", reason: "missing_event_ts" });
  });
});
