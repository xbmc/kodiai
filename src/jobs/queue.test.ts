import { expect, test } from "bun:test";
import type { Logger } from "pino";
import { createJobQueue } from "./queue.ts";

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

test("createJobQueue passes structured wait metadata to queued review callbacks", async () => {
  const queue = createJobQueue(createNoopLogger());
  const firstStarted = Promise.withResolvers<void>();
  const releaseFirst = Promise.withResolvers<void>();
  let secondJobMetadata:
    | { queuedAtMs: number; startedAtMs: number; waitMs: number }
    | undefined;

  const firstJob = queue.enqueue(42, async () => {
    firstStarted.resolve();
    await releaseFirst.promise;
    return "first";
  });

  await firstStarted.promise;

  const secondJob = queue.enqueue(42, async (metadata) => {
    secondJobMetadata = metadata;
    return "second";
  });

  await Bun.sleep(20);
  releaseFirst.resolve();

  await Promise.all([firstJob, secondJob]);

  expect(secondJobMetadata).toBeDefined();
  const metadata = secondJobMetadata!;
  expect(metadata.waitMs).toBeGreaterThanOrEqual(15);
  expect(metadata.startedAtMs).toBeGreaterThanOrEqual(metadata.queuedAtMs);
  expect(metadata.startedAtMs - metadata.queuedAtMs).toBe(metadata.waitMs);
});
