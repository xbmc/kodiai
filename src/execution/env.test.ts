import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { buildAgentEnv, AGENT_ENV_ALLOWLIST } from "./env.ts";

/**
 * Snapshot pattern: save and restore the specific keys we mutate so each test
 * runs against a clean process.env without polluting subsequent tests.
 */
const APPLICATION_SECRET_KEYS = [
  "GITHUB_PRIVATE_KEY",
  "GITHUB_PRIVATE_KEY_BASE64",
  "GITHUB_APP_ID",
  "GITHUB_WEBHOOK_SECRET",
  "DATABASE_URL",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "VOYAGE_API_KEY",
  "BOT_USER_PAT",
];

const SDK_AUTH_KEYS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];

const SYSTEM_KEYS = ["HOME", "PATH", "USER"];

const ALL_TEST_KEYS = [
  ...APPLICATION_SECRET_KEYS,
  ...SDK_AUTH_KEYS,
  ...SYSTEM_KEYS,
  "SOME_UNKNOWN_SECRET",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ALL_TEST_KEYS) {
    saved[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of ALL_TEST_KEYS) {
    const prev = saved[key];
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
});

describe("AGENT_ENV_ALLOWLIST", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(AGENT_ENV_ALLOWLIST)).toBe(true);
    expect(AGENT_ENV_ALLOWLIST.length).toBeGreaterThan(0);
  });

  test("includes SDK auth vars", () => {
    expect(AGENT_ENV_ALLOWLIST).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(AGENT_ENV_ALLOWLIST).toContain("ANTHROPIC_API_KEY");
  });

  test("does not include CLAUDE_CODE_ENTRYPOINT (callers set it)", () => {
    expect(AGENT_ENV_ALLOWLIST).not.toContain("CLAUDE_CODE_ENTRYPOINT");
  });
});

describe("buildAgentEnv", () => {
  test("blocks application secret keys", () => {
    // Inject secrets into process.env
    for (const key of APPLICATION_SECRET_KEYS) {
      process.env[key] = `test-secret-${key}`;
    }

    const env = buildAgentEnv();

    for (const key of APPLICATION_SECRET_KEYS) {
      expect(env[key]).toBeUndefined();
    }
  });

  test("forwards SDK auth vars when set", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-oauth-token";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    const env = buildAgentEnv();

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("test-oauth-token");
    expect(env.ANTHROPIC_API_KEY).toBe("test-anthropic-key");
  });

  test("forwards system vars when set", () => {
    process.env.HOME = "/test-home";
    process.env.PATH = "/usr/bin";
    process.env.USER = "testuser";

    const env = buildAgentEnv();

    expect(env.HOME).toBe("/test-home");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.USER).toBe("testuser");
  });

  test("blocks unknown arbitrary vars", () => {
    process.env.SOME_UNKNOWN_SECRET = "should-not-leak";

    const env = buildAgentEnv();

    expect(env.SOME_UNKNOWN_SECRET).toBeUndefined();
  });

  test("omits allowlisted keys that are not set in process.env", () => {
    // Delete an allowlisted key to ensure it's absent rather than set to undefined
    delete process.env.TMPDIR;

    const env = buildAgentEnv();

    // The key should simply be absent (not `undefined` as a value)
    expect(Object.prototype.hasOwnProperty.call(env, "TMPDIR")).toBe(false);
  });

  test("returns a plain object (not process.env itself)", () => {
    const env = buildAgentEnv();
    expect(env).not.toBe(process.env);
  });

  test("does not include CLAUDE_CODE_ENTRYPOINT", () => {
    // Even if somehow set, the entrypoint must not leak through — callers set it
    const env = buildAgentEnv();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
  });
});
