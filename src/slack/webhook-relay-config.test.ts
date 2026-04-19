import { describe, expect, test } from "bun:test";
import { parseWebhookRelaySourcesEnv } from "./webhook-relay-config.ts";

describe("parseWebhookRelaySourcesEnv", () => {
  test("returns an empty list when relay sources are not configured", () => {
    expect(parseWebhookRelaySourcesEnv(undefined)).toEqual([]);
    expect(parseWebhookRelaySourcesEnv("")).toEqual([]);
  });

  test("parses a valid relay source definition", () => {
    const parsed = parseWebhookRelaySourcesEnv(
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
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
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
    });
  });

  test("fails loudly on malformed JSON", () => {
    expect(() => parseWebhookRelaySourcesEnv("{"))
      .toThrow("SLACK_WEBHOOK_RELAY_SOURCES must be valid JSON");
  });

  test("fails loudly with source-specific diagnostics when a source is malformed", () => {
    expect(() =>
      parseWebhookRelaySourcesEnv(
        JSON.stringify([
          {
            id: "buildkite",
            targetChannel: "",
            auth: {
              type: "header_secret",
              headerName: "x-relay-secret",
              secret: "super-secret",
            },
          },
        ]),
      ),
    ).toThrow('SLACK_WEBHOOK_RELAY_SOURCES source "buildkite" invalid: targetChannel');
  });

  test("fails loudly when duplicate source ids are configured", () => {
    expect(() =>
      parseWebhookRelaySourcesEnv(
        JSON.stringify([
          {
            id: "buildkite",
            targetChannel: "C_BUILD_ALERTS",
            auth: {
              type: "header_secret",
              headerName: "x-relay-secret",
              secret: "super-secret",
            },
          },
          {
            id: "buildkite",
            targetChannel: "C_OTHER_ALERTS",
            auth: {
              type: "header_secret",
              headerName: "x-relay-secret",
              secret: "super-secret-2",
            },
          },
        ]),
      ),
    ).toThrow('Duplicate Slack webhook relay source id: "buildkite"');
  });
});
