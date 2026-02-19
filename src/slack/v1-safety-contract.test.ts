import { describe, expect, test } from "bun:test";
import { evaluateSlackV1Rails } from "./safety-rails.ts";
import type { SlackAddressableEvent, SlackEventCallback } from "./types.ts";

const SLACK_BOT_USER_ID = "U123BOT";
const SLACK_KODIAI_CHANNEL_ID = "C123KODIAI";

function createEventCallback(overrides: Partial<SlackAddressableEvent> = {}): SlackEventCallback {
  return {
    type: "event_callback",
    event: {
      type: "message",
      channel: SLACK_KODIAI_CHANNEL_ID,
      channel_type: "channel",
      ts: "1700000000.000001",
      user: "U123USER",
      text: `<@${SLACK_BOT_USER_ID}> summarize this thread`,
      ...overrides,
    },
  };
}

describe("Slack v1 safety contract regression suite", () => {
  test("SLK80-REG-RAILS-01 ignores events outside #kodiai channel", () => {
    const decision = evaluateSlackV1Rails({
      payload: createEventCallback({ channel: "C999OTHER" }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(decision).toEqual({
      decision: "ignore",
      reason: "outside_kodiai_channel",
    });
  });

  test("SLK80-REG-RAILS-02 allows mention bootstrap with thread-only target", () => {
    const decision = evaluateSlackV1Rails({
      payload: createEventCallback({
        ts: "1700000000.000777",
        text: `<@${SLACK_BOT_USER_ID}> run regression gate`,
      }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
    });

    expect(decision).toEqual({
      decision: "allow",
      reason: "mention_only_bootstrap",
      bootstrap: {
        channel: SLACK_KODIAI_CHANNEL_ID,
        threadTs: "1700000000.000777",
        messageTs: "1700000000.000777",
        user: "U123USER",
        text: `<@${SLACK_BOT_USER_ID}> run regression gate`,
        replyTarget: "thread-only",
      },
    });
  });

  test("SLK80-REG-RAILS-03 ignores thread follow-up before thread session starts", () => {
    const decision = evaluateSlackV1Rails({
      payload: createEventCallback({
        thread_ts: "1700000000.000777",
        ts: "1700000000.000778",
        text: "follow-up without mention token",
      }),
      slackBotUserId: SLACK_BOT_USER_ID,
      slackKodiaiChannelId: SLACK_KODIAI_CHANNEL_ID,
      isThreadSessionStarted: () => false,
    });

    expect(decision).toEqual({
      decision: "ignore",
      reason: "thread_follow_up_out_of_scope",
    });
  });

  test("SLK80-REG-RAILS-04 allows started-thread follow-up with thread-only target", () => {
    const decision = evaluateSlackV1Rails({
      payload: createEventCallback({
        thread_ts: "1700000000.000777",
        ts: "1700000000.000778",
        text: "follow-up without mention token",
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
        threadTs: "1700000000.000777",
        messageTs: "1700000000.000778",
        user: "U123USER",
        text: "follow-up without mention token",
        replyTarget: "thread-only",
      },
    });
  });
});
