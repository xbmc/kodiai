import { describe, expect, test, mock } from "bun:test";
import { runGuardrailPipeline } from "./pipeline.ts";
import type {
  SurfaceAdapter,
  GroundingContext,
  GuardrailConfig,
  AuditRecord,
  ClaimClassification,
} from "./types.ts";
import type { LlmClassifier, LlmClassifierClaim } from "./llm-classifier.ts";

// ---------------------------------------------------------------------------
// Mock adapter operating on string arrays
// ---------------------------------------------------------------------------

function createMockAdapter(
  overrides: Partial<SurfaceAdapter<string[], string[]>> = {},
): SurfaceAdapter<string[], string[]> {
  return {
    surface: "test-surface",
    extractClaims: (output) => output,
    buildGroundingContext: () => ({
      providedContext: ["database connection pooling handler removal"],
      contextSources: ["issue"],
    }),
    reconstructOutput: (_output, keptClaims) => keptClaims,
    minContentThreshold: 2,
    ...overrides,
  };
}

const defaultConfig: GuardrailConfig = {
  strictness: "standard",
};

describe("runGuardrailPipeline", () => {
  test("all grounded claims: output unchanged, claimsRemoved=0, suppressed=false", async () => {
    const adapter = createMockAdapter();
    const input = ["fix the handler", "remove old connection pool", "update database config"];
    const output = [...input];

    const result = await runGuardrailPipeline({
      adapter,
      input,
      output,
      config: defaultConfig,
      repo: "owner/repo",
    });

    expect(result.output).toEqual(output);
    expect(result.claimsRemoved).toBe(0);
    expect(result.suppressed).toBe(false);
    expect(result.claimsTotal).toBe(3);
  });

  test("all external claims: output=null, suppressed=true", async () => {
    const adapter = createMockAdapter({
      buildGroundingContext: () => ({
        providedContext: ["unrelated context"],
        contextSources: ["issue"],
      }),
    });
    const output = [
      "This was released in March 2024",
      "CVE-2024-1234 affects this library",
      "This method was introduced in v3.2.1",
    ];

    const result = await runGuardrailPipeline({
      adapter,
      input: [],
      output,
      config: defaultConfig,
      repo: "owner/repo",
    });

    expect(result.output).toBeNull();
    expect(result.suppressed).toBe(true);
    expect(result.claimsRemoved).toBe(3);
  });

  test("mixed claims: external claims removed, output reconstructed", async () => {
    const adapter = createMockAdapter({
      buildGroundingContext: () => ({
        providedContext: ["fix the database connection handler for pooling"],
        contextSources: ["issue"],
      }),
    });
    const output = [
      "This fixes the database connection handler",
      "This was released in March 2024",
      "Update the pooling configuration",
    ];

    const result = await runGuardrailPipeline({
      adapter,
      input: [],
      output,
      config: defaultConfig,
      repo: "owner/repo",
    });

    expect(result.output).not.toBeNull();
    expect(result.claimsRemoved).toBe(1);
    expect(result.suppressed).toBe(false);
    // The kept claims should not include the external one
    expect(result.output).not.toContain("This was released in March 2024");
  });

  test("remaining text below minContentThreshold: output=null, suppressed=true", async () => {
    const adapter = createMockAdapter({
      minContentThreshold: 10, // high threshold
      buildGroundingContext: () => ({
        providedContext: ["fix handler"],
        contextSources: ["issue"],
      }),
    });
    const output = [
      "Fix handler",
      "This was released in March 2024",
      "CVE-2024-1234 is relevant",
    ];

    const result = await runGuardrailPipeline({
      adapter,
      input: [],
      output,
      config: defaultConfig,
      repo: "owner/repo",
    });

    expect(result.output).toBeNull();
    expect(result.suppressed).toBe(true);
  });

  test("classifier error: fail-open, output unchanged, classifierError=true", async () => {
    const adapter = createMockAdapter({
      // extractClaims will throw
      extractClaims: () => {
        throw new Error("classifier exploded");
      },
    });
    const output = ["Some claim"];

    const result = await runGuardrailPipeline({
      adapter,
      input: [],
      output,
      config: defaultConfig,
      repo: "owner/repo",
    });

    expect(result.output).toEqual(output);
    expect(result.classifierError).toBe(true);
    expect(result.suppressed).toBe(false);
  });

  test("calls auditStore.logRun with correct aggregate counts", async () => {
    let loggedRecord: AuditRecord | null = null;
    const auditStore = {
      logRun: (record: AuditRecord) => {
        loggedRecord = record;
      },
    };

    const adapter = createMockAdapter({
      buildGroundingContext: () => ({
        providedContext: ["fix the database connection handler for pooling"],
        contextSources: ["issue"],
      }),
    });
    const output = [
      "This fixes the database connection handler",
      "This was released in March 2024",
      "Update the pooling configuration",
    ];

    await runGuardrailPipeline({
      adapter,
      input: [],
      output,
      config: defaultConfig,
      repo: "owner/repo",
      auditStore,
    });

    expect(loggedRecord).not.toBeNull();
    expect(loggedRecord!.surface).toBe("test-surface");
    expect(loggedRecord!.repo).toBe("owner/repo");
    expect(loggedRecord!.strictness).toBe("standard");
    expect(loggedRecord!.claimsTotal).toBe(3);
    expect(loggedRecord!.claimsRemoved).toBe(1);
    expect(loggedRecord!.removedClaims.length).toBe(1);
  });

  test("respects strictness from config with surface-specific override", async () => {
    const adapter = createMockAdapter({
      surface: "pr-review",
    });

    const config: GuardrailConfig = {
      strictness: "lenient",
      overrides: {
        "pr-review": { strictness: "strict" },
      },
    };

    let loggedRecord: AuditRecord | null = null;
    const auditStore = {
      logRun: (record: AuditRecord) => {
        loggedRecord = record;
      },
    };

    const output = ["Fix the handler"];
    await runGuardrailPipeline({
      adapter,
      input: [],
      output,
      config,
      repo: "owner/repo",
      auditStore,
    });

    expect(loggedRecord).not.toBeNull();
    expect(loggedRecord!.strictness).toBe("strict");
  });

  test("with llmClassifier: ambiguous claims (confidence < 0.6) are reclassified via LLM", async () => {
    // Context that will result in ambiguous classification (low word overlap)
    const adapter = createMockAdapter({
      buildGroundingContext: () => ({
        providedContext: ["some unrelated context about networking"],
        contextSources: ["issue"],
      }),
    });
    // Claims with no strong signal get confidence 0.5 (below 0.6 threshold)
    const output = [
      "The method signature changed slightly",
      "This was released in March 2024", // external-knowledge pattern
    ];

    let llmCalledWith: LlmClassifierClaim[] = [];
    const mockLlmClassifier: LlmClassifier = mock(async (claims) => {
      llmCalledWith = claims;
      return claims.map((c: any) => ({
        text: c.text,
        label: "external-knowledge" as const,
        confidence: 0.85,
        evidence: "LLM classified as external",
      }));
    });

    let loggedRecord: AuditRecord | null = null;
    const auditStore = {
      logRun: (record: AuditRecord) => {
        loggedRecord = record;
      },
    };

    const result = await runGuardrailPipeline({
      adapter,
      input: [],
      output,
      config: defaultConfig,
      repo: "owner/repo",
      llmClassifier: mockLlmClassifier,
      auditStore,
    });

    // The LLM should have been called for ambiguous claims
    expect(loggedRecord!.llmFallbackUsed).toBe(true);
    expect(loggedRecord!.claimsAmbiguous).toBeGreaterThan(0);
  });

  test("without llmClassifier: ambiguous claims treated as grounded (fail-open)", async () => {
    const adapter = createMockAdapter({
      buildGroundingContext: () => ({
        providedContext: ["some unrelated context"],
        contextSources: ["issue"],
      }),
    });
    // A claim with no signal defaults to confidence 0.5 (ambiguous)
    const output = ["The method signature changed slightly"];

    let loggedRecord: AuditRecord | null = null;
    const auditStore = {
      logRun: (record: AuditRecord) => {
        loggedRecord = record;
      },
    };

    const result = await runGuardrailPipeline({
      adapter,
      input: [],
      output,
      config: defaultConfig,
      repo: "owner/repo",
      auditStore,
    });

    // Without LLM classifier, ambiguous claims remain grounded
    expect(result.output).not.toBeNull();
    expect(loggedRecord!.llmFallbackUsed).toBe(false);
    expect(loggedRecord!.claimsAmbiguous).toBeGreaterThan(0);
  });

  test("llmClassifier error: fail-open, keep original classifications", async () => {
    const adapter = createMockAdapter({
      buildGroundingContext: () => ({
        providedContext: ["some unrelated context"],
        contextSources: ["issue"],
      }),
    });
    const output = ["The method signature changed slightly"];

    const mockLlmClassifier: LlmClassifier = mock(async () => {
      throw new Error("LLM unavailable");
    });

    const result = await runGuardrailPipeline({
      adapter,
      input: [],
      output,
      config: defaultConfig,
      repo: "owner/repo",
      llmClassifier: mockLlmClassifier,
    });

    // Should fail-open: output kept as-is
    expect(result.output).not.toBeNull();
    expect(result.classifierError).toBe(false);
  });
});
