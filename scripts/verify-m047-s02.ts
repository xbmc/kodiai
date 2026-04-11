import { createHmac } from "node:crypto";
import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../src/config.ts";
import { resetIdentitySuggestionStateForTests, suggestIdentityLink } from "../src/handlers/identity-suggest.ts";
import {
  CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
} from "../src/contributor/profile-trust.ts";
import type {
  ContributorProfile,
  ContributorProfileStore,
} from "../src/contributor/types.ts";
import { createSlackCommandRoutes } from "../src/routes/slack-commands.ts";

const SLACK_SIGNING_SECRET = "test-slash-signing-secret";

export const M047_S02_CHECK_IDS = [
  "M047-S02-SIGNED-SLASH-CONTINUITY-CONTRACT",
  "M047-S02-IDENTITY-SUGGESTION-CONTRACT",
] as const;

export const M047_S02_ROUTE_SCENARIO_IDS = [
  "link-generic-continuity",
  "profile-opt-in-generic-continuity",
  "link-profile-backed-continuity",
] as const;

export const M047_S02_IDENTITY_SCENARIO_IDS = [
  "opted-out-linked-profile",
  "high-confidence-match-dm",
  "slack-api-failure-warning",
] as const;

export type M047S02CheckId = (typeof M047_S02_CHECK_IDS)[number];
export type RouteScenarioId = (typeof M047_S02_ROUTE_SCENARIO_IDS)[number];
export type IdentityScenarioId = (typeof M047_S02_IDENTITY_SCENARIO_IDS)[number];

type SurfaceDrift = {
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

type IdentityFetchHandler = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type RouteFixture = {
  scenarioId: RouteScenarioId;
  description: string;
  body: string;
  requiredPhrases: readonly string[];
  bannedPhrases: readonly string[];
  profileStore: ContributorProfileStore;
};

export type IdentityFixture = {
  scenarioId: IdentityScenarioId;
  description: string;
  githubUsername: string;
  githubDisplayName: string | null;
  requiredPhrases: readonly string[];
  bannedPhrases: readonly string[];
  expectedFetchUrls: readonly string[];
  expectedDm: boolean;
  expectedWarningLogged: boolean;
  profileStore: ContributorProfileStore;
  fetchHandler: IdentityFetchHandler;
};

export type RouteScenarioReport = {
  scenarioId: RouteScenarioId;
  description: string;
  responseType: string | null;
  text: string;
  passed: boolean;
  statusCode: string;
  detail?: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type IdentityScenarioReport = {
  scenarioId: IdentityScenarioId;
  description: string;
  fetchUrls: string[];
  dmText: string | null;
  warningLogged: boolean;
  warningMessages: string[];
  passed: boolean;
  statusCode: string;
  detail?: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type Check = {
  id: M047S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: "verify:m047:s02";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  route: {
    scenarios: RouteScenarioReport[];
  };
  identity: {
    scenarios: IdentityScenarioReport[];
  };
  checks: Check[];
};

function createSilentLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => createSilentLogger(),
    level: "silent",
  } as unknown as Logger;
}

function createIdentityLogger(): {
  logger: Logger;
  warningMessages: string[];
} {
  const warningMessages: string[] = [];
  const logger = {
    info: () => undefined,
    warn: (...args: unknown[]) => {
      const message = args.findLast((value) => typeof value === "string");
      if (typeof message === "string") {
        warningMessages.push(message);
      }
    },
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
    level: "silent",
  } as unknown as Logger;

  return { logger, warningMessages };
}

function createTestConfig(): AppConfig {
  return {
    githubAppId: "12345",
    githubPrivateKey:
      "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
    webhookSecret: "webhook-secret",
    slackSigningSecret: SLACK_SIGNING_SECRET,
    slackBotToken: "xoxb-test-token",
    slackBotUserId: "U123BOT",
    slackKodiaiChannelId: "C123KODIAI",
    slackDefaultRepo: "xbmc/xbmc",
    slackAssistantModel: "claude-3-5-haiku-latest",
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

function makeProfile(
  overrides: Partial<ContributorProfile> = {},
): ContributorProfile {
  return {
    id: 1,
    githubUsername: "octocat",
    slackUserId: "U001",
    displayName: "Octo Cat",
    overallTier: "newcomer",
    overallScore: 0,
    optedOut: false,
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-10T00:00:00.000Z"),
    lastScoredAt: null,
    trustMarker: null,
    ...overrides,
  };
}

function createMockProfileStore(
  overrides: Partial<ContributorProfileStore> = {},
): ContributorProfileStore {
  return {
    getByGithubUsername: async () => null,
    getBySlackUserId: async () => null,
    linkIdentity: async (params) =>
      makeProfile({
        githubUsername: params.githubUsername,
        slackUserId: params.slackUserId,
        displayName: params.displayName,
      }),
    unlinkSlack: async () => {},
    setOptedOut: async () => {},
    getExpertise: async () => [],
    upsertExpertise: async () => {},
    updateTier: async () => {},
    getOrCreateByGithubUsername: async () =>
      makeProfile({
        slackUserId: null,
        displayName: null,
      }),
    getAllScores: async () => [],
    ...overrides,
  };
}

function findMissing(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => !text.includes(phrase));
}

function findUnexpected(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

function collectSurfaceDrift(
  text: string,
  requiredPhrases: readonly string[],
  bannedPhrases: readonly string[],
): SurfaceDrift {
  return {
    missingPhrases: findMissing(text, requiredPhrases),
    unexpectedPhrases: findUnexpected(text, bannedPhrases),
  };
}

function toStatusPrefix(scenarioId: RouteScenarioId | IdentityScenarioId): string {
  return scenarioId.replace(/-/g, "_");
}

function signRequest(body: string, timestamp: string): string {
  const baseString = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", SLACK_SIGNING_SECRET).update(baseString).digest("hex")}`;
}

function createRouteApp(profileStore: ContributorProfileStore): Hono {
  const app = new Hono();
  app.route(
    "/webhooks/slack/commands",
    createSlackCommandRoutes({
      config: createTestConfig(),
      logger: createSilentLogger(),
      profileStore,
    }),
  );
  return app;
}

async function postSignedCommand(app: Hono, body: string): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signRequest(body, timestamp);

  return app.request("http://localhost/webhooks/slack/commands", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

function createJsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildRouteDetail(params: {
  fixture: RouteFixture;
  responseType: string | null;
  status: number;
  missingPhrases: string[];
  unexpectedPhrases: string[];
}): string | undefined {
  const problems: string[] = [];

  if (params.status !== 200) {
    problems.push(`scenario=${params.fixture.scenarioId} returned HTTP ${params.status}`);
  }

  if (params.responseType !== "ephemeral") {
    problems.push(
      `scenario=${params.fixture.scenarioId} returned response_type=${params.responseType ?? "missing"}`,
    );
  }

  if (params.missingPhrases.length > 0) {
    problems.push(
      `scenario=${params.fixture.scenarioId} missing ${params.missingPhrases.join(", ")}`,
    );
  }

  if (params.unexpectedPhrases.length > 0) {
    problems.push(
      `scenario=${params.fixture.scenarioId} unexpected ${params.unexpectedPhrases.join(", ")}`,
    );
  }

  return problems.length > 0 ? problems.join("; ") : undefined;
}

function buildIdentityDetail(params: {
  fixture: IdentityFixture;
  fetchUrls: string[];
  dmText: string | null;
  warningLogged: boolean;
  missingPhrases: string[];
  unexpectedPhrases: string[];
}): string | undefined {
  const problems: string[] = [];

  if (!arraysEqual(params.fetchUrls, params.fixture.expectedFetchUrls)) {
    problems.push(
      `scenario=${params.fixture.scenarioId} fetch order ${JSON.stringify(params.fetchUrls)} != ${JSON.stringify(params.fixture.expectedFetchUrls)}`,
    );
  }

  if (params.fixture.expectedDm && !params.dmText) {
    problems.push(`scenario=${params.fixture.scenarioId} expected a DM but none was sent`);
  }

  if (!params.fixture.expectedDm && params.dmText) {
    problems.push(`scenario=${params.fixture.scenarioId} unexpectedly sent a DM`);
  }

  if (params.warningLogged !== params.fixture.expectedWarningLogged) {
    problems.push(
      `scenario=${params.fixture.scenarioId} warningLogged=${params.warningLogged} expected=${params.fixture.expectedWarningLogged}`,
    );
  }

  if (params.missingPhrases.length > 0) {
    problems.push(
      `scenario=${params.fixture.scenarioId} missing ${params.missingPhrases.join(", ")}`,
    );
  }

  if (params.unexpectedPhrases.length > 0) {
    problems.push(
      `scenario=${params.fixture.scenarioId} unexpected ${params.unexpectedPhrases.join(", ")}`,
    );
  }

  return problems.length > 0 ? problems.join("; ") : undefined;
}

export function buildM047S02RouteFixtures(): RouteFixture[] {
  return [
    {
      scenarioId: "link-generic-continuity",
      description:
        "A signed /kodiai link request preserves the generic continuity copy for a newly linked unscored row.",
      body:
        "command=%2Fkodiai&text=link+octocat&user_id=U001&user_name=testuser&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2Ftest",
      profileStore: createMockProfileStore(),
      requiredPhrases: [
        "Linked your Slack account to GitHub user `octocat`. Kodiai will keep your reviews generic until your linked profile has current contributor signals. Use `/kodiai profile` to review your status.",
      ],
      bannedPhrases: [
        "Linked contributor guidance is active for your profile.",
      ],
    },
    {
      scenarioId: "profile-opt-in-generic-continuity",
      description:
        "A signed /kodiai profile opt-in request stays generic when the linked row is present but not yet trusted.",
      body:
        "command=%2Fkodiai&text=profile+opt-in&user_id=U001&user_name=testuser&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2Ftest",
      profileStore: createMockProfileStore({
        getBySlackUserId: async () =>
          makeProfile({
            githubUsername: "octocat",
            slackUserId: "U001",
            displayName: "Octo Cat",
            overallTier: "newcomer",
            overallScore: 0,
            optedOut: true,
            lastScoredAt: null,
            trustMarker: null,
          }),
      }),
      requiredPhrases: [
        "Contributor-specific guidance is now on for your linked profile, but Kodiai will keep reviews generic until current contributor signals are available. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
      ],
      bannedPhrases: [
        "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
      ],
    },
    {
      scenarioId: "link-profile-backed-continuity",
      description:
        "A signed /kodiai link request still returns active continuity copy for a trusted calibrated row.",
      body:
        "command=%2Fkodiai&text=link+octocat&user_id=U001&user_name=testuser&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2Ftest",
      profileStore: createMockProfileStore({
        linkIdentity: async (params) =>
          makeProfile({
            githubUsername: params.githubUsername,
            slackUserId: params.slackUserId,
            displayName: params.displayName,
            overallTier: "established",
            overallScore: 0.82,
            lastScoredAt: new Date("2026-04-10T00:00:00.000Z"),
            trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
          }),
      }),
      requiredPhrases: [
        "Linked your Slack account to GitHub user `octocat`. Linked contributor guidance is active for your profile. Use `/kodiai profile` to review your status.",
      ],
      bannedPhrases: [
        "Kodiai will keep your reviews generic until your linked profile has current contributor signals.",
      ],
    },
  ];
}

export function buildM047S02IdentityFixtures(): IdentityFixture[] {
  return [
    {
      scenarioId: "opted-out-linked-profile",
      description:
        "An opted-out linked row is treated as an existing profile and suppresses identity suggestions.",
      githubUsername: "opted-out-user",
      githubDisplayName: "Opted Out User",
      profileStore: createMockProfileStore({
        getByGithubUsername: async (_username, options) =>
          options?.includeOptedOut
            ? makeProfile({
                githubUsername: "opted-out-user",
                slackUserId: "U-OPTED-OUT",
                displayName: "Opted Out User",
                optedOut: true,
              })
            : null,
      }),
      fetchHandler: async () => createJsonResponse({ ok: true, members: [] }),
      expectedFetchUrls: [],
      expectedDm: false,
      expectedWarningLogged: false,
      requiredPhrases: [],
      bannedPhrases: ["linked contributor profile"],
    },
    {
      scenarioId: "high-confidence-match-dm",
      description:
        "A high-confidence Slack match still sends the truthful continuity DM copy.",
      githubUsername: "octocat",
      githubDisplayName: "Octo Cat",
      profileStore: createMockProfileStore(),
      fetchHandler: async (input) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url === "https://slack.com/api/users.list") {
          return createJsonResponse({
            ok: true,
            members: [
              {
                id: "U777",
                profile: {
                  display_name: "octocat",
                  real_name: "Octo Cat",
                },
              },
            ],
          });
        }

        if (url === "https://slack.com/api/conversations.open") {
          return createJsonResponse({ ok: true, channel: { id: "D777" } });
        }

        if (url === "https://slack.com/api/chat.postMessage") {
          return createJsonResponse({ ok: true });
        }

        return new Response("Not Found", { status: 404 });
      },
      expectedFetchUrls: [
        "https://slack.com/api/users.list",
        "https://slack.com/api/conversations.open",
        "https://slack.com/api/chat.postMessage",
      ],
      expectedDm: true,
      expectedWarningLogged: false,
      requiredPhrases: [
        "Kodiai can use your linked contributor profile when available.",
        "`/kodiai profile opt-out`",
      ],
      bannedPhrases: ["personalized code reviews"],
    },
    {
      scenarioId: "slack-api-failure-warning",
      description:
        "Slack DM delivery failures stay non-blocking and surface through the existing warning path.",
      githubUsername: "warning-user",
      githubDisplayName: "Warning User",
      profileStore: createMockProfileStore(),
      fetchHandler: async (input) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url === "https://slack.com/api/users.list") {
          return createJsonResponse({
            ok: true,
            members: [
              {
                id: "U778",
                profile: {
                  display_name: "warning-user",
                  real_name: "Warning User",
                },
              },
            ],
          });
        }

        if (url === "https://slack.com/api/conversations.open") {
          return createJsonResponse({ ok: true, channel: {} });
        }

        if (url === "https://slack.com/api/chat.postMessage") {
          return createJsonResponse({ ok: true });
        }

        return new Response("Not Found", { status: 404 });
      },
      expectedFetchUrls: [
        "https://slack.com/api/users.list",
        "https://slack.com/api/conversations.open",
      ],
      expectedDm: false,
      expectedWarningLogged: true,
      requiredPhrases: [],
      bannedPhrases: ["linked contributor profile"],
    },
  ];
}

async function runRouteScenario(fixture: RouteFixture): Promise<RouteScenarioReport> {
  const app = createRouteApp(fixture.profileStore);
  const response = await postSignedCommand(app, fixture.body);
  const responseType = response.headers.get("content-type")?.includes("application/json")
    ? (((await response.clone().json()) as { response_type?: string }).response_type ?? null)
    : null;
  const text = response.headers.get("content-type")?.includes("application/json")
    ? (((await response.json()) as { text?: string }).text ?? "")
    : await response.text();
  const drift = collectSurfaceDrift(text, fixture.requiredPhrases, fixture.bannedPhrases);
  const detail = buildRouteDetail({
    fixture,
    responseType,
    status: response.status,
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  });
  const passed = !detail;

  return {
    scenarioId: fixture.scenarioId,
    description: fixture.description,
    responseType,
    text,
    passed,
    statusCode: passed
      ? `${toStatusPrefix(fixture.scenarioId)}_truthful`
      : "signed_slash_route_surface_drift",
    detail,
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  };
}

async function runIdentityScenario(
  fixture: IdentityFixture,
): Promise<IdentityScenarioReport> {
  const originalFetch = globalThis.fetch;
  const fetchUrls: string[] = [];
  let dmText: string | null = null;
  const { logger, warningMessages } = createIdentityLogger();

  resetIdentitySuggestionStateForTests();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchUrls.push(url);

    if (url === "https://slack.com/api/chat.postMessage" && typeof init?.body === "string") {
      const payload = JSON.parse(init.body) as { text?: string };
      dmText = payload.text ?? null;
    }

    return fixture.fetchHandler(input, init);
  }) as unknown as typeof globalThis.fetch;

  try {
    await suggestIdentityLink({
      githubUsername: fixture.githubUsername,
      githubDisplayName: fixture.githubDisplayName,
      slackBotToken: "xoxb-test-token",
      profileStore: fixture.profileStore,
      logger,
    });
  } finally {
    globalThis.fetch = originalFetch;
    resetIdentitySuggestionStateForTests();
  }

  const drift = collectSurfaceDrift(dmText ?? "", fixture.requiredPhrases, fixture.bannedPhrases);
  const warningLogged = warningMessages.length > 0;
  const detail = buildIdentityDetail({
    fixture,
    fetchUrls,
    dmText,
    warningLogged,
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  });
  const passed = !detail;

  return {
    scenarioId: fixture.scenarioId,
    description: fixture.description,
    fetchUrls,
    dmText,
    warningLogged,
    warningMessages,
    passed,
    statusCode: passed
      ? `${toStatusPrefix(fixture.scenarioId)}_truthful`
      : "identity_suggestion_surface_drift",
    detail,
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  };
}

function buildAggregateCheck(params: {
  id: M047S02CheckId;
  statusCodeOnPass: string;
  statusCodeOnFail: string;
  scenarios: Array<
    | Pick<RouteScenarioReport, "scenarioId" | "passed" | "statusCode" | "detail">
    | Pick<IdentityScenarioReport, "scenarioId" | "passed" | "statusCode" | "detail">
  >;
}): Check {
  const failing = params.scenarios.filter((scenario) => !scenario.passed);
  if (failing.length === 0) {
    return {
      id: params.id,
      passed: true,
      skipped: false,
      status_code: params.statusCodeOnPass,
    };
  }

  return {
    id: params.id,
    passed: false,
    skipped: false,
    status_code: params.statusCodeOnFail,
    detail: failing
      .map((scenario) => `${scenario.scenarioId}:${scenario.statusCode}${scenario.detail ? ` (${scenario.detail})` : ""}`)
      .join("; "),
  };
}

export async function evaluateM047S02(opts?: {
  generatedAt?: string;
  _routeFixtures?: RouteFixture[];
  _identityFixtures?: IdentityFixture[];
}): Promise<EvaluationReport> {
  const routeFixtures = opts?._routeFixtures ?? buildM047S02RouteFixtures();
  const identityFixtures = opts?._identityFixtures ?? buildM047S02IdentityFixtures();

  const routeScenarios = await Promise.all(routeFixtures.map((fixture) => runRouteScenario(fixture)));
  const identityScenarios = [] as IdentityScenarioReport[];

  for (const fixture of identityFixtures) {
    identityScenarios.push(await runIdentityScenario(fixture));
  }

  const checks: Check[] = [
    buildAggregateCheck({
      id: "M047-S02-SIGNED-SLASH-CONTINUITY-CONTRACT",
      statusCodeOnPass: "signed_slash_continuity_truthful",
      statusCodeOnFail: "signed_slash_continuity_drift",
      scenarios: routeScenarios,
    }),
    buildAggregateCheck({
      id: "M047-S02-IDENTITY-SUGGESTION-CONTRACT",
      statusCodeOnPass: "identity_suggestion_contract_truthful",
      statusCodeOnFail: "identity_suggestion_contract_drift",
      scenarios: identityScenarios,
    }),
  ];

  return {
    command: "verify:m047:s02",
    generatedAt: opts?.generatedAt ?? new Date().toISOString(),
    check_ids: M047_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    route: {
      scenarios: routeScenarios,
    },
    identity: {
      scenarios: identityScenarios,
    },
    checks,
  };
}

export function renderM047S02Report(report: EvaluationReport): string {
  const lines = [
    "M047 S02 proof harness: signed slash continuity and identity suppression",
    `Generated at: ${report.generatedAt}`,
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Signed slash route:",
  ];

  for (const scenario of report.route.scenarios) {
    lines.push(
      `- ${scenario.scenarioId} ${scenario.passed ? "PASS" : "FAIL"} response_type=${scenario.responseType ?? "missing"} status_code=${scenario.statusCode}`,
    );
    if (scenario.detail && !scenario.passed) {
      lines.push(`  detail: ${scenario.detail}`);
    }
  }

  lines.push("Identity suggestions:");
  for (const scenario of report.identity.scenarios) {
    lines.push(
      `- ${scenario.scenarioId} ${scenario.passed ? "PASS" : "FAIL"} fetches=${scenario.fetchUrls.length} warning=${scenario.warningLogged ? "yes" : "no"} status_code=${scenario.statusCode}`,
    );
    if (scenario.detail && !scenario.passed) {
      lines.push(`  detail: ${scenario.detail}`);
    }
  }

  lines.push("Checks:");
  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM047S02ProofHarness(opts?: {
  stdout?: { write: (chunk: string) => boolean | void };
  stderr?: { write: (chunk: string) => boolean | void };
  json?: boolean;
  _routeFixtures?: RouteFixture[];
  _identityFixtures?: IdentityFixture[];
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const report = await evaluateM047S02({
    _routeFixtures: opts?._routeFixtures,
    _identityFixtures: opts?._identityFixtures,
  });

  if (opts?.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM047S02Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m047:s02 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM047S02ProofHarness({ json: useJson });
  process.exit(exitCode);
}
