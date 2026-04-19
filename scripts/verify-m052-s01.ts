import { parseWebhookRelaySourcesEnv } from "../src/slack/webhook-relay-config.ts";
import {
  evaluateWebhookRelayPayload,
  type WebhookRelayEvaluationResult,
} from "../src/slack/webhook-relay.ts";

export type M052S01StatusCode = "m052_s01_ok" | "m052_s01_contract_drift";
export type M052S01CheckStatus = "pass" | "fail";

export interface M052S01Check {
  id: "M052-S01-ACCEPT" | "M052-S01-SUPPRESS" | "M052-S01-INVALID";
  status: M052S01CheckStatus;
  detail: string;
}

export interface M052S01Report {
  command: "verify:m052:s01";
  generated_at: string;
  success: boolean;
  status_code: M052S01StatusCode;
  checks: M052S01Check[];
  acceptedResult: WebhookRelayEvaluationResult;
  suppressedResult: WebhookRelayEvaluationResult;
  invalidResult: WebhookRelayEvaluationResult;
  issues: string[];
}

function buildProofSource() {
  return parseWebhookRelaySourcesEnv(
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
}

async function loadFixture(name: "accepted" | "suppressed"): Promise<unknown> {
  return await Bun.file(new URL(`../fixtures/slack-webhook-relay/${name}.json`, import.meta.url)).json();
}

function buildMalformedPayload(): unknown {
  return {
    eventType: "build.failed",
    title: "Missing text",
    summary: "This payload forgot the required text field.",
    url: "not-a-url",
  };
}

function buildCheck(input: {
  id: M052S01Check["id"];
  passed: boolean;
  detail: string;
}): M052S01Check {
  return {
    id: input.id,
    status: input.passed ? "pass" : "fail",
    detail: input.detail,
  };
}

export async function evaluateM052S01(opts?: {
  generatedAt?: string;
  acceptedPayload?: unknown;
  suppressedPayload?: unknown;
  invalidPayload?: unknown;
}): Promise<M052S01Report> {
  const source = buildProofSource();
  const acceptedPayload = opts?.acceptedPayload ?? await loadFixture("accepted");
  const suppressedPayload = opts?.suppressedPayload ?? await loadFixture("suppressed");
  const invalidPayload = opts?.invalidPayload ?? buildMalformedPayload();

  const acceptedResult = evaluateWebhookRelayPayload({ source, payload: acceptedPayload });
  const suppressedResult = evaluateWebhookRelayPayload({ source, payload: suppressedPayload });
  const invalidResult = evaluateWebhookRelayPayload({ source, payload: invalidPayload });

  const checks: M052S01Check[] = [
    buildCheck({
      id: "M052-S01-ACCEPT",
      passed: acceptedResult.verdict === "accept",
      detail: acceptedResult.verdict === "accept"
        ? "accepted fixture normalized into the stable relay event shape"
        : `expected accept verdict, got ${acceptedResult.verdict}`,
    }),
    buildCheck({
      id: "M052-S01-SUPPRESS",
      passed: suppressedResult.verdict === "suppress" && suppressedResult.reason === "text_excluded_substring",
      detail: suppressedResult.verdict === "suppress" && suppressedResult.reason === "text_excluded_substring"
        ? "suppressed fixture produced the expected exclusion-based suppression reason"
        : `expected suppress/text_excluded_substring, got ${suppressedResult.verdict}`,
    }),
    buildCheck({
      id: "M052-S01-INVALID",
      passed: invalidResult.verdict === "invalid"
        && invalidResult.reason === "malformed_payload"
        && JSON.stringify(invalidResult.issues) === JSON.stringify(["text", "url"]),
      detail: invalidResult.verdict === "invalid"
        ? `invalid payload produced issues: ${invalidResult.issues.join(", ")}`
        : `expected invalid/malformed_payload, got ${invalidResult.verdict}`,
    }),
  ];

  const issues = checks.filter((check) => check.status === "fail").map((check) => `${check.id}: ${check.detail}`);

  return {
    command: "verify:m052:s01",
    generated_at: opts?.generatedAt ?? new Date().toISOString(),
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m052_s01_ok" : "m052_s01_contract_drift",
    checks,
    acceptedResult,
    suppressedResult,
    invalidResult,
    issues,
  };
}

function renderHumanReport(report: M052S01Report): string {
  return [
    "# verify:m052:s01",
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
    evaluate?: typeof evaluateM052S01;
  },
): Promise<number> {
  const stdout = io?.stdout ?? process.stdout;
  const stderr = io?.stderr ?? process.stderr;
  const evaluate = io?.evaluate ?? evaluateM052S01;

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
