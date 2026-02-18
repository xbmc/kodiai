import { parseArgs } from "node:util";
import { evaluateSlackV1Rails } from "../src/slack/safety-rails.ts";
import { createSlackThreadSessionStore } from "../src/slack/thread-session-store.ts";

const CHECK_PREFIX = "SLK80-SMOKE";
const DEFAULT_BOT_USER_ID = "U_KODIAI_BOT";
const KODIAI_CHANNEL_ID = "C_KODIAI";
const NON_KODIAI_CHANNEL_ID = "C_RANDOM";

type SmokeCheck = {
  id: string;
  title: string;
  passed: boolean;
  details: string;
};

export type SmokeReport = {
  overallPassed: boolean;
  checks: SmokeCheck[];
};

type CliValues = {
  help?: boolean;
};

type SmokeEvaluationOptions = {
  markSessionBeforeFollowUpCheck?: boolean;
};

export function parseSmokeCliArgs(args: string[]): CliValues {
  const parsed = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  return parsed.values as CliValues;
}

function printUsage(): void {
  console.log(`Phase 80 Slack operator hardening smoke verifier

Runs a deterministic Slack v1 scenario matrix against safety rails and
thread-session transitions with machine-checkable check IDs.

Usage:
  bun scripts/phase80-slack-smoke.ts [options]

Options:
  -h, --help   show this help

Checks:
  ${CHECK_PREFIX}-01 outside-channel payload is ignored
  ${CHECK_PREFIX}-02 top-level mention bootstrap is allowed
  ${CHECK_PREFIX}-03 in-thread follow-up is ignored before session start
  ${CHECK_PREFIX}-04 started-thread follow-up is allowed with thread-only targeting

Blocking rule:
  Exit code is non-zero when any ${CHECK_PREFIX}-* check fails.`);
}

function createMentionEvent(params: {
  channel: string;
  threadTs?: string;
  ts: string;
  user: string;
  text: string;
}) {
  return {
    type: "event_callback" as const,
    event: {
      type: "app_mention" as const,
      channel: params.channel,
      channel_type: "channel",
      thread_ts: params.threadTs,
      ts: params.ts,
      user: params.user,
      text: params.text,
    },
  };
}

export function evaluateSmokeChecks(options: SmokeEvaluationOptions = {}): SmokeReport {
  const markSessionBeforeFollowUpCheck = options.markSessionBeforeFollowUpCheck ?? true;
  const checks: SmokeCheck[] = [];
  const threadSessionStore = createSlackThreadSessionStore();

  const outsideChannelDecision = evaluateSlackV1Rails({
    payload: createMentionEvent({
      channel: NON_KODIAI_CHANNEL_ID,
      ts: "1700000000.100",
      user: "U_OPERATOR",
      text: `<@${DEFAULT_BOT_USER_ID}> run smoke`,
    }),
    slackBotUserId: DEFAULT_BOT_USER_ID,
    slackKodiaiChannelId: KODIAI_CHANNEL_ID,
    isThreadSessionStarted: (input) => threadSessionStore.isThreadStarted(input),
  });

  checks.push({
    id: `${CHECK_PREFIX}-01`,
    title: "Outside #kodiai channel payload is ignored",
    passed: outsideChannelDecision.decision === "ignore" && outsideChannelDecision.reason === "outside_kodiai_channel",
    details:
      outsideChannelDecision.decision === "ignore"
        ? `reason=${outsideChannelDecision.reason}`
        : `expected ignore(outside_kodiai_channel), got allow(${outsideChannelDecision.reason})`,
  });

  const bootstrapDecision = evaluateSlackV1Rails({
    payload: createMentionEvent({
      channel: KODIAI_CHANNEL_ID,
      ts: "1700000000.200",
      user: "U_OPERATOR",
      text: `<@${DEFAULT_BOT_USER_ID}> summarize latest regression`,
    }),
    slackBotUserId: DEFAULT_BOT_USER_ID,
    slackKodiaiChannelId: KODIAI_CHANNEL_ID,
    isThreadSessionStarted: (input) => threadSessionStore.isThreadStarted(input),
  });

  const bootstrapPass =
    bootstrapDecision.decision === "allow" &&
    bootstrapDecision.reason === "mention_only_bootstrap" &&
    bootstrapDecision.bootstrap.replyTarget === "thread-only";

  checks.push({
    id: `${CHECK_PREFIX}-02`,
    title: "Top-level mention bootstrap is allowed with thread-only targeting",
    passed: bootstrapPass,
    details:
      bootstrapDecision.decision === "allow"
        ? `reason=${bootstrapDecision.reason}, replyTarget=${bootstrapDecision.bootstrap.replyTarget}`
        : `expected allow(mention_only_bootstrap), got ignore(${bootstrapDecision.reason})`,
  });

  const followUpPayload = createMentionEvent({
    channel: KODIAI_CHANNEL_ID,
    threadTs: "1700000000.200",
    ts: "1700000000.300",
    user: "U_OPERATOR",
    text: "follow-up without mention token",
  });

  const beforeSessionDecision = evaluateSlackV1Rails({
    payload: followUpPayload,
    slackBotUserId: DEFAULT_BOT_USER_ID,
    slackKodiaiChannelId: KODIAI_CHANNEL_ID,
    isThreadSessionStarted: (input) => threadSessionStore.isThreadStarted(input),
  });

  checks.push({
    id: `${CHECK_PREFIX}-03`,
    title: "In-thread follow-up is ignored before session start",
    passed:
      beforeSessionDecision.decision === "ignore" &&
      beforeSessionDecision.reason === "thread_follow_up_out_of_scope",
    details:
      beforeSessionDecision.decision === "ignore"
        ? `reason=${beforeSessionDecision.reason}`
        : `expected ignore(thread_follow_up_out_of_scope), got allow(${beforeSessionDecision.reason})`,
  });

  if (bootstrapDecision.decision === "allow" && markSessionBeforeFollowUpCheck) {
    threadSessionStore.markThreadStarted({
      channel: bootstrapDecision.bootstrap.channel,
      threadTs: bootstrapDecision.bootstrap.threadTs,
    });
  }

  const afterSessionDecision = evaluateSlackV1Rails({
    payload: followUpPayload,
    slackBotUserId: DEFAULT_BOT_USER_ID,
    slackKodiaiChannelId: KODIAI_CHANNEL_ID,
    isThreadSessionStarted: (input) => threadSessionStore.isThreadStarted(input),
  });

  const startedThreadPass =
    afterSessionDecision.decision === "allow" &&
    afterSessionDecision.reason === "thread_session_follow_up" &&
    afterSessionDecision.bootstrap.replyTarget === "thread-only";

  checks.push({
    id: `${CHECK_PREFIX}-04`,
    title: "Started-thread follow-up is allowed with thread-only targeting",
    passed: startedThreadPass,
    details:
      afterSessionDecision.decision === "allow"
        ? `reason=${afterSessionDecision.reason}, replyTarget=${afterSessionDecision.bootstrap.replyTarget}`
        : `expected allow(thread_session_follow_up), got ignore(${afterSessionDecision.reason})`,
  });

  return {
    overallPassed: checks.every((check) => check.passed),
    checks,
  };
}

export function renderSmokeReport(report: SmokeReport): string {
  const failedIds = report.checks.filter((check) => !check.passed).map((check) => check.id);

  return [
    "Phase 80 Slack operator hardening smoke",
    "",
    ...report.checks.map(
      (check) => `${check.id} ${check.passed ? "PASS" : "FAIL"} - ${check.title}. ${check.details}`,
    ),
    "",
    report.overallPassed
      ? `Final verdict: PASS - all ${CHECK_PREFIX}-* checks passed.`
      : `Final verdict: FAIL - blocking checks failed [${failedIds.join(", ")}].`,
  ].join("\n");
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  const text = String(error ?? "").trim();
  return text.length > 0 ? text : "Unknown error";
}

export function main(args: string[] = process.argv.slice(2)): number {
  const values = parseSmokeCliArgs(args);
  if (values.help) {
    printUsage();
    return 0;
  }

  const report = evaluateSmokeChecks();
  console.log(renderSmokeReport(report));

  return report.overallPassed ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`Phase 80 Slack smoke failed: ${normalizeMessage(error)}`);
    process.exit(1);
  }
}
