import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { JobSnapshot } from "../jobs/types.ts";
import { createAbandonedJobNotifier } from "./abandoned-job-notifier.ts";

type TestLogger = Logger & { _entries: Array<{ level: string; bindings: Record<string, unknown>; message: string }> };

function createTestLogger(): TestLogger {
  const entries: Array<{ level: string; bindings: Record<string, unknown>; message: string }> = [];
  const logger = {
    info: (bindings: Record<string, unknown>, message: string) => entries.push({ level: "info", bindings, message }),
    warn: (bindings: Record<string, unknown>, message: string) => entries.push({ level: "warn", bindings, message }),
    error: (bindings: Record<string, unknown>, message: string) => entries.push({ level: "error", bindings, message }),
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
    _entries: entries,
  };
  return logger as unknown as TestLogger;
}

function createJobSnapshot(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    jobId: "1-1",
    installationId: 42,
    lane: "review",
    key: "acme/widgets#7",
    jobType: "pull-request-review",
    prNumber: 7,
    phase: "running",
    queuedAtMs: 0,
    lastProgressAtMs: 0,
    ...overrides,
  };
}

function createOctokitHarness() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    octokit: {
      rest: {
        issues: {
          createComment: async (params: Record<string, unknown>) => {
            calls.push(params);
            return { data: { id: 101 } };
          },
        },
      },
      // biome-ignore lint: minimal fake, only rest.issues.createComment is used
    } as any,
  };
}

describe("createAbandonedJobNotifier", () => {
  test("posts a notice for a notifiable job whose key parses to owner/repo/PR", async () => {
    const { octokit, calls } = createOctokitHarness();
    const logger = createTestLogger();
    const notifier = createAbandonedJobNotifier({
      logger,
      getInstallationOctokit: async () => octokit,
      getAppSlug: () => "kodiai",
    });

    await notifier.notify([createJobSnapshot()]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.owner).toBe("acme");
    expect(calls[0]?.repo).toBe("widgets");
    expect(calls[0]?.issue_number).toBe(7);
    expect(String(calls[0]?.body)).toContain("interrupted by deploy");
    expect(logger._entries.some((e) => e.message === "Posted deploy-interruption notice for abandoned review job")).toBe(true);
  });

  test("notifies every job independently and tolerates partial failure", async () => {
    const { octokit, calls } = createOctokitHarness();
    const logger = createTestLogger();
    let getOctokitCalls = 0;
    const notifier = createAbandonedJobNotifier({
      logger,
      getInstallationOctokit: async (installationId) => {
        getOctokitCalls += 1;
        if (installationId === 99) {
          throw new Error("installation revoked");
        }
        return octokit;
      },
      getAppSlug: () => "kodiai",
    });

    await notifier.notify([
      createJobSnapshot({ jobId: "1-1", installationId: 42, key: "acme/widgets#7", prNumber: 7 }),
      createJobSnapshot({ jobId: "1-2", installationId: 99, key: "acme/other#9", prNumber: 9 }),
    ]);

    expect(getOctokitCalls).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.issue_number).toBe(7);
    expect(logger._entries.some((e) => e.level === "error" && e.message === "Failed to post deploy-interruption notice for abandoned review job")).toBe(true);
  });

  test("skips job types with no PR to notify (e.g. sync jobs)", async () => {
    const { octokit, calls } = createOctokitHarness();
    const notifier = createAbandonedJobNotifier({
      logger: createTestLogger(),
      getInstallationOctokit: async () => octokit,
      getAppSlug: () => "kodiai",
    });

    await notifier.notify([createJobSnapshot({ jobType: "wiki-sync", key: "sync-scope" })]);

    expect(calls).toHaveLength(0);
  });

  test("skips a notifiable job whose key does not parse to owner/repo/PR", async () => {
    const { octokit, calls } = createOctokitHarness();
    const logger = createTestLogger();
    const notifier = createAbandonedJobNotifier({
      logger,
      getInstallationOctokit: async () => octokit,
      getAppSlug: () => "kodiai",
    });

    await notifier.notify([createJobSnapshot({ key: "not-a-review-family-key" })]);

    expect(calls).toHaveLength(0);
    expect(logger._entries.some((e) => e.level === "warn" && e.message.includes("did not resolve"))).toBe(true);
  });

  test("notifies an abandoned explicit-review mention job", async () => {
    const { octokit, calls } = createOctokitHarness();
    const notifier = createAbandonedJobNotifier({
      logger: createTestLogger(),
      getInstallationOctokit: async () => octokit,
      getAppSlug: () => "kodiai",
    });

    await notifier.notify([createJobSnapshot({
      jobType: "mention",
      lane: "interactive-review",
      key: "acme/widgets#7",
      prNumber: 7,
    })]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.issue_number).toBe(7);
    expect(String(calls[0]?.body)).toContain("Request interrupted by deploy");
  });

  test("posts one notice per PR when a review and its retry are both abandoned", async () => {
    const { octokit, calls } = createOctokitHarness();
    const notifier = createAbandonedJobNotifier({
      logger: createTestLogger(),
      getInstallationOctokit: async () => octokit,
      getAppSlug: () => "kodiai",
    });

    await notifier.notify([
      createJobSnapshot({ jobId: "1-1", jobType: "pull-request-review", key: "acme/widgets#7", prNumber: 7 }),
      createJobSnapshot({ jobId: "1-2", jobType: "pull-request-review-retry", key: "acme/widgets#7", prNumber: 7 }),
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.issue_number).toBe(7);
  });

  test("does not claim a never-started queued job was running", async () => {
    const { octokit, calls } = createOctokitHarness();
    const notifier = createAbandonedJobNotifier({
      logger: createTestLogger(),
      getInstallationOctokit: async () => octokit,
      getAppSlug: () => "kodiai",
    });

    await notifier.notify([createJobSnapshot({ phase: "queued" })]);

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.body)).toContain("still queued and had not started");
    expect(String(calls[0]?.body)).not.toContain("still running");
  });

  test("prefers the started job's wording when a queued duplicate shares the PR", async () => {
    const { octokit, calls } = createOctokitHarness();
    const notifier = createAbandonedJobNotifier({
      logger: createTestLogger(),
      getInstallationOctokit: async () => octokit,
      getAppSlug: () => "kodiai",
    });

    await notifier.notify([
      createJobSnapshot({ jobId: "1-1", phase: "queued", key: "acme/widgets#7", prNumber: 7 }),
      createJobSnapshot({ jobId: "1-2", phase: "running", key: "acme/widgets#7", prNumber: 7 }),
    ]);

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.body)).toContain("still running");
  });

  test("caps notices per deploy and spends the cap on jobs that actually started", async () => {
    const { octokit, calls } = createOctokitHarness();
    const logger = createTestLogger();
    const notifier = createAbandonedJobNotifier({
      logger,
      getInstallationOctokit: async () => octokit,
      getAppSlug: () => "kodiai",
      maxNotices: 2,
    });

    await notifier.notify([
      createJobSnapshot({ jobId: "1-1", phase: "queued", key: "acme/w#1", prNumber: 1 }),
      createJobSnapshot({ jobId: "1-2", phase: "queued", key: "acme/w#2", prNumber: 2 }),
      createJobSnapshot({ jobId: "1-3", phase: "running", key: "acme/w#3", prNumber: 3 }),
    ]);

    expect(calls).toHaveLength(2);
    // The started job must not be the one dropped.
    expect(calls.map((c) => c.issue_number)).toContain(3);
    // Truncation must be visible, never silent.
    expect(logger._entries.some((e) => e.bindings.droppedForCap === 1)).toBe(true);
  });

  test("unresolvable job keys do not consume the notice budget", async () => {
    const { octokit, calls } = createOctokitHarness();
    const notifier = createAbandonedJobNotifier({
      logger: createTestLogger(),
      getInstallationOctokit: async () => octokit,
      getAppSlug: () => "kodiai",
      maxNotices: 2,
    });

    await notifier.notify([
      createJobSnapshot({ jobId: "1-1", key: "not-a-key-a" }),
      createJobSnapshot({ jobId: "1-2", key: "not-a-key-b" }),
      createJobSnapshot({ jobId: "1-3", key: "not-a-key-c" }),
      createJobSnapshot({ jobId: "1-4", key: "acme/w#7", prNumber: 7 }),
    ]);

    // The real PR must still be notified despite three unnotifiable jobs
    // ahead of it and a cap of two.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.issue_number).toBe(7);
  });

  test("does nothing for an empty job list", async () => {
    const { octokit, calls } = createOctokitHarness();
    const getInstallationOctokit = mock(async () => octokit);
    const notifier = createAbandonedJobNotifier({
      logger: createTestLogger(),
      getInstallationOctokit,
      getAppSlug: () => "kodiai",
    });

    await notifier.notify([]);

    expect(calls).toHaveLength(0);
    expect(getInstallationOctokit).not.toHaveBeenCalled();
  });

  test("a hung GitHub call is bounded by perNoticeTimeoutMs and logged as a failure", async () => {
    const logger = createTestLogger();
    const notifier = createAbandonedJobNotifier({
      logger,
      getInstallationOctokit: () => new Promise(() => undefined), // never resolves
      getAppSlug: () => "kodiai",
      perNoticeTimeoutMs: 5,
    });

    await notifier.notify([createJobSnapshot()]);

    expect(logger._entries.some((e) => e.level === "error" && e.message === "Failed to post deploy-interruption notice for abandoned review job")).toBe(true);
  });
});
