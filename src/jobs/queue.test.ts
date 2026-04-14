import { expect, test } from "bun:test";
import type { Logger } from "pino";
import { createJobQueue } from "./queue.ts";
import type { JobQueue, JobQueueRunMetadata } from "./types.ts";

const _enqueueCallbackRequiresMetadata: Parameters<JobQueue["enqueue"]>[1] = async (
  metadata: JobQueueRunMetadata,
) => metadata.waitMs;

void _enqueueCallbackRequiresMetadata;

function createNoopLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createNoopLogger(),
  } as unknown as Logger;
}

test("createJobQueue passes structured run metadata to queued review callbacks", async () => {
  const queue = createJobQueue(createNoopLogger());
  const firstStarted = Promise.withResolvers<void>();
  const releaseFirst = Promise.withResolvers<void>();
  let secondJobMetadata: JobQueueRunMetadata | undefined;

  const firstJob = queue.enqueue(42, async () => {
    firstStarted.resolve();
    await releaseFirst.promise;
    return "first";
  });

  await firstStarted.promise;

  const secondJob = queue.enqueue(
    42,
    async (metadata) => {
      secondJobMetadata = metadata;
      return "second";
    },
    { lane: "review", key: "pr-42" },
  );

  await Bun.sleep(20);
  releaseFirst.resolve();

  await Promise.all([firstJob, secondJob]);

  expect(secondJobMetadata).toBeDefined();
  const metadata = secondJobMetadata!;
  expect(metadata.waitMs).toBeGreaterThanOrEqual(15);
  expect(metadata.startedAtMs).toBeGreaterThanOrEqual(metadata.queuedAtMs);
  expect(metadata.startedAtMs - metadata.queuedAtMs).toBe(metadata.waitMs);
  expect(metadata.jobId).toBeString();
  expect(metadata.lane).toBe("review");
  expect(metadata.key).toBe("pr-42");
  expect(metadata.setPhase).toBeFunction();
});

test("createJobQueue lets interactive-review start while a review lane job is stuck on the same PR key", async () => {
  const queue = createJobQueue(createNoopLogger());
  const reviewStarted = Promise.withResolvers<void>();
  const releaseReview = Promise.withResolvers<void>();
  let interactiveStartedBeforeReviewRelease = false;

  const reviewJob = queue.enqueue(
    42,
    async () => {
      reviewStarted.resolve();
      await releaseReview.promise;
      return "review";
    },
    { lane: "review", key: "acme/repo#42" },
  );

  await reviewStarted.promise;

  const interactiveJob = queue.enqueue(
    42,
    async () => {
      interactiveStartedBeforeReviewRelease = true;
      return "interactive-review";
    },
    { lane: "interactive-review", key: "acme/repo#42" },
  );

  await Bun.sleep(20);
  const interactiveStartedWhileReviewWasRunning =
    interactiveStartedBeforeReviewRelease;
  releaseReview.resolve();

  await Promise.all([reviewJob, interactiveJob]);

  expect(interactiveStartedWhileReviewWasRunning).toBeTrue();
});

test("createJobQueue updates active job snapshots when setPhase is called", async () => {
  const queue = createJobQueue(createNoopLogger());
  const jobStarted = Promise.withResolvers<void>();
  const releaseJob = Promise.withResolvers<void>();
  let runMetadata: JobQueueRunMetadata | undefined;

  const job = queue.enqueue(
    42,
    async (metadata) => {
      runMetadata = metadata;
      jobStarted.resolve();
      await releaseJob.promise;
      return "done";
    },
    { lane: "review", key: "pr-42" },
  );

  await jobStarted.promise;

  runMetadata!.setPhase("publishing");

  const [activeJob] = queue.getActiveJobs(42);
  expect(activeJob).toBeDefined();
  const snapshot = activeJob!;
  expect(snapshot.phase).toBe("publishing");
  expect(snapshot.lane).toBe("review");
  expect(snapshot.key).toBe("pr-42");
  expect(snapshot.lastProgressAtMs).toBeGreaterThanOrEqual(snapshot.startedAtMs ?? 0);

  releaseJob.resolve();
  await job;

  expect(queue.getActiveJobs(42)).toHaveLength(0);
});
