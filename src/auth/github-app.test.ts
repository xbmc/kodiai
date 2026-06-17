import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import {
  DEFAULT_GITHUB_REQUEST_TIMEOUT_MS,
  createGitHubApp,
} from "./github-app.ts";

const config = {
  githubAppId: "12345",
  githubPrivateKey: "test-private-key",
  webhookSecret: "webhook-secret",
  slackSigningSecret: "slack-signing-secret",
  slackBotToken: "slack-bot-token",
  slackBotUserId: "U123",
  slackKodiaiChannelId: "C123",
  slackDefaultRepo: "xbmc/xbmc",
  slackAssistantModel: "claude-3-5-haiku-latest",
  slackWebhookRelaySources: [],
  port: 3000,
  logLevel: "silent",
  botAllowList: [],
  slackWikiChannelId: "",
  wikiStalenessThresholdDays: 30,
  wikiGithubOwner: "xbmc",
  wikiGithubRepo: "xbmc",
  botUserPat: "",
  botUserLogin: "",
  addonRepos: [],
  mcpInternalBaseUrl: "http://ca-kodiai",
  acaJobImage: "kodiairegistry.azurecr.io/kodiai-agent:latest",
  acaResourceGroup: "rg-kodiai",
  acaJobName: "caj-kodiai-agent",
} satisfies AppConfig;

const logger = {
  debug: mock(() => undefined),
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
} as unknown as Logger;

describe("createGitHubApp", () => {
  test("uses the default Octokit request timeout for installation clients", async () => {
    const app = createGitHubApp(config, logger);

    const octokit = await app.getInstallationOctokit(99);

    expect(octokit.request.endpoint.DEFAULTS.request?.timeout).toBe(DEFAULT_GITHUB_REQUEST_TIMEOUT_MS);
  });

  test("preserves explicit installation Octokit request timeout overrides", async () => {
    const app = createGitHubApp(config, logger);

    const octokit = await app.getInstallationOctokit(99, { requestTimeoutMs: 1_234 });

    expect(octokit.request.endpoint.DEFAULTS.request?.timeout).toBe(1_234);
  });

  test("reuses installation clients for the same installation and timeout", async () => {
    const app = createGitHubApp(config, logger);

    const first = await app.getInstallationOctokit(99);
    const second = await app.getInstallationOctokit(99);

    expect(second).toBe(first);
  });

  test("keeps installation client cache entries separate by timeout", async () => {
    const app = createGitHubApp(config, logger);

    const defaultTimeout = await app.getInstallationOctokit(99);
    const customTimeout = await app.getInstallationOctokit(99, { requestTimeoutMs: 1_234 });

    expect(customTimeout).not.toBe(defaultTimeout);
    expect(customTimeout.request.endpoint.DEFAULTS.request?.timeout).toBe(1_234);
  });
});
