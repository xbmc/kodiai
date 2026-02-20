import { parseArgs } from "node:util";
import {
  createSlackAssistantHandler,
  type SlackAssistantAddressedPayload,
  type SlackAssistantHandleResult,
} from "../src/slack/assistant-handler.ts";

const CHECK_PREFIX = "SLK81-SMOKE";

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
  ambiguousRequest?: string;
};

type DeterministicWriteResult = {
  outcome: "success" | "refusal";
  prUrl?: string;
  reason?: "policy" | "write_disabled" | "permission" | "unsupported_repo";
  responseText: string;
  retryCommand: string;
  mirrors?: Array<{ url: string; excerpt: string }>;
};

function createPayload(text: string): SlackAssistantAddressedPayload {
  return {
    channel: "C81KODIAI",
    threadTs: "1701000000.000100",
    messageTs: "1701000000.000100",
    user: "U81OPERATOR",
    text,
    replyTarget: "thread-only",
  };
}

function checkResult(result: SlackAssistantHandleResult): result is Extract<SlackAssistantHandleResult, { outcome: "answered" }> {
  return result.outcome === "answered";
}

function includesAll(text: string, expected: string[]): boolean {
  return expected.every((value) => text.includes(value));
}

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
  console.log(`Phase 81 Slack write-mode smoke verifier

Runs deterministic write-intent scenarios offline and emits machine-checkable
${CHECK_PREFIX}-* IDs for operator verification.

Usage:
  bun scripts/phase81-slack-write-smoke.ts [options]

Options:
  -h, --help   show this help

Checks:
  ${CHECK_PREFIX}-01 explicit write-intent routes to write-capable flow
  ${CHECK_PREFIX}-02 ambiguous intent stays read-only with exact rerun guidance
  ${CHECK_PREFIX}-03 high-impact write asks require confirmation before execution
  ${CHECK_PREFIX}-04 success/refusal output contracts stay deterministic

Blocking rule:
  Exit code is non-zero when any ${CHECK_PREFIX}-* check fails.`);
}

export async function evaluateSmokeChecks(options: SmokeEvaluationOptions = {}): Promise<SmokeReport> {
  const checks: SmokeCheck[] = [];

  const explicitPublished: string[] = [];
  const explicitRunWriteCalls: Array<Record<string, unknown>> = [];
  let explicitWorkspaceCalls = 0;

  const explicitHandler = createSlackAssistantHandler({
    defaultRepo: "xbmc/xbmc",
    createWorkspace: async () => {
      explicitWorkspaceCalls += 1;
      return {
        dir: "/tmp/phase81-smoke-write",
        cleanup: async () => undefined,
      };
    },
    execute: async () => ({ answerText: "executor should not run" }),
    runWrite: async (input) => {
      explicitRunWriteCalls.push(input as unknown as Record<string, unknown>);
      return {
        outcome: "success",
        prUrl: "https://github.com/xbmc/xbmc/pull/8101",
        responseText: "Opened PR: https://github.com/xbmc/xbmc/pull/8101",
        retryCommand: "apply: update src/slack/assistant-handler.ts",
        mirrors: [],
      };
    },
    publishInThread: async ({ text }) => {
      explicitPublished.push(text);
    },
  });

  const explicitResult = await explicitHandler.handle(createPayload("apply: update src/slack/assistant-handler.ts"));
  const explicitPass =
    checkResult(explicitResult)
    && explicitResult.route === "write"
    && explicitRunWriteCalls.length === 1
    && explicitWorkspaceCalls === 0
    && includesAll(explicitResult.publishedText, [
      "Write run complete.",
      "- Changed: update src/slack/assistant-handler.ts",
      "- Where: xbmc/xbmc",
      "PR: https://github.com/xbmc/xbmc/pull/8101",
    ]);

  checks.push({
    id: `${CHECK_PREFIX}-01`,
    title: "Explicit write-intent routes to write-capable flow",
    passed: explicitPass,
    details: explicitPass
      ? "route=write; runWrite invoked once; deterministic PR summary emitted"
      : `unexpected explicit write behavior (result=${explicitResult.outcome}; runWriteCalls=${explicitRunWriteCalls.length}; workspaceCalls=${explicitWorkspaceCalls})`,
  });

  const ambiguousPublished: string[] = [];
  let ambiguousWorkspaceCalls = 0;
  let ambiguousExecuteCalls = 0;
  const ambiguousRequest = options.ambiguousRequest ?? "Could you maybe change this when you can?";

  const ambiguousHandler = createSlackAssistantHandler({
    defaultRepo: "xbmc/xbmc",
    createWorkspace: async () => {
      ambiguousWorkspaceCalls += 1;
      return {
        dir: "/tmp/phase81-smoke-ambiguous",
        cleanup: async () => undefined,
      };
    },
    execute: async () => {
      ambiguousExecuteCalls += 1;
      return { answerText: "executor should not run" };
    },
    publishInThread: async ({ text }) => {
      ambiguousPublished.push(text);
    },
  });

  const ambiguousResult = await ambiguousHandler.handle(createPayload(ambiguousRequest));
  const ambiguousQuestion =
    ambiguousResult.outcome === "clarification_required" ? ambiguousResult.question : "";

  const ambiguousPass =
    ambiguousResult.outcome === "clarification_required"
    && ambiguousWorkspaceCalls === 0
    && ambiguousExecuteCalls === 0
    && includesAll(ambiguousQuestion, [
      "I kept this run read-only because your request may involve repository changes, but write intent is ambiguous.",
      `- apply: ${ambiguousRequest}`,
      `- change: ${ambiguousRequest}`,
    ]);

  checks.push({
    id: `${CHECK_PREFIX}-02`,
    title: "Ambiguous intent stays read-only with exact rerun guidance",
    passed: ambiguousPass,
    details: ambiguousPass
      ? "outcome=clarification_required; no workspace/executor execution"
      : `unexpected ambiguous intent handling (outcome=${ambiguousResult.outcome}; workspaceCalls=${ambiguousWorkspaceCalls}; executeCalls=${ambiguousExecuteCalls})`,
  });

  const highImpactPublished: string[] = [];
  let highImpactRunWriteCalls = 0;
  const highImpactHandler = createSlackAssistantHandler({
    defaultRepo: "xbmc/xbmc",
    createWorkspace: async () => ({
      dir: "/tmp/phase81-smoke-confirm",
      cleanup: async () => undefined,
    }),
    execute: async () => ({ answerText: "executor should not run" }),
    runWrite: async () => {
      highImpactRunWriteCalls += 1;
      return {
        outcome: "success",
        prUrl: "https://github.com/xbmc/xbmc/pull/8102",
        responseText: "Opened PR: https://github.com/xbmc/xbmc/pull/8102",
        retryCommand: "apply: request",
        mirrors: [],
      };
    },
    publishInThread: async ({ text }) => {
      highImpactPublished.push(text);
    },
  });

  const highImpactResult = await highImpactHandler.handle(
    createPayload("Please delete old auth files across the entire repo and migrate secrets"),
  );

  const highImpactPass =
    highImpactResult.outcome === "confirmation_required"
    && highImpactRunWriteCalls === 0
    && includesAll(highImpactResult.question, [
      "This looks like a high-impact write request, so I did not execute it yet.",
      "Reply in this thread with the command below prefixed by `confirm:` to proceed:",
      "- apply: Please delete old auth files across the entire repo and migrate secrets",
      "Confirmation timeout: 15 minutes",
    ]);

  checks.push({
    id: `${CHECK_PREFIX}-03`,
    title: "High-impact write asks require confirmation before execution",
    passed: highImpactPass,
    details: highImpactPass
      ? "outcome=confirmation_required; write execution not started"
      : `unexpected confirmation behavior (outcome=${highImpactResult.outcome}; runWriteCalls=${highImpactRunWriteCalls})`,
  });

  const contractPublished: string[] = [];
  const contractResponses: DeterministicWriteResult[] = [
    {
      outcome: "success",
      prUrl: "https://github.com/xbmc/xbmc/pull/8103",
      responseText: "Opened PR: https://github.com/xbmc/xbmc/pull/8103",
      retryCommand: "apply: update docs",
      mirrors: [],
    },
    {
      outcome: "refusal",
      reason: "policy",
      responseText: "Write request refused.\\nReason: write-policy-not-allowed",
      retryCommand: "change: update docs/runbooks/slack-integration.md",
    },
  ];

  const contractHandler = createSlackAssistantHandler({
    defaultRepo: "xbmc/xbmc",
    createWorkspace: async () => ({
      dir: "/tmp/phase81-smoke-contract",
      cleanup: async () => undefined,
    }),
    execute: async () => ({ answerText: "executor should not run" }),
    runWrite: async () => {
      const next = contractResponses.shift();
      if (!next) {
        throw new Error("missing deterministic contract response");
      }

      if (next.outcome === "success") {
        return {
          outcome: "success",
          prUrl: next.prUrl ?? "https://github.com/xbmc/xbmc/pull/8199",
          responseText: next.responseText,
          retryCommand: next.retryCommand,
          mirrors: next.mirrors ?? [],
        };
      }

      return {
        outcome: "refusal",
        reason: next.reason ?? "policy",
        responseText: next.responseText,
        retryCommand: next.retryCommand,
      };
    },
    publishInThread: async ({ text }) => {
      contractPublished.push(text);
    },
  });

  await contractHandler.handle(createPayload("apply: update docs/runbooks/slack-integration.md"));
  await contractHandler.handle(createPayload("change: update docs/runbooks/slack-integration.md"));
  const successMessage = contractPublished.find((message) => message.startsWith("Write run complete.")) ?? "";
  const refusalMessage = contractPublished.find((message) => message.startsWith("Write request refused.")) ?? "";

  const contractPass =
    includesAll(successMessage, [
      "Write run complete.",
      "- Changed: update docs/runbooks/slack-integration.md",
      "- Where: xbmc/xbmc",
      "PR: https://github.com/xbmc/xbmc/pull/8103",
    ])
    && includesAll(refusalMessage, [
      "Write request refused.",
      "Reason: write-policy-not-allowed",
      "Retry command: change: update docs/runbooks/slack-integration.md",
    ]);

  checks.push({
    id: `${CHECK_PREFIX}-04`,
    title: "Success/refusal output contracts stay deterministic",
    passed: contractPass,
    details: contractPass
      ? "success and refusal responses preserved final contract shape"
      : "write final output contract drifted from expected success/refusal format",
  });

  return {
    overallPassed: checks.every((check) => check.passed),
    checks,
  };
}

export function renderSmokeReport(report: SmokeReport): string {
  const failedIds = report.checks.filter((check) => !check.passed).map((check) => check.id);

  return [
    "Phase 81 Slack write-mode smoke",
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

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const values = parseSmokeCliArgs(args);
  if (values.help) {
    printUsage();
    return 0;
  }

  const report = await evaluateSmokeChecks();
  console.log(renderSmokeReport(report));
  return report.overallPassed ? 0 : 1;
}

if (import.meta.main) {
  try {
    const exitCode = await main();
    process.exit(exitCode);
  } catch (error) {
    console.error(`Phase 81 Slack write smoke failed: ${normalizeMessage(error)}`);
    process.exit(1);
  }
}
