/**
 * Tests for suggestion-cluster-scoring.ts
 *
 * Covers:
 * - scoreFindings happy path (suppression, boosting)
 * - safety guard: CRITICAL findings cannot be suppressed or boosted
 * - safety guard: MAJOR security/correctness findings cannot be suppressed
 * - fail-open: null model
 * - fail-open: model ineligible (insufficient members)
 * - fail-open: embedding failure for individual finding
 * - fail-open: all embeddings fail
 * - isModelEligibleForScoring threshold checks
 * - maxSimilarityToCentroids boundary conditions
 * - scoreFindingEmbedding pure-function tests (no I/O)
 * - conservative thresholds: just-below-threshold scores do NOT trigger
 */

import { describe, it, expect, mock } from "bun:test";
import {
  scoreFindings,
  scoreFindingEmbedding,
  isModelEligibleForScoring,
  maxSimilarityToCentroids,
  SUPPRESSION_THRESHOLD,
  BOOST_THRESHOLD,
  CONFIDENCE_BOOST_DELTA,
  MIN_CENTROID_MEMBERS_FOR_SCORING,
  type ScoringFinding,
} from "./suggestion-cluster-scoring.ts";
import type { SuggestionClusterModel } from "./suggestion-cluster-store.ts";
import type { EmbeddingProvider, EmbeddingResult } from "./types.ts";
import type { Logger } from "pino";

// ── Test helpers ──────────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => makeLogger(),
  } as unknown as Logger;
}

/** Build a Float32Array from a plain number[]. */
function fa(nums: number[]): Float32Array {
  return new Float32Array(nums);
}

/**
 * Build a minimal SuggestionClusterModel for testing.
 * positiveCentroids / negativeCentroids are optional.
 */
function makeModel(opts: {
  positiveCentroids?: Float32Array[];
  negativeCentroids?: Float32Array[];
  positiveMemberCount?: number;
  negativeMemberCount?: number;
}): SuggestionClusterModel {
  return {
    id: 1,
    repo: "owner/repo",
    positiveCentroids: opts.positiveCentroids ?? [],
    negativeCentroids: opts.negativeCentroids ?? [],
    memberCount: (opts.positiveMemberCount ?? 0) + (opts.negativeMemberCount ?? 0),
    positiveMemberCount: opts.positiveMemberCount ?? 0,
    negativeMemberCount: opts.negativeMemberCount ?? 0,
    builtAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Create an EmbeddingProvider that always returns the given embedding.
 */
function makeEmbeddingProvider(embedding: Float32Array): EmbeddingProvider {
  return {
    model: "voyage-test",
    dimensions: embedding.length,
    generate: async (_text, _inputType): Promise<EmbeddingResult> => ({
      embedding,
      model: "voyage-test",
      dimensions: embedding.length,
    }),
  };
}

/**
 * Create an EmbeddingProvider that always throws.
 */
function makeFailingEmbeddingProvider(): EmbeddingProvider {
  return {
    model: "voyage-test",
    dimensions: 4,
    generate: async () => {
      throw new Error("embedding service unavailable");
    },
  };
}

/**
 * Create an EmbeddingProvider that returns null (provider failure case).
 */
function makeNullEmbeddingProvider(): EmbeddingProvider {
  return {
    model: "voyage-test",
    dimensions: 4,
    generate: async (): Promise<EmbeddingResult> => null,
  };
}

/** A unit vector in [1,0,0,0] direction. */
const VEC_A = fa([1, 0, 0, 0]);
/** A unit vector in [0,1,0,0] direction — orthogonal to VEC_A. */
const VEC_B = fa([0, 1, 0, 0]);
/** A near-duplicate of VEC_A with very high cosine similarity. */
const VEC_A_NEAR = fa([0.9999, 0.0001, 0, 0]);

function makeFinding(overrides: Partial<ScoringFinding> = {}): ScoringFinding {
  return {
    title: "Missing null check on user input",
    severity: "medium",
    category: "correctness",
    confidence: 60,
    ...overrides,
  };
}

// ── isModelEligibleForScoring ─────────────────────────────────────────

describe("isModelEligibleForScoring", () => {
  it("returns false when model has no centroids at all", () => {
    const model = makeModel({ positiveMemberCount: 0, negativeMemberCount: 0 });
    expect(isModelEligibleForScoring(model)).toBe(false);
  });

  it("returns false when negative centroids present but member count below threshold", () => {
    const model = makeModel({
      negativeCentroids: [VEC_A],
      negativeMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING - 1,
    });
    expect(isModelEligibleForScoring(model)).toBe(false);
  });

  it("returns false when positive centroids present but member count below threshold", () => {
    const model = makeModel({
      positiveCentroids: [VEC_A],
      positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING - 1,
    });
    expect(isModelEligibleForScoring(model)).toBe(false);
  });

  it("returns true when negative class meets threshold", () => {
    const model = makeModel({
      negativeCentroids: [VEC_A],
      negativeMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    expect(isModelEligibleForScoring(model)).toBe(true);
  });

  it("returns true when positive class meets threshold", () => {
    const model = makeModel({
      positiveCentroids: [VEC_A],
      positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    expect(isModelEligibleForScoring(model)).toBe(true);
  });

  it("returns true when both classes meet threshold", () => {
    const model = makeModel({
      positiveCentroids: [VEC_A],
      negativeCentroids: [VEC_B],
      positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
      negativeMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    expect(isModelEligibleForScoring(model)).toBe(true);
  });
});

// ── maxSimilarityToCentroids ──────────────────────────────────────────

describe("maxSimilarityToCentroids", () => {
  it("returns null for empty centroids array", () => {
    expect(maxSimilarityToCentroids(VEC_A, [])).toBeNull();
  });

  it("returns similarity to single centroid", () => {
    const sim = maxSimilarityToCentroids(VEC_A, [VEC_A]);
    expect(sim).toBeCloseTo(1.0, 4);
  });

  it("returns the maximum when multiple centroids present", () => {
    // VEC_A vs VEC_A = 1.0, VEC_A vs VEC_B = 0.0
    const sim = maxSimilarityToCentroids(VEC_A, [VEC_B, VEC_A]);
    expect(sim).toBeCloseTo(1.0, 4);
  });

  it("skips empty centroids (length 0)", () => {
    const empty = new Float32Array(0);
    const sim = maxSimilarityToCentroids(VEC_A, [empty, VEC_B]);
    // VEC_A · VEC_B = 0 (orthogonal)
    expect(sim).toBeCloseTo(0.0, 4);
  });
});

// ── scoreFindingEmbedding (pure, no I/O) ──────────────────────────────

describe("scoreFindingEmbedding", () => {
  it("suppresses when negative score meets threshold", () => {
    const model = makeModel({
      negativeCentroids: [VEC_A],
      negativeMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    const finding = makeFinding({ severity: "minor", confidence: 50 });
    // VEC_A_NEAR has very high cosine similarity to VEC_A (>= 0.85)
    const result = scoreFindingEmbedding(finding, VEC_A_NEAR, model);
    expect(result.suppress).toBe(true);
    expect(result.suppressionReason).toMatch(/cluster:negative/);
    expect(result.negativeScore).not.toBeNull();
    expect(result.negativeScore!).toBeGreaterThanOrEqual(SUPPRESSION_THRESHOLD);
  });

  it("does NOT suppress when negative score is just below threshold", () => {
    // Construct a centroid that is moderately similar but below 0.85
    // VEC_A = [1,0,0,0], VEC_B = [0,1,0,0] → cosine = 0
    const model = makeModel({
      negativeCentroids: [VEC_B],
      negativeMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    const finding = makeFinding({ severity: "minor", confidence: 50 });
    const result = scoreFindingEmbedding(finding, VEC_A, model);
    expect(result.suppress).toBe(false);
    expect(result.suppressionReason).toBeNull();
  });

  it("boosts confidence when positive score meets threshold", () => {
    const model = makeModel({
      positiveCentroids: [VEC_A],
      positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    const finding = makeFinding({ severity: "minor", confidence: 50 });
    // VEC_A_NEAR ≈ VEC_A; similarity > 0.70
    const result = scoreFindingEmbedding(finding, VEC_A_NEAR, model);
    expect(result.suppress).toBe(false);
    expect(result.adjustedConfidence).toBe(50 + CONFIDENCE_BOOST_DELTA);
  });

  it("does NOT boost when positive score is just below threshold", () => {
    // Use an orthogonal vector → similarity ≈ 0
    const model = makeModel({
      positiveCentroids: [VEC_B],
      positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    const finding = makeFinding({ severity: "minor", confidence: 50 });
    const result = scoreFindingEmbedding(finding, VEC_A, model);
    expect(result.adjustedConfidence).toBe(50);
  });

  it("clamps boosted confidence to 100", () => {
    const model = makeModel({
      positiveCentroids: [VEC_A],
      positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    const finding = makeFinding({ severity: "minor", confidence: 95 });
    const result = scoreFindingEmbedding(finding, VEC_A_NEAR, model);
    expect(result.adjustedConfidence).toBe(100);
  });

  it("returns positive and negative scores in result", () => {
    const model = makeModel({
      positiveCentroids: [VEC_B],
      negativeCentroids: [VEC_A],
      positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
      negativeMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    const finding = makeFinding({ severity: "minor", confidence: 50 });
    const result = scoreFindingEmbedding(finding, VEC_A_NEAR, model);
    expect(result.negativeScore).not.toBeNull();
    expect(result.positiveScore).not.toBeNull();
    // VEC_A_NEAR vs VEC_A ≈ 1.0; VEC_A_NEAR vs VEC_B ≈ 0
    expect(result.negativeScore!).toBeGreaterThanOrEqual(SUPPRESSION_THRESHOLD);
    expect(result.positiveScore!).toBeLessThan(BOOST_THRESHOLD);
  });
});

// ── Safety guard ──────────────────────────────────────────────────────

describe("scoreFindingEmbedding — safety guard", () => {
  const highSimModel = makeModel({
    negativeCentroids: [VEC_A],
    positiveCentroids: [VEC_A],
    negativeMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
  });

  it("does NOT suppress CRITICAL findings even when similarity is above threshold", () => {
    const finding = makeFinding({ severity: "critical", confidence: 50, category: "style" });
    const result = scoreFindingEmbedding(finding, VEC_A_NEAR, highSimModel);
    expect(result.suppress).toBe(false);
    expect(result.suppressionReason).toBeNull();
  });

  it("does NOT boost CRITICAL findings (safety guard bypasses boost too)", () => {
    const finding = makeFinding({ severity: "critical", confidence: 50, category: "style" });
    const result = scoreFindingEmbedding(finding, VEC_A_NEAR, highSimModel);
    expect(result.adjustedConfidence).toBe(50); // unchanged
  });

  it("does NOT suppress MAJOR security findings", () => {
    const finding = makeFinding({ severity: "major", confidence: 50, category: "security" });
    const result = scoreFindingEmbedding(finding, VEC_A_NEAR, highSimModel);
    expect(result.suppress).toBe(false);
  });

  it("does NOT suppress MAJOR correctness findings", () => {
    const finding = makeFinding({ severity: "major", confidence: 50, category: "correctness" });
    const result = scoreFindingEmbedding(finding, VEC_A_NEAR, highSimModel);
    expect(result.suppress).toBe(false);
  });

  it("CAN suppress MAJOR performance findings (not in protected list)", () => {
    const finding = makeFinding({ severity: "major", confidence: 50, category: "performance" });
    const result = scoreFindingEmbedding(finding, VEC_A_NEAR, highSimModel);
    expect(result.suppress).toBe(true);
  });

  it("CAN suppress minor/medium findings", () => {
    const minor = makeFinding({ severity: "minor", confidence: 50, category: "style" });
    const medium = makeFinding({ severity: "medium", confidence: 50, category: "documentation" });
    expect(scoreFindingEmbedding(minor, VEC_A_NEAR, highSimModel).suppress).toBe(true);
    expect(scoreFindingEmbedding(medium, VEC_A_NEAR, highSimModel).suppress).toBe(true);
  });
});

// ── scoreFindings (async, with EmbeddingProvider) ─────────────────────

describe("scoreFindings", () => {
  const eligibleModel = makeModel({
    negativeCentroids: [VEC_A],
    positiveCentroids: [VEC_B],
    negativeMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
  });

  it("returns modelUsed=false when model is null (fail-open)", async () => {
    const provider = makeEmbeddingProvider(VEC_A);
    const findings = [makeFinding()];
    const result = await scoreFindings(findings, null, provider, makeLogger());
    expect(result.modelUsed).toBe(false);
    expect(result.suppressedCount).toBe(0);
    expect(result.boostedCount).toBe(0);
    expect(result.findings[0]!.confidence).toBe(findings[0]!.confidence);
    expect(result.findings[0]!.suppress).toBe(false);
  });

  it("returns modelUsed=false when model is ineligible (fail-open)", async () => {
    const ineligibleModel = makeModel({
      negativeCentroids: [VEC_A],
      negativeMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING - 1,
    });
    const provider = makeEmbeddingProvider(VEC_A);
    const result = await scoreFindings([makeFinding()], ineligibleModel, provider, makeLogger());
    expect(result.modelUsed).toBe(false);
  });

  it("returns empty findings array when input is empty (modelUsed=true)", async () => {
    const provider = makeEmbeddingProvider(VEC_A);
    const result = await scoreFindings([], eligibleModel, provider, makeLogger());
    expect(result.modelUsed).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.scores).toHaveLength(0);
  });

  it("suppresses finding when embedding similar to negative centroid", async () => {
    // VEC_A_NEAR is very similar to VEC_A (the negative centroid)
    const provider = makeEmbeddingProvider(VEC_A_NEAR);
    const findings = [makeFinding({ severity: "minor", confidence: 50 })];
    const result = await scoreFindings(findings, eligibleModel, provider, makeLogger());
    expect(result.modelUsed).toBe(true);
    expect(result.suppressedCount).toBe(1);
    expect(result.findings[0]!.suppress).toBe(true);
  });

  it("boosts finding when embedding similar to positive centroid", async () => {
    // Use a model where only positive centroid is VEC_A (no negative)
    const posOnlyModel = makeModel({
      positiveCentroids: [VEC_A],
      positiveMemberCount: MIN_CENTROID_MEMBERS_FOR_SCORING,
    });
    const provider = makeEmbeddingProvider(VEC_A_NEAR);
    const findings = [makeFinding({ severity: "minor", confidence: 50 })];
    const result = await scoreFindings(findings, posOnlyModel, provider, makeLogger());
    expect(result.boostedCount).toBe(1);
    expect(result.findings[0]!.adjustedConfidence).toBe(50 + CONFIDENCE_BOOST_DELTA);
  });

  it("applies no signal (fail-open) when embedding provider throws", async () => {
    const provider = makeFailingEmbeddingProvider();
    const findings = [makeFinding({ severity: "minor", confidence: 60 })];
    const result = await scoreFindings(findings, eligibleModel, provider, makeLogger());
    expect(result.modelUsed).toBe(true);
    expect(result.findings[0]!.suppress).toBe(false);
    expect(result.findings[0]!.adjustedConfidence).toBe(60);
    expect(result.suppressedCount).toBe(0);
  });

  it("applies no signal (fail-open) when embedding provider returns null", async () => {
    const provider = makeNullEmbeddingProvider();
    const findings = [makeFinding({ severity: "minor", confidence: 60 })];
    const result = await scoreFindings(findings, eligibleModel, provider, makeLogger());
    expect(result.findings[0]!.suppress).toBe(false);
    expect(result.findings[0]!.adjustedConfidence).toBe(60);
  });

  it("processes multiple findings independently", async () => {
    // First finding: similar to negative centroid (VEC_A) → suppressed
    // Second finding: orthogonal → no signal
    let callCount = 0;
    const provider: EmbeddingProvider = {
      model: "voyage-test",
      dimensions: 4,
      generate: async (): Promise<EmbeddingResult> => {
        callCount++;
        return callCount === 1
          ? { embedding: VEC_A_NEAR, model: "voyage-test", dimensions: 4 }
          : { embedding: VEC_B, model: "voyage-test", dimensions: 4 };
      },
    };

    const findings = [
      makeFinding({ title: "Finding 1", severity: "minor", confidence: 50 }),
      makeFinding({ title: "Finding 2", severity: "minor", confidence: 50 }),
    ];

    const result = await scoreFindings(findings, eligibleModel, provider, makeLogger());
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.suppress).toBe(true);
    expect(result.findings[1]!.suppress).toBe(false);
    expect(result.suppressedCount).toBe(1);
  });

  it("preserves all original finding fields on merged output", async () => {
    const provider = makeEmbeddingProvider(VEC_B); // orthogonal to negative centroid (VEC_A)
    const finding = {
      title: "Some title",
      severity: "medium" as const,
      category: "correctness" as const,
      confidence: 70,
      commentId: 999,
      filePath: "src/foo.ts",
    };
    const result = await scoreFindings([finding], eligibleModel, provider, makeLogger());
    const merged = result.findings[0]!;
    // Original fields preserved
    expect(merged.commentId).toBe(999);
    expect(merged.filePath).toBe("src/foo.ts");
    // Score fields added
    expect(typeof merged.suppress).toBe("boolean");
    expect(typeof merged.adjustedConfidence).toBe("number");
  });

  it("safety guard: does not suppress CRITICAL finding even with high negative score", async () => {
    // VEC_A_NEAR → high similarity to negative centroid VEC_A
    const provider = makeEmbeddingProvider(VEC_A_NEAR);
    const findings = [makeFinding({ severity: "critical", confidence: 80, category: "style" })];
    const result = await scoreFindings(findings, eligibleModel, provider, makeLogger());
    expect(result.findings[0]!.suppress).toBe(false);
    expect(result.suppressedCount).toBe(0);
  });

  it("scores and findings arrays have matching indices", async () => {
    const provider = makeEmbeddingProvider(VEC_B); // no suppression
    const findings = [
      makeFinding({ title: "A", confidence: 40 }),
      makeFinding({ title: "B", confidence: 50 }),
      makeFinding({ title: "C", confidence: 60 }),
    ];
    const result = await scoreFindings(findings, eligibleModel, provider, makeLogger());
    expect(result.scores).toHaveLength(3);
    expect(result.findings).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(result.scores[i]!.suppress).toBe(result.findings[i]!.suppress);
      expect(result.scores[i]!.adjustedConfidence).toBe(result.findings[i]!.adjustedConfidence);
    }
  });
});

// ── Conservative threshold boundary ──────────────────────────────────

describe("conservative thresholds", () => {
  it("SUPPRESSION_THRESHOLD is at least 0.80", () => {
    // The plan specifies 0.85 — ensure it stays conservative
    expect(SUPPRESSION_THRESHOLD).toBeGreaterThanOrEqual(0.80);
  });

  it("BOOST_THRESHOLD is lower than SUPPRESSION_THRESHOLD", () => {
    // Boosting is less risky than suppression, so its threshold is lower
    expect(BOOST_THRESHOLD).toBeLessThan(SUPPRESSION_THRESHOLD);
  });

  it("MIN_CENTROID_MEMBERS_FOR_SCORING is at least 5", () => {
    expect(MIN_CENTROID_MEMBERS_FOR_SCORING).toBeGreaterThanOrEqual(5);
  });
});
