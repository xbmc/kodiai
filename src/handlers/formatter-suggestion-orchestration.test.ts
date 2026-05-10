import { describe, expect, test } from "bun:test";
import {
  renderFormatterSuggestionVisibleMessage,
  runFormatterSuggestionSubflow,
  type FormatterSuggestionSubflowDependencies,
  type FormatterSuggestionSubflowOptions,
} from "./formatter-suggestion-orchestration.ts";
import type {
  FormatterCommandResult,
  FormatterSuggestionPayload,
} from "../execution/formatter-suggestions.ts";
import type {
  FormatterSuggestionPublisherResult,
} from "../execution/formatter-suggestion-publisher.ts";

const PR_DIFF = [
  "diff --git a/src/example.ts b/src/example.ts",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -1,3 +1,3 @@",
  " const keep = true;",
  "-const value=1;",
  "+const value = 1;",
  " export { value };",
  "",
].join("\n");

const FORMATTER_DIFF = PR_DIFF;
const TWO_SUGGESTION_DIFF = [
  "diff --git a/src/example.ts b/src/example.ts",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -1,5 +1,5 @@",
  "-const a=1;",
  "+const a = 1;",
  " const keep = true;",
  "-const b=2;",
  "+const b = 2;",
  " export { a, b };",
  "",
].join("\n");
const RAW_STDOUT_SENTINEL = "RAW_FORMATTER_STDOUT_SHOULD_NOT_APPEAR";

function makeOptions(overrides: Partial<FormatterSuggestionSubflowOptions> = {}): FormatterSuggestionSubflowOptions {
  return {
    owner: "acme",
    repo: "widgets",
    prNumber: 42,
    workspaceDir: "/tmp/kodiai-workspace",
    baseRef: "main",
    headRef: "feature/format",
    diffRange: "origin/main...HEAD",
    formatterCommand: "bun run format:suggestions -- --range {diffRange}",
    formatterTimeoutMs: 30_000,
    maxSuggestions: 10,
    installationId: 123,
    deliveryId: "delivery-abc",
    octokit: { rest: { pulls: { createReview: async () => ({ data: {} }) } } } as never,
    token: "token-not-logged",
    botHandles: ["kodiai"],
    ...overrides,
  };
}

function makeCommandResult(overrides: Partial<FormatterCommandResult> = {}): FormatterCommandResult {
  return {
    status: "success",
    stdout: FORMATTER_DIFF,
    stderrSummary: "",
    timedOut: false,
    durationMs: 12,
    resolvedCommand: "formatter command",
    exitCode: 0,
    ...overrides,
  };
}

function makeSuggestion(overrides: Partial<FormatterSuggestionPayload> = {}): FormatterSuggestionPayload {
  return {
    path: "src/example.ts",
    line: 2,
    side: "RIGHT",
    suggestionBody: "```suggestion\nconst value = 1;\n```",
    oldStart: 2,
    oldEnd: 2,
    newStart: 2,
    hunkHeader: "@@ -1,3 +1,3 @@",
    ...overrides,
  };
}

function makePublisherResult(overrides: Partial<FormatterSuggestionPublisherResult> = {}): FormatterSuggestionPublisherResult {
  return {
    status: "posted",
    posted: 1,
    skipped: 0,
    review: { id: 987, url: "https://github.com/acme/widgets/pull/42#pullrequestreview-987" },
    reviewOutput: { key: "formatter-output-key", markerIncluded: true },
    skippedSuggestions: [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<FormatterSuggestionSubflowDependencies> = {}): FormatterSuggestionSubflowDependencies {
  return {
    runFormatterCommand: async () => makeCommandResult(),
    collectDiffContext: async () => ({
      changedFiles: ["src/example.ts"],
      numstatLines: ["1\t1\tsrc/example.ts"],
      diffContent: PR_DIFF,
      strategy: "triple-dot",
      mergeBaseRecovered: false,
      deepenAttempts: 0,
      unshallowAttempted: false,
      diffRange: "origin/main...HEAD",
    }),
    publishFormatterSuggestionReview: async () => makePublisherResult(),
    resolveHeadSha: async () => "abc123def456",
    ...overrides,
  };
}

function createLogger() {
  const entries: Array<{ level: string; fields: Record<string, unknown>; message?: string }> = [];
  return {
    entries,
    logger: {
      info: (fields: Record<string, unknown>, message?: string) => entries.push({ level: "info", fields, message }),
      warn: (fields: Record<string, unknown>, message?: string) => entries.push({ level: "warn", fields, message }),
      error: (fields: Record<string, unknown>, message?: string) => entries.push({ level: "error", fields, message }),
    },
  };
}

function expectNoRawFormatterStdout(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(RAW_STDOUT_SENTINEL);
}

describe("runFormatterSuggestionSubflow", () => {
  test("returns setup guidance without running formatter when no command is configured", async () => {
    let commandCalls = 0;
    const result = await runFormatterSuggestionSubflow(
      makeOptions({ formatterCommand: undefined }),
      makeDeps({ runFormatterCommand: async () => { commandCalls += 1; return makeCommandResult(); } }),
    );

    expect(commandCalls).toBe(0);
    expect(result).toMatchObject({
      status: "setup-needed",
      commandStatus: "no-command",
      suggestions: 0,
      skipped: 0,
      capped: 0,
    });
    expect(result.visibleMessage).toContain("review.formatterSuggestions.command");
    expect(renderFormatterSuggestionVisibleMessage(result)).toBe(result.visibleMessage);
  });

  test("returns no-op when formatter command succeeds with empty stdout", async () => {
    let publishCalls = 0;
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        runFormatterCommand: async () => makeCommandResult({ status: "no-op", stdout: "" }),
        publishFormatterSuggestionReview: async () => { publishCalls += 1; return makePublisherResult(); },
      }),
    );

    expect(publishCalls).toBe(0);
    expect(result).toMatchObject({ status: "no-op", commandStatus: "no-op", suggestions: 0 });
    expect(result.visibleMessage).toContain("no formatter changes");
  });

  test("returns failed with bounded stderr for formatter command failure without exposing stdout", async () => {
    const { entries, logger } = createLogger();
    const result = await runFormatterSuggestionSubflow(
      makeOptions({ logger }),
      makeDeps({
        runFormatterCommand: async () => makeCommandResult({
          status: "failed",
          stdout: RAW_STDOUT_SENTINEL,
          stderrSummary: "formatter failed on src/example.ts",
          exitCode: 2,
        }),
      }),
    );

    expect(result).toMatchObject({ status: "failed", commandStatus: "failed", reason: "formatter failed on src/example.ts" });
    expect(result.visibleMessage).toContain("formatter command failed");
    expectNoRawFormatterStdout(result);
    expectNoRawFormatterStdout(entries);
  });

  test("returns failed with timeout wording for formatter command timeout", async () => {
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        runFormatterCommand: async () => makeCommandResult({
          status: "timed-out",
          timedOut: true,
          stderrSummary: "process exceeded timeout",
          exitCode: 124,
        }),
      }),
    );

    expect(result).toMatchObject({ status: "failed", commandStatus: "timed-out" });
    expect(result.visibleMessage).toContain("timed out");
  });

  test("returns pr-diff-unavailable when full PR diff content is missing", async () => {
    let publishCalls = 0;
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        collectDiffContext: async () => ({
          changedFiles: ["src/example.ts"],
          numstatLines: [],
          strategy: "github-file-list-fallback",
          mergeBaseRecovered: false,
          deepenAttempts: 0,
          unshallowAttempted: false,
          diffRange: "github-api:file-list",
        }),
        publishFormatterSuggestionReview: async () => { publishCalls += 1; return makePublisherResult(); },
      }),
    );

    expect(publishCalls).toBe(0);
    expect(result).toMatchObject({ status: "pr-diff-unavailable", commandStatus: "success", suggestions: 0 });
    expect(result.visibleMessage).toContain("PR diff");
  });

  test("returns mapped-no-suggestions with mapper skip summary for malformed formatter diff", async () => {
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        runFormatterCommand: async () => makeCommandResult({ stdout: "not a unified diff" }),
      }),
    );

    expect(result.status).toBe("mapped-no-suggestions");
    expect(result.commandStatus).toBe("success");
    expect(result.suggestions).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.mapperCounts?.parserSkipped).toBeGreaterThan(0);
    expect(result.visibleMessage).toContain("No formatter suggestions could be mapped");
  });

  test("publishes mapped suggestions with formatter-specific review output key and resolved head sha", async () => {
    const publishCalls: unknown[] = [];
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        publishFormatterSuggestionReview: async (payload) => {
          publishCalls.push(payload);
          return makePublisherResult();
        },
      }),
    );

    expect(result).toMatchObject({
      status: "posted",
      publisherStatus: "posted",
      suggestions: 1,
      posted: 1,
      reviewUrl: "https://github.com/acme/widgets/pull/42#pullrequestreview-987",
      headSha: "abc123def456",
    });
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]).toMatchObject({ commitId: "abc123def456", reviewOutputKey: expect.stringContaining("action-mention-format-suggestions") });
  });

  test("maps publisher skipped output to duplicate status", async () => {
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        publishFormatterSuggestionReview: async () => makePublisherResult({
          status: "skipped",
          posted: 0,
          skipped: 1,
          review: undefined,
          reviewOutput: { key: "formatter-output-key", markerIncluded: false, idempotencyDecision: "skip-existing-review" },
        }),
      }),
    );

    expect(result).toMatchObject({ status: "duplicate", publisherStatus: "skipped", posted: 0 });
    expect(result.visibleMessage).toContain("already published");
  });

  test("maps publisher blocked output to blocked status", async () => {
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        publishFormatterSuggestionReview: async () => makePublisherResult({
          status: "blocked",
          posted: 0,
          blocked: { pattern: "github_pat_", location: "comment" },
        }),
      }),
    );

    expect(result).toMatchObject({ status: "blocked", publisherStatus: "blocked", reason: "comment matched blocked secret pattern" });
    expect(result.visibleMessage).toContain("blocked");
  });

  test("maps publisher failed and rejected outputs to failed status", async () => {
    const rejected = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        publishFormatterSuggestionReview: async () => makePublisherResult({
          status: "failed",
          posted: 0,
          error: "Validation Failed",
          rejection: { status: 422, message: "Validation Failed" },
        }),
      }),
    );

    expect(rejected).toMatchObject({ status: "failed", publisherStatus: "failed", reason: "Validation Failed" });
    expect(rejected.visibleMessage).toContain("GitHub rejected");

    const thrown = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        publishFormatterSuggestionReview: async () => { throw new Error("publisher exploded with a bounded reason"); },
      }),
    );

    expect(thrown).toMatchObject({ status: "failed", publisherStatus: "failed", reason: "publisher exploded with a bounded reason" });
    expect(thrown.visibleMessage).toContain("formatter suggestions could not be published");
  });

  test("returns pr-diff-unavailable when full PR diff collection throws", async () => {
    let publishCalls = 0;
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        collectDiffContext: async () => { throw new Error("full diff fetch failed for ghp_secretTokenValue"); },
        publishFormatterSuggestionReview: async () => { publishCalls += 1; return makePublisherResult(); },
      }),
    );

    expect(publishCalls).toBe(0);
    expect(result).toMatchObject({
      status: "pr-diff-unavailable",
      commandStatus: "success",
      suggestions: 0,
      skipped: 0,
      capped: 0,
      diffRange: "origin/main...HEAD",
    });
    expect(result.reason).toContain("full diff fetch failed");
    expect(result.reason).not.toContain("ghp_secretTokenValue");
    expect(result.visibleMessage).toContain("full PR diff was unavailable");
  });

  test("fails visibly without publisher handoff when head sha cannot be resolved", async () => {
    let publishCalls = 0;
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        resolveHeadSha: async () => { throw new Error("HEAD is unavailable"); },
        publishFormatterSuggestionReview: async () => { publishCalls += 1; return makePublisherResult(); },
      }),
    );

    expect(publishCalls).toBe(0);
    expect(result).toMatchObject({
      status: "failed",
      commandStatus: "success",
      suggestions: 1,
      skipped: 0,
      capped: 0,
      reason: "HEAD is unavailable",
      diffRange: "origin/main...HEAD",
    });
    expect(result.reviewOutputKey).toBeUndefined();
    expect(result.headSha).toBeUndefined();
    expect(result.mapperCounts?.suggestions).toBe(1);
    expect(result.visibleMessage).toContain("PR head commit could not be resolved");
  });

  test("preserves publisher no-suggestions status without inferring success", async () => {
    const result = await runFormatterSuggestionSubflow(
      makeOptions(),
      makeDeps({
        publishFormatterSuggestionReview: async () => makePublisherResult({
          status: "no-suggestions",
          posted: 0,
          skipped: 1,
          review: undefined,
          reviewOutput: { key: "formatter-output-key", markerIncluded: false },
        }),
      }),
    );

    expect(result).toMatchObject({
      status: "mapped-no-suggestions",
      publisherStatus: "no-suggestions",
      suggestions: 1,
      posted: 0,
      publisherSkipped: 1,
      headSha: "abc123def456",
    });
    expect(result.reviewOutputKey).toContain("action-mention-format-suggestions");
    expect(result.visibleMessage).toContain("No formatter suggestions could be published");
  });

  test("reports capped mapped suggestions without bypassing S02 cap semantics", async () => {
    const result = await runFormatterSuggestionSubflow(
      makeOptions({ maxSuggestions: 1 }),
      makeDeps({
        runFormatterCommand: async () => makeCommandResult({ stdout: TWO_SUGGESTION_DIFF }),
        collectDiffContext: async () => ({
          changedFiles: ["src/example.ts"],
          numstatLines: ["2\t2\tsrc/example.ts"],
          diffContent: TWO_SUGGESTION_DIFF,
          strategy: "triple-dot",
          mergeBaseRecovered: false,
          deepenAttempts: 0,
          unshallowAttempted: false,
          diffRange: "origin/main...HEAD",
        }),
        publishFormatterSuggestionReview: async () => makePublisherResult({
          status: "posted",
          posted: 1,
          skipped: 1,
        }),
      }),
    );

    expect(result.status).toBe("posted");
    expect(result.suggestions).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.capped).toBe(1);
    expect(result.mapperCounts?.capped).toBe(1);
  });
});
