import { describe, expect, mock, test } from "bun:test";
import {
  buildReviewLearningMemoryRecord,
  isReviewLearningMemorySkip,
  writeReviewLearningMemoryBatch,
  writeReviewLearningMemory,
  type BuildReviewLearningMemoryRecordInput,
} from "./review-learning-memory.ts";

function baseInput(overrides: Partial<BuildReviewLearningMemoryRecordInput> = {}): BuildReviewLearningMemoryRecordInput {
  const { finding: findingOverrides, ...contextOverrides } = overrides;
  return {
    repo: "owner/repo",
    owner: "owner",
    reviewId: 42,
    prNumber: 17,
    language: "cpp",
    ...contextOverrides,
    finding: {
      commentId: 1234,
      suppressed: false,
      title: "Avoid dereferencing maybe-null pointer",
      severity: "major",
      category: "correctness",
      filePath: "include/widget.h",
      ...findingOverrides,
    },
  };
}

function expectSkip(input: BuildReviewLearningMemoryRecordInput, reason: string) {
  const decision = buildReviewLearningMemoryRecord(input);
  expect(decision).toMatchObject({
    kind: "skip",
    gate: "learning-memory-write",
    gateResult: "skipped",
    reason,
    repo: input.repo ?? undefined,
    prNumber: input.prNumber,
  });
  return decision;
}

describe("buildReviewLearningMemoryRecord", () => {
  test("accepts persistable findings and materializes a safe LearningMemoryRecord", () => {
    const decision = buildReviewLearningMemoryRecord(baseInput());
    expect(decision.kind).toBe("candidate");
    if (decision.kind !== "candidate") throw new Error("expected candidate");

    expect(decision.embeddingText).toBe([
      "[major] [correctness]",
      "Avoid dereferencing maybe-null pointer",
      "File: include/widget.h",
    ].join("\n"));
    expect(decision.memoryKey).toEqual({
      repo: "owner/repo",
      findingId: 1234,
      outcome: "accepted",
    });

    const record = decision.toRecord({ model: "voyage-code-3", dimensions: 1024 });
    expect(isReviewLearningMemorySkip(record)).toBe(false);
    if (isReviewLearningMemorySkip(record)) throw new Error("expected record");

    expect(record).toEqual({
      repo: "owner/repo",
      owner: "owner",
      findingId: 1234,
      reviewId: 42,
      sourceRepo: "owner/repo",
      findingText: "Avoid dereferencing maybe-null pointer",
      severity: "major",
      category: "correctness",
      filePath: "include/widget.h",
      language: "cpp",
      outcome: "accepted",
      embeddingModel: "voyage-code-3",
      embeddingDim: 1024,
      stale: false,
    });
    expect(Object.values(record)).not.toContain(undefined);
  });

  test("passes through context-aware language", () => {
    const decision = buildReviewLearningMemoryRecord(baseInput({ language: "Objective-C++" }));
    expect(decision.kind).toBe("candidate");
    if (decision.kind !== "candidate") throw new Error("expected candidate");

    const record = decision.toRecord({ model: "voyage-code-3", dimensions: 1024 });
    expect(isReviewLearningMemorySkip(record)).toBe(false);
    if (isReviewLearningMemorySkip(record)) throw new Error("expected record");
    expect(record.language).toBe("Objective-C++");
  });

  test("omits findings without a comment id before embedding", () => {
    const decision = expectSkip(baseInput({ finding: { commentId: undefined } }), "missing-finding-id");
    expect(decision).toMatchObject({ filePath: "include/widget.h", findingTitle: "Avoid dereferencing maybe-null pointer" });
  });

  test("omits findings without a review id before embedding", () => {
    expectSkip(baseInput({ reviewId: undefined }), "missing-review-id");
  });

  test("omits findings with empty file paths or titles before embedding", () => {
    expectSkip(baseInput({ finding: { filePath: "" } }), "missing-file-path");
    expectSkip(baseInput({ finding: { title: "   " } }), "missing-finding-title");
  });

  test("records suppressed findings as suppressed outcome", () => {
    const decision = buildReviewLearningMemoryRecord(baseInput({ finding: { suppressed: true } }));
    expect(decision.kind).toBe("candidate");
    if (decision.kind !== "candidate") throw new Error("expected candidate");

    const record = decision.toRecord({ model: "voyage-code-3", dimensions: 1024 });
    expect(isReviewLearningMemorySkip(record)).toBe(false);
    if (isReviewLearningMemorySkip(record)) throw new Error("expected record");
    expect(record.outcome).toBe("suppressed");
  });

  test("returns bounded skip reason fields for invalid embedding metadata", () => {
    const decision = buildReviewLearningMemoryRecord(baseInput());
    expect(decision.kind).toBe("candidate");
    if (decision.kind !== "candidate") throw new Error("expected candidate");

    const record = decision.toRecord({ model: undefined, dimensions: undefined });
    expect(record).toMatchObject({
      kind: "skip",
      gate: "learning-memory-write",
      gateResult: "skipped",
      reason: "invalid-embedding-metadata",
      repo: "owner/repo",
      prNumber: 17,
      filePath: "include/widget.h",
      findingTitle: "Avoid dereferencing maybe-null pointer",
    });
  });
});

function noopLogger() {
  const noop = () => undefined;
  return { debug: noop, info: noop, warn: noop };
}

describe("writeReviewLearningMemory", () => {
  test("skips duplicate conflict keys before embedding", async () => {
    const calls: unknown[] = [];
    let embeddingCalls = 0;
    const store = {
      async hasMemoryConflict(key: unknown) {
        calls.push(key);
        return true;
      },
      async writeMemory() {
        throw new Error("writeMemory should not be called for duplicates");
      },
    };
    const embeddingProvider = {
      async generate() {
        embeddingCalls++;
        return {
          embedding: new Float32Array([1, 2, 3]),
          model: "voyage-code-3",
          dimensions: 1024,
        };
      },
      model: "voyage-code-3",
      dimensions: 1024,
    };

    const result = await writeReviewLearningMemory({
      input: baseInput(),
      store,
      embeddingProvider,
      logger: noopLogger(),
    });

    expect(result).toEqual({ ok: true, value: { status: "skipped", reason: "duplicate-memory" } });
    expect(embeddingCalls).toBe(0);
    expect(calls).toEqual([{
      repo: "owner/repo",
      findingId: 1234,
      outcome: "accepted",
    }]);
  });

  test("writes normally when the conflict preflight reports no duplicate", async () => {
    let embeddingCalls = 0;
    const conflictCalls: unknown[] = [];
    const written: unknown[] = [];
    const store = {
      async hasMemoryConflict(key: unknown) {
        conflictCalls.push(key);
        return false;
      },
      async writeMemory(record: unknown, embedding: Float32Array) {
        written.push({ record, embedding });
      },
    };
    const embeddingProvider = {
      async generate() {
        embeddingCalls++;
        return {
          embedding: new Float32Array([1, 2, 3]),
          model: "voyage-code-3",
          dimensions: 1024,
        };
      },
      model: "voyage-code-3",
      dimensions: 1024,
    };

    const result = await writeReviewLearningMemory({
      input: baseInput(),
      store,
      embeddingProvider,
      logger: noopLogger(),
    });

    expect(result).toEqual({ ok: true, value: { status: "written" } });
    expect(conflictCalls).toEqual([{
      repo: "owner/repo",
      findingId: 1234,
      outcome: "accepted",
    }]);
    expect(embeddingCalls).toBe(1);
    expect(written).toHaveLength(1);
  });
});

describe("writeReviewLearningMemoryBatch", () => {
  test("writes findings concurrently and logs aggregate outcome counts", async () => {
    const writeFindingMemory = mock(async (input: { input: BuildReviewLearningMemoryRecordInput }) => {
      if (input.input.finding.commentId === 1) return { ok: true as const, value: { status: "written" as const } };
      if (input.input.finding.commentId === 2) {
        return { ok: true as const, value: { status: "skipped" as const, reason: "missing-review-id" } };
      }
      return { ok: false as const, err: new Error("embedding unavailable") };
    });
    const logger = { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}) };

    const result = await writeReviewLearningMemoryBatch({
      findings: [
        { commentId: 1, filePath: "src/a.ts", title: "A", severity: "major", category: "correctness", suppressed: false },
        { commentId: 2, filePath: "include/widget.h", title: "B", severity: "minor", category: "style", suppressed: true },
        { commentId: 3, filePath: "src/c.ts", title: "C", severity: "medium", category: "performance", suppressed: false },
      ],
      owner: "owner",
      repo: "owner/repo",
      reviewId: 42,
      prNumber: 17,
      store: {
        async hasMemoryConflict() {
          return false;
        },
        async writeMemory() {},
      },
      embeddingProvider: {
        async generate() {
          return { embedding: new Float32Array([1]), model: "model", dimensions: 1 };
        },
        model: "model",
        dimensions: 1,
      },
      logger,
      logContext: { deliveryId: "delivery-1" },
      classifyLanguage: (filePath) => filePath.endsWith(".h") ? "cpp" : "typescript",
      writeFindingMemory,
    });

    expect(result).toEqual({
      written: 1,
      failed: 1,
      skipped: 1,
      skipReasons: { "missing-review-id": 1 },
      total: 3,
    });
    expect(writeFindingMemory).toHaveBeenCalledTimes(3);
    expect(writeFindingMemory.mock.calls[1]?.[0].input.language).toBe("cpp");
    expect(logger.info).toHaveBeenCalledWith(
      {
        deliveryId: "delivery-1",
        gate: "learning-memory-write",
        gateResult: "failed",
        written: 1,
        failed: 1,
        skipped: 1,
        skipReasons: { "missing-review-id": 1 },
        total: 3,
      },
      "Learning memory write batch complete",
    );
  });
});
