import { describe, expect, test } from "bun:test";
import { parseWebhookRelaySourcesEnv } from "./webhook-relay-config.ts";
import { evaluateWebhookRelayPayload } from "./webhook-relay.ts";

const relaySource = parseWebhookRelaySourcesEnv(
  JSON.stringify([
    {
      id: "buildkite",
      targetChannel: "C_BUILD_ALERTS",
      auth: {
        type: "header_secret",
        headerName: "x-relay-secret",
        secret: "super-secret",
      },
      filter: {
        eventTypes: ["build.failed", "build.finished"],
        textIncludes: ["failed"],
        textExcludes: ["flaky"],
      },
    },
  ]),
)[0]!;

async function readFixture(name: "accepted" | "suppressed") {
  return Bun.file(new URL(`../../fixtures/slack-webhook-relay/${name}.json`, import.meta.url)).json();
}

describe("evaluateWebhookRelayPayload", () => {
  test("accepts a valid relay payload and normalizes it into the stable event shape", async () => {
    const payload = await readFixture("accepted");

    const result = evaluateWebhookRelayPayload({
      source: relaySource,
      payload,
    });

    expect(result).toEqual({
      verdict: "accept",
      event: {
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
      },
    });
  });

  test("suppresses relay payloads whose text matches an excluded substring", async () => {
    const payload = await readFixture("suppressed");

    const result = evaluateWebhookRelayPayload({
      source: relaySource,
      payload,
    });

    expect(result).toEqual({
      verdict: "suppress",
      reason: "text_excluded_substring",
      sourceId: "buildkite",
      eventType: "build.failed",
      detail: "flaky",
    });
  });

  test("suppresses relay payloads whose event type is not allowlisted", () => {
    const result = evaluateWebhookRelayPayload({
      source: relaySource,
      payload: {
        eventType: "build.started",
        title: "Build started",
        summary: "CI started for xbmc/xbmc.",
        url: "https://ci.example.test/builds/125",
        text: "Build started for xbmc/xbmc on main.",
      },
    });

    expect(result).toEqual({
      verdict: "suppress",
      reason: "event_type_not_allowed",
      sourceId: "buildkite",
      eventType: "build.started",
      detail: "build.started",
    });
  });

  test("returns explicit invalid diagnostics for malformed payloads", () => {
    const result = evaluateWebhookRelayPayload({
      source: relaySource,
      payload: {
        eventType: "build.failed",
        title: "Missing text",
        summary: "This payload forgot the required text field.",
        url: "not-a-url",
      },
    });

    expect(result).toEqual({
      verdict: "invalid",
      reason: "malformed_payload",
      sourceId: "buildkite",
      issues: ["text", "url"],
    });
  });
});
