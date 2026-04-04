import { describe, expect, it, mock } from "bun:test";
import { generatePendingRuleProposals } from "./generated-rule-proposals.ts";
import type { MemoryOutcome } from "./types.ts";

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function normalizedEmbedding(seed: number, dim = 8): Float32Array {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    arr[i] = next() * 2 - 1;
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) arr[i] = arr[i]! / norm;
  return arr;
}

function slightlyAdjustedEmbedding(base: Float32Array, delta: number): Float32Array {
  const arr = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    arr[i] = base[i]! + delta;
  }

  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! / norm;
  return arr;
}

function toVectorString(arr: Float32Array): string {
  return `[${Array.from(arr).join(",")}]`;
}

function makeMemoryRow(overrides: {
  id: number;
  embedding: Float32Array;
  findingText: string;
  outcome?: MemoryOutcome;
  filePath?: string;
}) {
  return {
    id: overrides.id,
    outcome: overrides.outcome ?? "accepted",
    finding_text: overrides.findingText,
    file_path: overrides.filePath ?? `src/file-${overrides.id}.ts`,
    embedding: toVectorString(overrides.embedding),
    created_at: `2026-03-${String((overrides.id % 20) + 1).padStart(2, "0")}T00:00:00Z`,
  };
}

describe("generatePendingRuleProposals", () => {
  it("returns empty when there are too few memories to cluster", async () => {
    const base = normalizedEmbedding(1);
    const logger = createMockLogger();
    const sql = mock(async () => [
      makeMemoryRow({ id: 1, embedding: base, findingText: "Add an explicit null guard before dereferencing the optional pointer." }),
      makeMemoryRow({ id: 2, embedding: slightlyAdjustedEmbedding(base, 0.001), findingText: "Guard the optional pointer before reading nested fields." }),
    ]) as any;

    const proposals = await generatePendingRuleProposals({
      sql,
      logger,
      repo: "xbmc/xbmc",
    });

    expect(proposals).toEqual([]);
    expect(logger.info).toHaveBeenCalled();
  });

  it("builds a bounded proposal from a strong positive cluster", async () => {
    const base = normalizedEmbedding(2);
    const noisy = normalizedEmbedding(77);
    const logger = createMockLogger();
    const sql = mock(async () => [
      makeMemoryRow({ id: 1, embedding: base, findingText: "Add an explicit [`null guard`](https://example.com) before dereferencing optional pointers when the API can return nullptr." }),
      makeMemoryRow({ id: 2, embedding: slightlyAdjustedEmbedding(base, 0.001), findingText: "Check the pointer for null before calling methods on the optional response object." }),
      makeMemoryRow({ id: 3, embedding: slightlyAdjustedEmbedding(base, -0.001), findingText: "Return early when the optional settings object is null instead of dereferencing it." }),
      makeMemoryRow({ id: 4, embedding: slightlyAdjustedEmbedding(base, 0.002), findingText: "Guard against null before reading members from the optional config object." }),
      makeMemoryRow({ id: 5, embedding: slightlyAdjustedEmbedding(base, -0.002), findingText: "Avoid null dereferences by checking the optional context pointer before using it.", outcome: "thumbs_up" }),
      makeMemoryRow({ id: 9, embedding: noisy, findingText: "Unrelated formatting issue in a different part of the repo." }),
    ]) as any;

    const proposals = await generatePendingRuleProposals({
      sql,
      logger,
      repo: "xbmc/xbmc",
      maxTitleChars: 60,
      maxRuleTextChars: 120,
    });

    expect(proposals.length).toBe(1);
    expect(proposals[0]!.repo).toBe("xbmc/xbmc");
    expect(proposals[0]!.memberCount).toBe(5);
    expect(proposals[0]!.clusterSize).toBe(5);
    expect(proposals[0]!.acceptedCount).toBe(4);
    expect(proposals[0]!.thumbsUpCount).toBe(1);
    expect(proposals[0]!.positiveRatio).toBe(1);
    expect(proposals[0]!.signalScore).toBe(0.5);
    expect(proposals[0]!.clusterCentroid).toBeInstanceOf(Float32Array);
    expect(proposals[0]!.title.length).toBeLessThanOrEqual(60);
    expect(proposals[0]!.ruleText.length).toBeLessThanOrEqual(120);
    expect(proposals[0]!.ruleText.endsWith(".")).toBe(true);
    expect(proposals[0]!.representativeFindingText).not.toContain("```");
    expect(proposals[0]!.representativeFindingText).not.toContain("https://");
    expect(proposals[0]!.title).not.toContain("[");
    expect(logger.info).toHaveBeenCalled();
  });

  it("skips a cluster that has too much negative signal", async () => {
    const base = normalizedEmbedding(3);
    const logger = createMockLogger();
    const sql = mock(async () => [
      makeMemoryRow({ id: 1, embedding: base, findingText: "Check the pointer before dereferencing the cached response." }),
      makeMemoryRow({ id: 2, embedding: slightlyAdjustedEmbedding(base, 0.001), findingText: "Add a null check before using the optional state pointer." }),
      makeMemoryRow({ id: 3, embedding: slightlyAdjustedEmbedding(base, -0.001), findingText: "Guard against null before reading the context fields." }),
      makeMemoryRow({ id: 4, embedding: slightlyAdjustedEmbedding(base, 0.002), findingText: "Avoid dereferencing the handle before verifying it exists." }),
      makeMemoryRow({ id: 5, embedding: slightlyAdjustedEmbedding(base, -0.002), findingText: "Return early when the pointer is absent." }),
      makeMemoryRow({ id: 6, embedding: slightlyAdjustedEmbedding(base, 0.003), findingText: "This suggestion was suppressed repeatedly.", outcome: "suppressed" }),
      makeMemoryRow({ id: 7, embedding: slightlyAdjustedEmbedding(base, -0.003), findingText: "People downvoted this pattern in review.", outcome: "thumbs_down" }),
      makeMemoryRow({ id: 8, embedding: slightlyAdjustedEmbedding(base, 0.004), findingText: "Another negative signal on the same theme.", outcome: "suppressed" }),
      makeMemoryRow({ id: 9, embedding: slightlyAdjustedEmbedding(base, -0.004), findingText: "More negative evidence for the same cluster.", outcome: "thumbs_down" }),
    ]) as any;

    const proposals = await generatePendingRuleProposals({
      sql,
      logger,
      repo: "xbmc/xbmc",
    });

    expect(proposals).toEqual([]);
    const skipCalls = (logger.info as any).mock.calls.filter((call: unknown[]) =>
      String(call[1]).includes("Skipped generated-rule proposal cluster")
    );
    expect(skipCalls.length).toBeGreaterThan(0);
  });

  it("skips clusters whose representative text is too short after sanitization", async () => {
    const base = normalizedEmbedding(4);
    const logger = createMockLogger();
    const sql = mock(async () => [
      makeMemoryRow({ id: 1, embedding: base, findingText: "nit" }),
      makeMemoryRow({ id: 2, embedding: slightlyAdjustedEmbedding(base, 0.001), findingText: "nit" }),
      makeMemoryRow({ id: 3, embedding: slightlyAdjustedEmbedding(base, -0.001), findingText: "nit" }),
      makeMemoryRow({ id: 4, embedding: slightlyAdjustedEmbedding(base, 0.002), findingText: "nit" }),
      makeMemoryRow({ id: 5, embedding: slightlyAdjustedEmbedding(base, -0.002), findingText: "nit" }),
    ]) as any;

    const proposals = await generatePendingRuleProposals({
      sql,
      logger,
      repo: "xbmc/xbmc",
    });

    expect(proposals).toEqual([]);
  });

  it("caps proposal count to the configured maximum", async () => {
    const clusterA = normalizedEmbedding(10);
    const clusterB = normalizedEmbedding(20);
    const logger = createMockLogger();
    const sql = mock(async () => [
      makeMemoryRow({ id: 1, embedding: clusterA, findingText: "Add null guards before dereferencing optional pointers in the settings code path." }),
      makeMemoryRow({ id: 2, embedding: slightlyAdjustedEmbedding(clusterA, 0.001), findingText: "Check optional pointers for null before reading fields from cached config." }),
      makeMemoryRow({ id: 3, embedding: slightlyAdjustedEmbedding(clusterA, -0.001), findingText: "Return early when the optional state pointer is absent to avoid crashes." }),
      makeMemoryRow({ id: 4, embedding: slightlyAdjustedEmbedding(clusterA, 0.002), findingText: "Avoid dereferencing missing handles by adding an explicit null guard first." }),
      makeMemoryRow({ id: 5, embedding: slightlyAdjustedEmbedding(clusterA, -0.002), findingText: "Guard the optional response before using it inside the state transition." }),
      makeMemoryRow({ id: 11, embedding: clusterB, findingText: "Validate path normalization before joining user-controlled directories in the file cache." }),
      makeMemoryRow({ id: 12, embedding: slightlyAdjustedEmbedding(clusterB, 0.001), findingText: "Normalize user-provided paths before concatenating them into cache locations." }),
      makeMemoryRow({ id: 13, embedding: slightlyAdjustedEmbedding(clusterB, -0.001), findingText: "Reject unsafe directory segments before building the final cache path." }),
      makeMemoryRow({ id: 14, embedding: slightlyAdjustedEmbedding(clusterB, 0.002), findingText: "Ensure path traversal checks run before composing the destination path." }),
      makeMemoryRow({ id: 15, embedding: slightlyAdjustedEmbedding(clusterB, -0.002), findingText: "Perform path validation before writing to a cache directory derived from input." }),
    ]) as any;

    const proposals = await generatePendingRuleProposals({
      sql,
      logger,
      repo: "xbmc/xbmc",
      maxProposals: 1,
    });

    expect(proposals.length).toBe(1);
  });

  it("fails open when the query throws", async () => {
    const logger = createMockLogger();
    const sql = mock(async () => {
      throw new Error("db unavailable");
    }) as any;

    const proposals = await generatePendingRuleProposals({
      sql,
      logger,
      repo: "xbmc/xbmc",
    });

    expect(proposals).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });
});
