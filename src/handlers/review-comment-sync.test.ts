import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { createReviewCommentSyncHandler } from "./review-comment-sync.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue } from "../jobs/types.ts";
import type { ReviewCommentChunk, ReviewCommentStore } from "../knowledge/review-comment-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";

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

function createMockStore(): ReviewCommentStore & {
  writtenChunks: ReviewCommentChunk[];
  updatedChunks: ReviewCommentChunk[];
  softDeleted: Array<{ repo: string; commentGithubId: number }>;
} {
  const writtenChunks: ReviewCommentChunk[] = [];
  const updatedChunks: ReviewCommentChunk[] = [];
  const softDeleted: Array<{ repo: string; commentGithubId: number }> = [];

  return {
    writtenChunks,
    updatedChunks,
    softDeleted,
    async writeChunks(chunks: ReviewCommentChunk[]) {
      writtenChunks.push(...chunks);
    },
    async updateChunks(chunks: ReviewCommentChunk[]) {
      updatedChunks.push(...chunks);
    },
    async softDelete(repo: string, commentGithubId: number) {
      softDeleted.push({ repo, commentGithubId });
    },
    async searchByEmbedding() {
      return [];
    },
    async getThreadComments() {
      return [];
    },
    async getSyncState() {
      return null;
    },
    async updateSyncState() {},
    async getLatestCommentDate() {
      return null;
    },
    async countByRepo() {
      return 0;
    },
  };
}

function createMockEmbeddingProvider(): EmbeddingProvider & { callCount: number } {
  const provider = {
    callCount: 0,
    async generate(_text: string, _inputType: "document" | "query") {
      provider.callCount++;
      return {
        embedding: new Float32Array(1024),
        model: "voyage-code-3",
        dimensions: 1024,
      };
    },
    get model() {
      return "voyage-code-3";
    },
    get dimensions() {
      return 1024;
    },
  };
  return provider;
}

/**
 * Create a mock job queue that executes jobs immediately (synchronously for testing).
 */
function createImmediateJobQueue(): JobQueue & { enqueuedCount: number } {
  const queue = {
    enqueuedCount: 0,
    async enqueue<T>(
      _installationId: number,
      fn: () => Promise<T>,
      _context?: Record<string, unknown>,
    ): Promise<T> {
      queue.enqueuedCount++;
      return fn();
    },
    getQueueSize() {
      return 0;
    },
    getPendingCount() {
      return 0;
    },
  };
  return queue;
}

/**
 * Create a mock job queue that captures jobs without executing them.
 */
function createCapturingJobQueue(): JobQueue & { capturedJobs: Array<() => Promise<unknown>> } {
  const captured: Array<() => Promise<unknown>> = [];
  return {
    capturedJobs: captured,
    async enqueue<T>(
      _installationId: number,
      fn: () => Promise<T>,
      _context?: Record<string, unknown>,
    ): Promise<T> {
      captured.push(fn as () => Promise<unknown>);
      return undefined as T;
    },
    getQueueSize() {
      return 0;
    },
    getPendingCount() {
      return 0;
    },
  };
}

/**
 * Create a mock event router that captures registrations.
 */
function createMockRouter(): EventRouter & {
  registrations: Map<string, Array<(event: WebhookEvent) => Promise<void>>>;
} {
  const registrations = new Map<string, Array<(event: WebhookEvent) => Promise<void>>>();
  return {
    registrations,
    register(eventKey: string, handler: (event: WebhookEvent) => Promise<void>) {
      const existing = registrations.get(eventKey) ?? [];
      existing.push(handler);
      registrations.set(eventKey, existing);
    },
    async dispatch() {},
  };
}

function buildCommentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 12345,
    body: "This looks like a potential null pointer issue.",
    path: "src/index.ts",
    line: 42,
    start_line: 40,
    diff_hunk: "@@ -38,6 +38,8 @@ function foo() {",
    in_reply_to_id: null,
    original_position: 10,
    pull_request_review_id: 999,
    created_at: "2026-02-20T10:00:00Z",
    updated_at: "2026-02-20T10:00:00Z",
    author_association: "CONTRIBUTOR",
    user: {
      login: "alice",
      type: "User",
    },
    ...overrides,
  };
}

function buildCreatedEvent(commentOverrides: Record<string, unknown> = {}): WebhookEvent {
  return {
    id: "delivery-rc-1",
    name: "pull_request_review_comment",
    installationId: 42,
    payload: {
      action: "created",
      repository: {
        full_name: "acme/repo",
        owner: { login: "acme" },
        name: "repo",
      },
      pull_request: {
        number: 101,
        title: "Fix null pointer",
      },
      comment: buildCommentPayload(commentOverrides),
    },
  };
}

function buildEditedEvent(commentOverrides: Record<string, unknown> = {}): WebhookEvent {
  return {
    id: "delivery-rc-2",
    name: "pull_request_review_comment",
    installationId: 42,
    payload: {
      action: "edited",
      repository: {
        full_name: "acme/repo",
        owner: { login: "acme" },
        name: "repo",
      },
      pull_request: {
        number: 101,
        title: "Fix null pointer",
      },
      comment: buildCommentPayload({
        body: "Updated: This is definitely a null pointer issue.",
        ...commentOverrides,
      }),
    },
  };
}

function buildDeletedEvent(commentOverrides: Record<string, unknown> = {}): WebhookEvent {
  return {
    id: "delivery-rc-3",
    name: "pull_request_review_comment",
    installationId: 42,
    payload: {
      action: "deleted",
      repository: {
        full_name: "acme/repo",
        owner: { login: "acme" },
        name: "repo",
      },
      pull_request: {
        number: 101,
        title: "Fix null pointer",
      },
      comment: buildCommentPayload(commentOverrides),
    },
  };
}

describe("review-comment-sync", () => {
  describe("handler registration", () => {
    test("registers handlers for all three event keys", () => {
      const router = createMockRouter();
      const store = createMockStore();
      const jobQueue = createImmediateJobQueue();
      const embeddingProvider = createMockEmbeddingProvider();

      createReviewCommentSyncHandler({
        eventRouter: router,
        jobQueue,
        store,
        embeddingProvider,
        logger: createNoopLogger(),
      });

      expect(router.registrations.has("pull_request_review_comment.created")).toBe(true);
      expect(router.registrations.has("pull_request_review_comment.edited")).toBe(true);
      expect(router.registrations.has("pull_request_review_comment.deleted")).toBe(true);
    });
  });

  describe("created event", () => {
    test("processes comment, produces chunk, writes to store", async () => {
      const router = createMockRouter();
      const store = createMockStore();
      const jobQueue = createImmediateJobQueue();
      const embeddingProvider = createMockEmbeddingProvider();

      createReviewCommentSyncHandler({
        eventRouter: router,
        jobQueue,
        store,
        embeddingProvider,
        logger: createNoopLogger(),
      });

      const handler = router.registrations.get("pull_request_review_comment.created")![0]!;
      await handler(buildCreatedEvent());

      expect(store.writtenChunks.length).toBeGreaterThan(0);
      expect(store.writtenChunks[0]!.repo).toBe("acme/repo");
      expect(store.writtenChunks[0]!.commentGithubId).toBe(12345);
      expect(store.writtenChunks[0]!.chunkText).toContain("null pointer");
      expect(embeddingProvider.callCount).toBeGreaterThan(0);
    });

    test("bot comment with login match is skipped", async () => {
      const router = createMockRouter();
      const store = createMockStore();
      const jobQueue = createImmediateJobQueue();
      const embeddingProvider = createMockEmbeddingProvider();

      createReviewCommentSyncHandler({
        eventRouter: router,
        jobQueue,
        store,
        embeddingProvider,
        logger: createNoopLogger(),
      });

      const handler = router.registrations.get("pull_request_review_comment.created")![0]!;
      await handler(buildCreatedEvent({
        user: { login: "dependabot", type: "User" },
      }));

      expect(store.writtenChunks.length).toBe(0);
      expect(embeddingProvider.callCount).toBe(0);
    });

    test("Bot type user (user.type === 'Bot') is skipped", async () => {
      const router = createMockRouter();
      const store = createMockStore();
      const jobQueue = createImmediateJobQueue();
      const embeddingProvider = createMockEmbeddingProvider();

      createReviewCommentSyncHandler({
        eventRouter: router,
        jobQueue,
        store,
        embeddingProvider,
        logger: createNoopLogger(),
      });

      const handler = router.registrations.get("pull_request_review_comment.created")![0]!;
      await handler(buildCreatedEvent({
        user: { login: "some-integration", type: "Bot" },
      }));

      expect(store.writtenChunks.length).toBe(0);
    });

    test("bot comment with [bot] suffix is skipped", async () => {
      const router = createMockRouter();
      const store = createMockStore();
      const jobQueue = createImmediateJobQueue();
      const embeddingProvider = createMockEmbeddingProvider();

      createReviewCommentSyncHandler({
        eventRouter: router,
        jobQueue,
        store,
        embeddingProvider,
        logger: createNoopLogger(),
      });

      const handler = router.registrations.get("pull_request_review_comment.created")![0]!;
      await handler(buildCreatedEvent({
        user: { login: "mybot[bot]", type: "User" },
      }));

      expect(store.writtenChunks.length).toBe(0);
    });

    test("job is enqueued (not processed synchronously)", async () => {
      const router = createMockRouter();
      const store = createMockStore();
      const jobQueue = createCapturingJobQueue();
      const embeddingProvider = createMockEmbeddingProvider();

      createReviewCommentSyncHandler({
        eventRouter: router,
        jobQueue,
        store,
        embeddingProvider,
        logger: createNoopLogger(),
      });

      const handler = router.registrations.get("pull_request_review_comment.created")![0]!;
      await handler(buildCreatedEvent());

      // Job was captured but not executed
      expect(jobQueue.capturedJobs.length).toBe(1);
      expect(store.writtenChunks.length).toBe(0);

      // Now execute the captured job
      await jobQueue.capturedJobs[0]!();
      expect(store.writtenChunks.length).toBeGreaterThan(0);
    });
  });

  describe("edited event", () => {
    test("re-chunks and calls updateChunks", async () => {
      const router = createMockRouter();
      const store = createMockStore();
      const jobQueue = createImmediateJobQueue();
      const embeddingProvider = createMockEmbeddingProvider();

      createReviewCommentSyncHandler({
        eventRouter: router,
        jobQueue,
        store,
        embeddingProvider,
        logger: createNoopLogger(),
      });

      const handler = router.registrations.get("pull_request_review_comment.edited")![0]!;
      await handler(buildEditedEvent());

      expect(store.updatedChunks.length).toBeGreaterThan(0);
      expect(store.updatedChunks[0]!.chunkText).toContain("definitely a null pointer");
      expect(store.writtenChunks.length).toBe(0); // Should use update, not write
      expect(embeddingProvider.callCount).toBeGreaterThan(0);
    });
  });

  describe("deleted event", () => {
    test("calls softDelete", async () => {
      const router = createMockRouter();
      const store = createMockStore();
      const jobQueue = createImmediateJobQueue();
      const embeddingProvider = createMockEmbeddingProvider();

      createReviewCommentSyncHandler({
        eventRouter: router,
        jobQueue,
        store,
        embeddingProvider,
        logger: createNoopLogger(),
      });

      const handler = router.registrations.get("pull_request_review_comment.deleted")![0]!;
      await handler(buildDeletedEvent());

      expect(store.softDeleted.length).toBe(1);
      expect(store.softDeleted[0]!.repo).toBe("acme/repo");
      expect(store.softDeleted[0]!.commentGithubId).toBe(12345);
    });
  });
});
