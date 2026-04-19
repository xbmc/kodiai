import { describe, expect, test } from "bun:test";
import type { SlackClient } from "./client.ts";
import type { NormalizedWebhookRelayEvent } from "./webhook-relay.ts";
import {
  deliverWebhookRelayEvent,
  formatWebhookRelayMessage,
} from "./webhook-relay-delivery.ts";

function makeEvent(): NormalizedWebhookRelayEvent {
  return {
    sourceId: "buildkite",
    targetChannel: "C_BUILD_ALERTS",
    eventType: "build.failed",
    title: "Build failed on main",
    summary: "CI failed for xbmc/xbmc after the latest merge.",
    url: "https://ci.example.test/builds/123",
    text: "Build failed for xbmc/xbmc on main after merge 09f28d7.",
    metadata: {
      pipeline: "main",
      provider: "buildkite",
    },
    filterMetadata: {
      eventTypes: ["build.failed", "build.finished"],
      textIncludes: ["failed"],
      textExcludes: ["flaky"],
    },
  };
}

describe("formatWebhookRelayMessage", () => {
  test("formats one standalone Slack message from the normalized relay event", () => {
    expect(formatWebhookRelayMessage(makeEvent())).toBe([
      "*Build failed on main*",
      "CI failed for xbmc/xbmc after the latest merge.",
      "Build failed for xbmc/xbmc on main after merge 09f28d7.",
      "<https://ci.example.test/builds/123|Open event>",
      "Source: `buildkite` · Event: `build.failed`",
    ].join("\n"));
  });
});

describe("deliverWebhookRelayEvent", () => {
  test("posts the formatted relay message through SlackClient.postStandaloneMessage", async () => {
    const calls: Array<{ channel: string; text: string }> = [];
    const slackClient: SlackClient = {
      postStandaloneMessage: async (input) => {
        calls.push(input);
        return { ts: "1700000000.000100" };
      },
      postThreadMessage: async () => undefined,
      addReaction: async () => undefined,
      removeReaction: async () => undefined,
      getTokenScopes: async () => [],
    };

    const result = await deliverWebhookRelayEvent({
      slackClient,
      event: makeEvent(),
    });

    expect(result).toEqual({
      channel: "C_BUILD_ALERTS",
      timestamp: "1700000000.000100",
      sourceId: "buildkite",
      eventType: "build.failed",
    });
    expect(calls).toEqual([
      {
        channel: "C_BUILD_ALERTS",
        text: [
          "*Build failed on main*",
          "CI failed for xbmc/xbmc after the latest merge.",
          "Build failed for xbmc/xbmc on main after merge 09f28d7.",
          "<https://ci.example.test/builds/123|Open event>",
          "Source: `buildkite` · Event: `build.failed`",
        ].join("\n"),
      },
    ]);
  });
});
