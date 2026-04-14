import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

const REQUIRED_ENV: Record<string, string> = {
  GITHUB_APP_ID: "123",
  GITHUB_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
  GITHUB_WEBHOOK_SECRET: "secret",
  SLACK_SIGNING_SECRET: "slack-signing-secret",
  SLACK_BOT_TOKEN: "xoxb-test-token",
  SLACK_BOT_USER_ID: "U123456",
  SLACK_KODIAI_CHANNEL_ID: "C123456",
  DATABASE_URL: "postgres://example:example@localhost:5432/kodiai_test",
};

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  savedEnv.MCP_INTERNAL_BASE_URL = process.env.MCP_INTERNAL_BASE_URL;
  delete process.env.MCP_INTERNAL_BASE_URL;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("loadConfig", () => {
  test("defaults MCP internal base URL to the internal ACA app host without the external route suffix or port", async () => {
    const config = await loadConfig();
    expect(config.mcpInternalBaseUrl).toBe("http://ca-kodiai");
  });
});
