import { Hono } from "hono";
import type { AppConfig } from "../src/config.ts";
import { createSlackRelayWebhookRoutes } from "../src/routes/slack-relay-webhooks.ts";
import { parseWebhookRelaySourcesEnv } from "../src/slack/webhook-relay-config.ts";
import { deliverWebhookRelayEvent } from "../src/slack/webhook-relay-delivery.ts";
import type { SlackClient } from "../src/slack/client.ts";
import type { NormalizedWebhookRelayEvent } from "../src/slack/webhook-relay.ts";

export type M052S02StatusCode = "m052_s02_ok" | "m052_s02_integration_drift";
export type M052S02CheckStatus = "pass" | "fail";

export interface M052S02Check {
  id: "M052-S02-DELIVERED" | "M052-S02-SUPPRESSED" | "M052-S02-DELIVERY-FAILED";
  status: M052S02CheckStatus;
  detail: string;
}

export interface RouteSnapshot {
  status: number;
  body: unknown;
}

export interface M052S02Report {
  command: "verify:m052:s02";
  generated_at: string;
  success: boolean;
  status_code: M052S02StatusCode;
  checks: M052S02Check[];
  delivered: RouteSnapshot;
  suppressed: RouteSnapshot;
  deliveryFailed: RouteSnapshot;
  issues: string[];
}

function createSilentLogger() {
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };

  return logger;
}

function buildProofConfig(): AppConfig {
  return {
    githubAppId: "12345",
    githubPrivateKey: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
    webhookSecret: "webhook-secret",
    slackSigningSecret: "slack-signing-secret",
    slackBotToken: "xoxb-test-token",
    slackBotUserId: "U123BOT",
    slackKodiaiChannelId: "C123KODIAI",
    slackDefaultRepo: "xbmc/xbmc",
    slackAssistantModel: "claude-3-5-haiku-latest",
    slackWebhookRelaySources: parseWebhookRelaySourcesEnv(
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
    ),
    port: 3000,
    logLevel: "info",
    botAllowList: [],
    slackWikiChannelId: "",
    wikiStalenessThresholdDays: 30,
    wikiGithubOwner: "xbmc",
    wikiGithubRepo: "xbmc",
    botUserLogin: "",
    botUserPat: "",
    addonRepos: [],
    mcpInternalBaseUrl: "",
    acaJobImage: "",
    acaResourceGroup: "rg-kodiai",
    acaJobName: "caj-kodiai-agent",
  };
}

async function loadFixture(name: "accepted" | "suppressed"): Promise<unknown> {
  return await Bun.file(new URL(`../fixtures/slack-webhook-relay/${name}.json`, import.meta.url)).json();
}

function buildApp(params: {
  postStandaloneMessage: (input: { channel: string; text: string }) => Promise<{ ts: string }>;
}): Hono {
  const slackClient: SlackClient = {
    postStandaloneMessage: params.postStandaloneMessage,
    postThreadMessage: async () => undefined,
    addReaction: async () => undefined,
    removeReaction: async () => undefined,
    getTokenScopes: async () => [],
  };

  const app = new Hono();
  app.route(
    "/webhooks/slack/relay",
    createSlackRelayWebhookRoutes({
      config: buildProofConfig(),
      logger: createSilentLogger() as never,
      onAcceptedRelay: async (event: NormalizedWebhookRelayEvent) => {
        await deliverWebhookRelayEvent({
          slackClient,
          event,
        });
      },
    }),
  );
  return app;
}

async function postRelay(app: Hono, payload: unknown): Promise<RouteSnapshot> {
  const response = await app.request("http://localhost/webhooks/slack/relay/buildkite", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relay-secret": "super-secret",
    },
    body: JSON.stringify(payload),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

function buildCheck(input: { id: M052S02Check["id"]; passed: boolean; detail: string }): M052S02Check {
  return {
    id: input.id,
    status: input.passed ? "pass" : "fail",
    detail: input.detail,
  };
}

export async function evaluateM052S02(opts?: {
  generatedAt?: string;
  acceptedPayload?: unknown;
  suppressedPayload?: unknown;
}): Promise<M052S02Report> {
  const acceptedPayload = opts?.acceptedPayload ?? await loadFixture("accepted");
  const suppressedPayload = opts?.suppressedPayload ?? await loadFixture("suppressed");

  const delivered = await postRelay(
    buildApp({
      postStandaloneMessage: async () => ({ ts: "1700000000.000100" }),
    }),
    acceptedPayload,
  );

  const suppressed = await postRelay(
    buildApp({
      postStandaloneMessage: async () => ({ ts: "1700000000.000100" }),
    }),
    suppressedPayload,
  );

  const deliveryFailed = await postRelay(
    buildApp({
      postStandaloneMessage: async () => {
        throw new Error("slack unavailable");
      },
    }),
    acceptedPayload,
  );

  const checks: M052S02Check[] = [
    buildCheck({
      id: "M052-S02-DELIVERED",
      passed: delivered.status === 202
        && (delivered.body as Record<string, unknown>).verdict === "accept",
      detail: delivered.status === 202
        ? "accepted relay request returned the delivered/accept response"
        : `expected 202 accept response, got ${delivered.status}`,
    }),
    buildCheck({
      id: "M052-S02-SUPPRESSED",
      passed: suppressed.status === 202
        && (suppressed.body as Record<string, unknown>).verdict === "suppress"
        && (suppressed.body as Record<string, unknown>).reason === "text_excluded_substring",
      detail: suppressed.status === 202
        ? "suppressed relay request returned the explicit suppression response"
        : `expected 202 suppress response, got ${suppressed.status}`,
    }),
    buildCheck({
      id: "M052-S02-DELIVERY-FAILED",
      passed: deliveryFailed.status === 502
        && (deliveryFailed.body as Record<string, unknown>).reason === "delivery_failed",
      detail: deliveryFailed.status === 502
        ? "delivery failure returned the explicit relay failure response"
        : `expected 502 delivery_failed response, got ${deliveryFailed.status}`,
    }),
  ];

  const issues = checks.filter((check) => check.status === "fail").map((check) => `${check.id}: ${check.detail}`);

  return {
    command: "verify:m052:s02",
    generated_at: opts?.generatedAt ?? new Date().toISOString(),
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m052_s02_ok" : "m052_s02_integration_drift",
    checks,
    delivered,
    suppressed,
    deliveryFailed,
    issues,
  };
}

function renderHumanReport(report: M052S02Report): string {
  return [
    "# verify:m052:s02",
    "",
    `status: ${report.status_code}`,
    `success: ${report.success ? "yes" : "no"}`,
    "",
    "checks:",
    ...report.checks.map((check) => `- [${check.status === "pass" ? "x" : " "}] ${check.id}: ${check.detail}`),
    ...(report.issues.length > 0 ? ["", "issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

export async function main(
  args: string[] = process.argv.slice(2),
  io?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: typeof evaluateM052S02;
  },
): Promise<number> {
  const stdout = io?.stdout ?? process.stdout;
  const stderr = io?.stderr ?? process.stderr;
  const evaluate = io?.evaluate ?? evaluateM052S02;

  try {
    const report = await evaluate({ generatedAt: new Date().toISOString() });
    if (args.includes("--json")) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      stdout.write(renderHumanReport(report));
    }
    return report.success ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
