import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { CheckSuiteCompletedEvent } from "@octokit/webhooks-types";
import type { Logger } from "pino";
import { createCIFailureHandler } from "./ci-failure.ts";
import { createQueueRunMetadata, getEmptyActiveJobs } from "../jobs/queue.test-helpers.ts";
import { buildCIAnalysisMarker } from "../lib/ci-failure-formatter.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Sql } from "../db/client.ts";
import type { JobQueue, JobQueueContext } from "../jobs/types.ts";
import type { EventHandler, EventRouter, WebhookEvent } from "../webhook/types.ts";

type LogCall = { bindings: Record<string, unknown>; message: string };
type RegisteredHandler = { key: string; handler: EventHandler };
type CheckRun = { name: string; conclusion: string | null; status: string };
type CheckRunsPage = { data: Array<CheckRun> };
type QueueCall = { installationId: number; context?: JobQueueContext };
type Comment = { id: number; body?: string | null };
type FlakinessRow = { check_name: string; conclusion: string };

type HarnessOptions = {
  headChecksByRef?: Record<string, CheckRunsPage[]>;
  headChecksErrorByRef?: Record<string, Error>;
  baseCommitsByRef?: Record<string, Array<{ sha: string }>>;
  baseCommitsErrorByRef?: Record<string, Error>;
  flakinessRows?: FlakinessRow[];
  commentsByPage?: Comment[][];
  listCommentsError?: Error;
};

function createSharedLogger() {
  const debugCalls: LogCall[] = [];
  const warnCalls: LogCall[] = [];

  const logger = {
    debug: (bindings: Record<string, unknown>, message: string) => {
      debugCalls.push({ bindings, message });
    },
    warn: (bindings: Record<string, unknown>, message: string) => {
      warnCalls.push({ bindings, message });
    },
    info: () => {},
    error: () => {},
    child: () => logger,
  } as unknown as Logger;

  return { logger, debugCalls, warnCalls };
}

function createCapturedRouter(): EventRouter & { captured: RegisteredHandler[] } {
  const captured: RegisteredHandler[] = [];
  return {
    captured,
    register(eventKey: string, handler: EventHandler) {
      captured.push({ key: eventKey, handler });
    },
    dispatch: async () => {},
  };
}

function toAsyncIterable<T>(pages: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const page of pages) {
        yield page;
      }
    },
  };
}

function createSqlMock(options: Pick<HarnessOptions, "flakinessRows"> = {}) {
  const sql = (async (
    stringsOrValues: TemplateStringsArray | unknown[],
    ...values: unknown[]
  ) => {
    if (Array.isArray(stringsOrValues) && !("raw" in stringsOrValues)) {
      return { rows: stringsOrValues, columns: values };
    }

    const text = String.raw(
      { raw: (stringsOrValues as TemplateStringsArray).raw },
      ...values.map(() => "?"),
    );

    if (text.includes("SELECT check_name, conclusion")) {
      return options.flakinessRows ?? [];
    }

    return [];
  }) as unknown as Sql;

  return sql;
}

function loadFixture(): CheckSuiteCompletedEvent {
  return {
    action: "completed",
    installation: { id: 42 } as CheckSuiteCompletedEvent["installation"],
    repository: {
      owner: { login: "octo-org" },
      name: "widget",
    } as CheckSuiteCompletedEvent["repository"],
    check_suite: {
      head_sha: "1111111111111111111111111111111111111111",
      pull_requests: [
        {
          number: 17,
          base: { ref: "main" },
        },
      ],
    } as CheckSuiteCompletedEvent["check_suite"],
  } as CheckSuiteCompletedEvent;
}

function clonePayload(): CheckSuiteCompletedEvent {
  return structuredClone(loadFixture());
}

function makeEvent(payload: CheckSuiteCompletedEvent): WebhookEvent {
  return {
    id: "delivery-1",
    name: "check_suite",
    installationId: payload.installation?.id ?? 42,
    payload: payload as unknown as Record<string, unknown>,
  };
}

function createHarness(options: HarnessOptions = {}) {
  const router = createCapturedRouter();
  const { logger, debugCalls, warnCalls } = createSharedLogger();
  const queueCalls: QueueCall[] = [];

  const listForRef = mock(async () => ({ data: [] }));
  const iterator = mock((_method: unknown, params: { ref: string }) => {
    const error = options.headChecksErrorByRef?.[params.ref];
    if (error) {
      return {
        async *[Symbol.asyncIterator]() {
          throw error;
        },
      } as AsyncIterable<CheckRunsPage>;
    }

    const pages = options.headChecksByRef?.[params.ref] ?? [];
    return toAsyncIterable(pages);
  });
  const listCommits = mock(async (params: { sha: string }) => {
    const error = options.baseCommitsErrorByRef?.[params.sha];
    if (error) {
      throw error;
    }

    return {
      data: options.baseCommitsByRef?.[params.sha] ?? [],
    };
  });
  const listComments = mock(async (params: { page: number }) => {
    if (options.listCommentsError) {
      throw options.listCommentsError;
    }
    return { data: options.commentsByPage?.[params.page - 1] ?? [] };
  });
  const createComment = mock(async () => ({ data: { id: 999 } }));
  const updateComment = mock(async () => ({ data: { id: 999 } }));

  const octokit = {
    paginate: { iterator },
    rest: {
      checks: { listForRef },
      repos: { listCommits },
      issues: {
        listComments,
        createComment,
        updateComment,
      },
    },
  };

  const githubApp = {
    getInstallationOctokit: async () => octokit as never,
    getAppSlug: () => "kodiai",
    initialize: async () => {},
    checkConnectivity: async () => true,
    getInstallationToken: async () => "token",
    getRepoInstallationContext: async () => null,
  } as unknown as GitHubApp;

  const jobQueue: JobQueue = {
    enqueue: async (installationId, run, context) => {
      queueCalls.push({ installationId, context });
      return run(
        createQueueRunMetadata({
          lane: context?.lane ?? "sync",
          key: context?.key ?? "test-key",
        }),
      );
    },
    getQueueSize: () => 0,
    getPendingCount: () => 0,
    getActiveJobs: getEmptyActiveJobs,
  };

  createCIFailureHandler({
    eventRouter: router,
    jobQueue,
    githubApp,
    sql: createSqlMock(options),
    logger,
  });

  return {
    router,
    debugCalls,
    warnCalls,
    queueCalls,
    octokit,
  };
}

function extractPostedBody(harness: ReturnType<typeof createHarness>): string {
  const createCalls = harness.octokit.rest.issues.createComment.mock.calls as unknown as Array<[{ body: string }]>;
  const createCall = createCalls[0];
  if (createCall) {
    return createCall[0].body;
  }

  const updateCalls = harness.octokit.rest.issues.updateComment.mock.calls as unknown as Array<[{ body: string }]>;
  const updateCall = updateCalls[0];
  if (updateCall) {
    return updateCall[0].body;
  }

  throw new Error("Expected a CI comment to be created or updated");
}

describe("createCIFailureHandler", () => {
  let fixture: CheckSuiteCompletedEvent;

  beforeEach(() => {
    fixture = clonePayload();
  });

  it("registers the check_suite.completed handler", () => {
    const harness = createHarness();

    expect(harness.router.captured).toHaveLength(1);
    expect(harness.router.captured[0]?.key).toBe("check_suite.completed");
  });

  it("sorts multiple PR numbers into deterministic queue metadata", async () => {
    const payload = clonePayload();
    payload.check_suite.pull_requests = [
      { ...payload.check_suite.pull_requests[0]!, number: 22 },
      { ...payload.check_suite.pull_requests[0]!, number: 5 },
      { ...payload.check_suite.pull_requests[0]!, number: 17 },
    ];

    const harness = createHarness();
    await harness.router.captured[0]!.handler(makeEvent(payload));

    expect(harness.queueCalls).toHaveLength(1);
    expect(harness.queueCalls[0]?.context).toMatchObject({
      jobType: "ci-failure-analysis",
      lane: "sync",
      key: "octo-org/widget#5,17,22",
      prNumber: 22,
      eventName: "check_suite",
      action: "completed",
    });
  });

  it("returns early when repository owner metadata is missing", async () => {
    const payload = clonePayload();
    payload.repository.owner.login = undefined as never;

    const harness = createHarness();
    await harness.router.captured[0]!.handler(makeEvent(payload));

    expect(harness.queueCalls).toHaveLength(0);
    expect(harness.debugCalls).toHaveLength(0);
  });

  it("skips when the check suite has no pull requests", async () => {
    const payload = clonePayload();
    payload.check_suite.pull_requests = [];

    const harness = createHarness();
    await harness.router.captured[0]!.handler(makeEvent(payload));

    expect(harness.queueCalls).toHaveLength(0);
    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        headSha: payload.check_suite.head_sha,
      },
      message: "No PRs in check_suite (fork?)",
    });
  });

  it("skips annotation when the head check runs have no failures", async () => {
    const payload = clonePayload();
    const harness = createHarness({
      headChecksByRef: {
        [payload.check_suite.head_sha]: [
          {
            data: [
              { name: "build", conclusion: "success", status: "completed" },
              { name: "lint", conclusion: "neutral", status: "completed" },
            ],
          },
        ],
      },
    });

    await harness.router.captured[0]!.handler(makeEvent(payload));

    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        prNumber: 17,
        headSha: payload.check_suite.head_sha,
      },
      message: "All checks pass, skipping CI annotation",
    });
    expect(harness.octokit.rest.repos.listCommits).not.toHaveBeenCalled();
    expect(harness.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("skips annotation when the PR payload has no base ref", async () => {
    const payload = clonePayload();
    payload.check_suite.pull_requests = [
      {
        ...payload.check_suite.pull_requests[0]!,
        base: undefined as never,
      },
    ];

    const harness = createHarness({
      headChecksByRef: {
        [payload.check_suite.head_sha]: [
          {
            data: [
              { name: "build", conclusion: "failure", status: "completed" },
            ],
          },
        ],
      },
    });

    await harness.router.captured[0]!.handler(makeEvent(payload));

    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        prNumber: 17,
      },
      message: "No base ref available, skipping CI annotation",
    });
    expect(harness.octokit.rest.repos.listCommits).not.toHaveBeenCalled();
  });

  it("skips annotation when base commits produce no check data", async () => {
    const payload = clonePayload();
    const harness = createHarness({
      headChecksByRef: {
        [payload.check_suite.head_sha]: [
          {
            data: [
              { name: "build", conclusion: "failure", status: "completed" },
            ],
          },
        ],
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [{ data: [] }],
        bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: [{ data: [] }],
      },
      baseCommitsByRef: {
        main: [
          { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        ],
      },
    });

    await harness.router.captured[0]!.handler(makeEvent(payload));

    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        prNumber: 17,
      },
      message: "No base-branch check data, skipping CI annotation",
    });
    expect(harness.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(harness.warnCalls).toHaveLength(0);
  });

  it("creates a comment whose body shows unrelated classification from matching base failures", async () => {
    const payload = clonePayload();
    const marker = buildCIAnalysisMarker("octo-org", "widget", 17);
    const harness = createHarness({
      headChecksByRef: {
        [payload.check_suite.head_sha]: [
          {
            data: [
              { name: "build", conclusion: "failure", status: "completed" },
            ],
          },
        ],
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [
          {
            data: [
              { name: "build", conclusion: "failure", status: "completed" },
            ],
          },
        ],
      },
      baseCommitsByRef: {
        main: [{ sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
      },
      commentsByPage: [[{ id: 41, body: "existing comment without hidden marker" }]],
    });

    await harness.router.captured[0]!.handler(makeEvent(payload));

    expect(harness.octokit.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(harness.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);

    const body = extractPostedBody(harness);
    expect(body).toContain(marker);
    expect(body.split(marker)).toHaveLength(2);
    expect(body).toContain("**All 1 failure appear unrelated to this PR**");
    expect(body).toContain("- :white_check_mark: **build** [high confidence] — Also fails on aaaaaaa");
    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        prNumber: 17,
      },
      message: "Created new CI analysis comment",
    });
  });

  it("updates the existing marker comment when flakiness overrides the classification", async () => {
    const payload = clonePayload();
    const marker = buildCIAnalysisMarker("octo-org", "widget", 17);
    const harness = createHarness({
      headChecksByRef: {
        [payload.check_suite.head_sha]: [
          {
            data: [
              { name: "build", conclusion: "failure", status: "completed" },
            ],
          },
        ],
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [
          {
            data: [
              { name: "build", conclusion: "success", status: "completed" },
            ],
          },
        ],
      },
      baseCommitsByRef: {
        main: [{ sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
      },
      flakinessRows: [
        { check_name: "build", conclusion: "failure" },
        { check_name: "build", conclusion: "failure" },
        { check_name: "build", conclusion: "failure" },
        { check_name: "build", conclusion: "failure" },
        { check_name: "build", conclusion: "failure" },
        { check_name: "build", conclusion: "failure" },
        { check_name: "build", conclusion: "failure" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
        { check_name: "build", conclusion: "success" },
      ],
      commentsByPage: [[{ id: 52, body: `${marker}\nold body` }]],
    });

    await harness.router.captured[0]!.handler(makeEvent(payload));

    expect(harness.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(harness.octokit.rest.issues.updateComment).toHaveBeenCalledTimes(1);
    expect(harness.octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: "octo-org",
      repo: "widget",
      comment_id: 52,
      body: expect.any(String),
    });

    const body = extractPostedBody(harness);
    expect(body).toContain(marker);
    expect(body.split(marker)).toHaveLength(2);
    expect(body).toContain("**All 1 failure appear unrelated to this PR**");
    expect(body).toContain("- :warning: **build** [medium confidence] — Historically flaky");
    expect(body).toContain("Failed 35% of last 20 runs");
    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        prNumber: 17,
        commentId: 52,
      },
      message: "Updated existing CI analysis comment",
    });
  });

  it("warns and returns when head check listing hits a 403 permission error", async () => {
    const payload = clonePayload();
    const forbiddenError = Object.assign(new Error("forbidden"), { status: 403 });
    const harness = createHarness({
      headChecksErrorByRef: {
        [payload.check_suite.head_sha]: forbiddenError,
      },
    });

    await expect(harness.router.captured[0]!.handler(makeEvent(payload))).resolves.toBeUndefined();

    expect(harness.warnCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        owner: "octo-org",
        repo: "widget",
      },
      message: "checks:read permission may be missing",
    });
    expect(harness.debugCalls).toHaveLength(0);
    expect(harness.octokit.rest.repos.listCommits).not.toHaveBeenCalled();
    expect(harness.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("logs and skips annotation when fetching base commits fails", async () => {
    const payload = clonePayload();
    const harness = createHarness({
      headChecksByRef: {
        [payload.check_suite.head_sha]: [
          {
            data: [
              { name: "build", conclusion: "failure", status: "completed" },
            ],
          },
        ],
      },
      baseCommitsErrorByRef: {
        main: new Error("base branch unavailable"),
      },
    });

    await expect(harness.router.captured[0]!.handler(makeEvent(payload))).resolves.toBeUndefined();

    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        baseRef: "main",
      },
      message: "Failed to fetch base branch commits, skipping CI annotation",
    });
    expect(harness.warnCalls).toHaveLength(0);
    expect(harness.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("degrades individual base-commit check fetch failures to empty results", async () => {
    const payload = clonePayload();
    const harness = createHarness({
      headChecksByRef: {
        [payload.check_suite.head_sha]: [
          {
            data: [
              { name: "build", conclusion: "failure", status: "completed" },
            ],
          },
        ],
        bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: [
          {
            data: [
              { name: "build", conclusion: "failure", status: "completed" },
            ],
          },
        ],
      },
      headChecksErrorByRef: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: new Error("base checks unavailable"),
      },
      baseCommitsByRef: {
        main: [
          { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        ],
      },
      commentsByPage: [[]],
    });

    await expect(harness.router.captured[0]!.handler(makeEvent(payload))).resolves.toBeUndefined();

    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      message: "Failed to fetch checks for base commit",
    });
    expect(harness.warnCalls).toHaveLength(0);
    expect(harness.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);

    const body = extractPostedBody(harness);
    expect(body).toContain("**All 1 failure appear unrelated to this PR**");
    expect(body).toContain("Also fails on bbbbbbb");
  });

  it("warns fail-open and avoids escaping the queued job on unexpected GitHub errors", async () => {
    const payload = clonePayload();
    const harness = createHarness({
      headChecksErrorByRef: {
        [payload.check_suite.head_sha]: new Error("network exploded"),
      },
    });

    await expect(harness.router.captured[0]!.handler(makeEvent(payload))).resolves.toBeUndefined();

    expect(harness.warnCalls).toHaveLength(1);
    expect(harness.warnCalls[0]?.message).toBe("CI failure analysis error (fail-open)");
    expect(harness.warnCalls[0]?.bindings).toMatchObject({
      deliveryId: "delivery-1",
    });
    expect(harness.warnCalls[0]?.bindings.err).toBeDefined();
    expect(harness.octokit.rest.repos.listCommits).not.toHaveBeenCalled();
    expect(harness.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("creates a new comment with possibly-pr-related evidence when comment scanning fails open", async () => {
    const payload = clonePayload();
    const marker = buildCIAnalysisMarker("octo-org", "widget", 17);
    const harness = createHarness({
      headChecksByRef: {
        [payload.check_suite.head_sha]: [
          {
            data: [
              { name: "build", conclusion: "failure", status: "completed" },
            ],
          },
        ],
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [
          {
            data: [
              { name: "build", conclusion: "success", status: "completed" },
            ],
          },
        ],
      },
      baseCommitsByRef: {
        main: [{ sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
      },
      listCommentsError: new Error("comments unavailable"),
      flakinessRows: [],
    });

    await harness.router.captured[0]!.handler(makeEvent(payload));

    expect(harness.octokit.rest.issues.listComments).toHaveBeenCalledTimes(1);
    expect(harness.octokit.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(harness.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);

    const body = extractPostedBody(harness);
    expect(body).toContain(marker);
    expect(body.split(marker)).toHaveLength(2);
    expect(body).toContain("**0 of 1 failure appear unrelated to this PR**");
    expect(body).toContain("- :x: **build** [low confidence] — Passes on base branch");
    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        prNumber: 17,
      },
      message: "Failed to scan for existing CI comment, will create new",
    });
    expect(harness.debugCalls).toContainEqual({
      bindings: {
        deliveryId: "delivery-1",
        prNumber: 17,
      },
      message: "Created new CI analysis comment",
    });
  });
});
