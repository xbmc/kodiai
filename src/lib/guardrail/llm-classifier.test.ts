import { describe, expect, test, mock } from "bun:test";
import { createLlmClassifier, type LlmClassifier } from "./llm-classifier.ts";
import type { GroundingContext, ClaimClassification } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(provided: string[] = ["database connection pooling"]): GroundingContext {
  return {
    providedContext: provided,
    contextSources: ["issue"],
  };
}

function makeClaim(text: string, context?: GroundingContext) {
  return { text, context: context ?? makeContext() };
}

function createMockGenerateWithFallback(responseText: string) {
  return mock(async () => ({
    text: responseText,
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "claude-haiku-4-5-20250929",
    provider: "anthropic",
    usedFallback: false,
    durationMs: 100,
  }));
}

function createMockDeps(responseText: string) {
  const generateFn = createMockGenerateWithFallback(responseText);
  return {
    generateWithFallback: generateFn,
    taskRouter: {
      resolve: mock(() => ({
        modelId: "claude-haiku-4-5-20250929",
        provider: "anthropic",
        sdk: "ai" as const,
        fallbackModelId: "claude-sonnet-4-5-20250929",
        fallbackProvider: "anthropic",
      })),
    },
    repo: "owner/repo",
    deliveryId: "test-delivery",
    logger: {
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      debug: mock(() => {}),
      child: mock(() => ({
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
        debug: mock(() => {}),
      })),
    } as any,
  };
}

describe("createLlmClassifier", () => {
  test("classifies claims from valid JSON array response", async () => {
    const response = JSON.stringify([
      { label: "diff-grounded", confidence: 0.9, evidence: "Visible in diff" },
      { label: "external-knowledge", confidence: 0.85, evidence: "CVE reference" },
    ]);

    const deps = createMockDeps(response);
    const classifier = createLlmClassifier(deps);

    const claims = [
      makeClaim("This removes the handler."),
      makeClaim("CVE-2024-1234 is relevant."),
    ];

    const results = await classifier(claims);

    expect(results).toHaveLength(2);
    expect(results[0]!.label).toBe("diff-grounded");
    expect(results[0]!.confidence).toBe(0.9);
    expect(results[1]!.label).toBe("external-knowledge");
  });

  test("returns diff-grounded on JSON parse failure (fail-open)", async () => {
    const deps = createMockDeps("This is not JSON at all");
    const classifier = createLlmClassifier(deps);

    const claims = [makeClaim("Some claim.")];
    const results = await classifier(claims);

    expect(results).toHaveLength(1);
    expect(results[0]!.label).toBe("diff-grounded");
    expect(results[0]!.evidence).toContain("fail-open");
  });

  test("returns diff-grounded on LLM error (fail-open)", async () => {
    const deps = createMockDeps("");
    deps.generateWithFallback = mock(async () => {
      throw new Error("LLM unavailable");
    });
    const classifier = createLlmClassifier(deps);

    const claims = [makeClaim("Some claim.")];
    const results = await classifier(claims);

    expect(results).toHaveLength(1);
    expect(results[0]!.label).toBe("diff-grounded");
    expect(results[0]!.evidence).toContain("fail-open");
  });

  test("batches into chunks of 10 when > 10 claims", async () => {
    // Create response for 10 claims (first batch)
    const batch1 = Array.from({ length: 10 }, () => ({
      label: "diff-grounded",
      confidence: 0.8,
      evidence: "grounded",
    }));
    const batch2 = Array.from({ length: 2 }, () => ({
      label: "external-knowledge",
      confidence: 0.85,
      evidence: "external",
    }));

    let callCount = 0;
    const deps = createMockDeps("");
    deps.generateWithFallback = mock(async () => {
      callCount++;
      const batch = callCount === 1 ? batch1 : batch2;
      return {
        text: JSON.stringify(batch),
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-haiku-4-5-20250929",
        provider: "anthropic",
        usedFallback: false,
        durationMs: 100,
      };
    });

    const classifier = createLlmClassifier(deps);
    const claims = Array.from({ length: 12 }, (_, i) =>
      makeClaim(`Claim ${i}.`),
    );

    const results = await classifier(claims);

    expect(results).toHaveLength(12);
    expect(callCount).toBe(2);
    // First 10 should be diff-grounded (from batch1)
    expect(results[0]!.label).toBe("diff-grounded");
    // Last 2 should be external-knowledge (from batch2)
    expect(results[10]!.label).toBe("external-knowledge");
  });

  test("handles mismatched response length by padding with fail-open", async () => {
    // Return fewer results than claims
    const response = JSON.stringify([
      { label: "diff-grounded", confidence: 0.9, evidence: "Visible" },
    ]);

    const deps = createMockDeps(response);
    const classifier = createLlmClassifier(deps);

    const claims = [
      makeClaim("Claim one."),
      makeClaim("Claim two."),
      makeClaim("Claim three."),
    ];

    const results = await classifier(claims);

    expect(results).toHaveLength(3);
    expect(results[0]!.label).toBe("diff-grounded");
    // Padded claims should fail-open
    expect(results[1]!.label).toBe("diff-grounded");
    expect(results[2]!.label).toBe("diff-grounded");
  });

  test("includes claim text in returned classifications", async () => {
    const response = JSON.stringify([
      { label: "external-knowledge", confidence: 0.85, evidence: "CVE" },
    ]);

    const deps = createMockDeps(response);
    const classifier = createLlmClassifier(deps);

    const claims = [makeClaim("CVE-2024-1234 is critical.")];
    const results = await classifier(claims);

    expect(results[0]!.text).toBe("CVE-2024-1234 is critical.");
  });
});
