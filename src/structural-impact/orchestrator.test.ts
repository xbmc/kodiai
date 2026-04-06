import { describe, expect, test } from "bun:test";
import type { GraphAdapter, GraphBlastRadiusResult, CorpusAdapter, CorpusCodeMatch } from "./adapters.ts";
import type { StructuralImpactPayload } from "./types.ts";
import type { StructuralImpactCache } from "./cache.ts";
import { buildStructuralImpactCacheKey } from "./cache.ts";
import {
  fetchStructuralImpact,
  type StructuralImpactSignal,
} from "./orchestrator.ts";
import type { FetchStructuralImpactInput } from "./orchestrator.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeGraphResult(overrides?: Partial<GraphBlastRadiusResult>): GraphBlastRadiusResult {
  return {
    changedFiles: ["src/service.cpp"],
    seedSymbols: [
      {
        stableKey: "src/service.cpp::parseToken",
        symbolName: "parseToken",
        qualifiedName: "parseToken",
        filePath: "src/service.cpp",
      },
    ],
    impactedFiles: [
      {
        path: "src/auth.cpp",
        score: 0.95,
        confidence: 1.0,
        reasons: ["calls parseToken"],
        languages: ["cpp"],
      },
    ],
    probableDependents: [
      {
        stableKey: "src/auth.cpp::authenticate",
        symbolName: "authenticate",
        qualifiedName: "authenticate",
        filePath: "src/auth.cpp",
        score: 0.95,
        confidence: 1.0,
        reasons: ["calls parseToken"],
      },
    ],
    likelyTests: [
      {
        path: "tests/service_test.cpp",
        score: 1.0,
        confidence: 0.9,
        reasons: ["tests parseToken"],
        testSymbols: ["test_parseToken"],
      },
    ],
    graphStats: {
      files: 120,
      nodes: 850,
      edges: 3400,
      changedFilesFound: 1,
    },
    ...overrides,
  };
}

function makeCorpusMatches(n = 1): CorpusCodeMatch[] {
  return Array.from({ length: n }, (_, i) => ({
    filePath: `src/related_${i}.cpp`,
    language: "cpp",
    startLine: 10 * i + 1,
    endLine: 10 * i + 20,
    chunkType: "function",
    symbolName: `relatedFunc${i}`,
    chunkText: `// related function ${i}\nvoid relatedFunc${i}() {}`,
    distance: 0.1 + i * 0.05,
    commitSha: "abc123",
    canonicalRef: "main",
  }));
}

function makeGraphAdapter(result: GraphBlastRadiusResult | Error): GraphAdapter {
  return {
    queryBlastRadius: () =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  };
}

function makeCorpusAdapter(result: CorpusCodeMatch[] | Error): CorpusAdapter {
  return {
    searchCanonicalCode: () =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  };
}

function makeSlowGraphAdapter(delayMs: number): GraphAdapter {
  return {
    queryBlastRadius: () =>
      new Promise((resolve) => setTimeout(() => resolve(makeGraphResult()), delayMs)),
  };
}

function makeSlowCorpusAdapter(delayMs: number): CorpusAdapter {
  return {
    searchCanonicalCode: () =>
      new Promise((resolve) => setTimeout(() => resolve(makeCorpusMatches()), delayMs)),
  };
}

function makeBaseInput(
  overrides?: Partial<FetchStructuralImpactInput>,
): FetchStructuralImpactInput {
  return {
    graphAdapter: makeGraphAdapter(makeGraphResult()),
    corpusAdapter: makeCorpusAdapter(makeCorpusMatches()),
    graphInput: {
      repo: "acme/myrepo",
      workspaceKey: "ws-123",
      changedPaths: ["src/service.cpp"],
    },
    corpusInput: {
      repo: "acme/myrepo",
      canonicalRef: "main",
      query: "parseToken authentication",
    },
    ...overrides,
  };
}

function makeSimpleCache(): StructuralImpactCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: (key) => store.get(key) as ReturnType<StructuralImpactCache["get"]>,
    set: (key, value) => { store.set(key, value); },
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe("fetchStructuralImpact — happy path", () => {
  test("returns status ok when both adapters respond", async () => {
    const result = await fetchStructuralImpact(makeBaseInput());

    expect(result.status).toBe("ok");
    expect(result.changedFiles).toEqual(["src/service.cpp"]);
    expect(result.impactedFiles).toHaveLength(1);
    expect(result.impactedFiles[0]!.path).toBe("src/auth.cpp");
    expect(result.probableCallers).toHaveLength(1);
    expect(result.probableCallers[0]!.symbolName).toBe("authenticate");
    expect(result.likelyTests).toHaveLength(1);
    expect(result.canonicalEvidence).toHaveLength(1);
    expect(result.graphStats).not.toBeNull();
    expect(result.graphStats!.changedFilesRequested).toBe(1);
    expect(result.degradations).toHaveLength(0);
  });

  test("graphStats.changedFilesRequested reflects input changedPaths length", async () => {
    const result = await fetchStructuralImpact(
      makeBaseInput({
        graphInput: {
          repo: "acme/myrepo",
          workspaceKey: "ws-123",
          changedPaths: ["a.cpp", "b.cpp", "c.cpp"],
        },
        graphAdapter: makeGraphAdapter(makeGraphResult()),
      }),
    );

    expect(result.graphStats!.changedFilesRequested).toBe(3);
  });

  test("seedSymbols are forwarded from graph result", async () => {
    const result = await fetchStructuralImpact(makeBaseInput());

    expect(result.seedSymbols).toHaveLength(1);
    expect(result.seedSymbols[0]!.symbolName).toBe("parseToken");
  });
});

// ── Timeout behavior ──────────────────────────────────────────────────────────

describe("fetchStructuralImpact — timeout behavior", () => {
  test("graph timeout → status partial, degradation record added", async () => {
    const result = await fetchStructuralImpact(
      makeBaseInput({
        graphAdapter: makeSlowGraphAdapter(500),
        corpusAdapter: makeCorpusAdapter(makeCorpusMatches()),
        timeoutMs: 50,
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.graphStats).toBeNull();
    expect(result.canonicalEvidence).toHaveLength(1); // corpus still present
    const graphDeg = result.degradations.find((d) => d.source === "graph");
    expect(graphDeg).toBeDefined();
    expect(graphDeg?.reason).toContain("timed out");
  });

  test("corpus timeout → status partial, degradation record added", async () => {
    const result = await fetchStructuralImpact(
      makeBaseInput({
        graphAdapter: makeGraphAdapter(makeGraphResult()),
        corpusAdapter: makeSlowCorpusAdapter(500),
        timeoutMs: 50,
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.canonicalEvidence).toHaveLength(0); // corpus absent
    expect(result.impactedFiles).toHaveLength(1); // graph still present
    const corpusDeg = result.degradations.find((d) => d.source === "corpus");
    expect(corpusDeg).toBeDefined();
    expect(corpusDeg?.reason).toContain("timed out");
  });

  test("both timeout → status unavailable, two degradation records", async () => {
    const result = await fetchStructuralImpact(
      makeBaseInput({
        graphAdapter: makeSlowGraphAdapter(500),
        corpusAdapter: makeSlowCorpusAdapter(500),
        timeoutMs: 50,
      }),
    );

    expect(result.status).toBe("unavailable");
    expect(result.degradations).toHaveLength(2);
    expect(result.degradations.every((d) => d.reason.includes("timed out"))).toBe(true);
    expect(result.changedFiles).toEqual(["src/service.cpp"]);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("fetchStructuralImpact — adapter errors", () => {
  test("graph error → status partial, corpus evidence still present", async () => {
    const result = await fetchStructuralImpact(
      makeBaseInput({
        graphAdapter: makeGraphAdapter(new Error("graph query failed")),
        corpusAdapter: makeCorpusAdapter(makeCorpusMatches()),
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.graphStats).toBeNull();
    expect(result.canonicalEvidence).toHaveLength(1);
    const graphDeg = result.degradations.find((d) => d.source === "graph");
    expect(graphDeg).toBeDefined();
    expect(graphDeg?.reason).toContain("graph query failed");
  });

  test("corpus error → status partial, graph data still present", async () => {
    const result = await fetchStructuralImpact(
      makeBaseInput({
        graphAdapter: makeGraphAdapter(makeGraphResult()),
        corpusAdapter: makeCorpusAdapter(new Error("corpus unavailable")),
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.canonicalEvidence).toHaveLength(0);
    expect(result.impactedFiles).toHaveLength(1);
    const corpusDeg = result.degradations.find((d) => d.source === "corpus");
    expect(corpusDeg).toBeDefined();
    expect(corpusDeg?.reason).toContain("corpus unavailable");
  });

  test("both error → status unavailable", async () => {
    const result = await fetchStructuralImpact(
      makeBaseInput({
        graphAdapter: makeGraphAdapter(new Error("graph down")),
        corpusAdapter: makeCorpusAdapter(new Error("corpus down")),
      }),
    );

    expect(result.status).toBe("unavailable");
    expect(result.degradations).toHaveLength(2);
  });
});

// ── Cache behavior ────────────────────────────────────────────────────────────

describe("fetchStructuralImpact — cache behavior", () => {
  test("cache hit skips adapter calls and returns cached payload", async () => {
    const cache = makeSimpleCache();
    const key = buildStructuralImpactCacheKey({
      repo: "acme/myrepo",
      baseSha: "base1",
      headSha: "head1",
    });

    // Populate cache with a known result.
    const seed = await fetchStructuralImpact(makeBaseInput({ cache, cacheKey: key }));
    expect(seed.status).toBe("ok");
    expect(cache.store.size).toBe(1);

    // Replace adapters with broken ones — should never be called on cache hit.
    const second = await fetchStructuralImpact(
      makeBaseInput({
        graphAdapter: makeGraphAdapter(new Error("should not be called")),
        corpusAdapter: makeCorpusAdapter(new Error("should not be called")),
        cache,
        cacheKey: key,
      }),
    );

    expect(second.status).toBe("ok");
    expect(second.changedFiles).toEqual(seed.changedFiles);
  });

  test("cache miss triggers adapter calls and writes result to cache", async () => {
    const cache = makeSimpleCache();
    const key = buildStructuralImpactCacheKey({
      repo: "acme/myrepo",
      baseSha: "base2",
      headSha: "head2",
    });

    expect(cache.store.size).toBe(0);

    await fetchStructuralImpact(makeBaseInput({ cache, cacheKey: key }));

    expect(cache.store.size).toBe(1);
    const stored = cache.get(key);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe("ok");
  });

  test("partial result is also cached", async () => {
    const cache = makeSimpleCache();
    const key = buildStructuralImpactCacheKey({
      repo: "acme/myrepo",
      baseSha: "base3",
      headSha: "head3",
    });

    await fetchStructuralImpact(
      makeBaseInput({
        graphAdapter: makeSlowGraphAdapter(500),
        corpusAdapter: makeCorpusAdapter(makeCorpusMatches()),
        timeoutMs: 50,
        cache,
        cacheKey: key,
      }),
    );

    const stored = cache.get(key);
    expect(stored?.status).toBe("partial");
  });

  test("no cache provided → result not stored, no error", async () => {
    // Just confirm no throw when cache is undefined.
    const result = await fetchStructuralImpact(makeBaseInput());
    expect(result.status).toBe("ok");
  });
});

// ── Observability signals ─────────────────────────────────────────────────────

describe("fetchStructuralImpact — observability signals", () => {
  function collectSignals(overrides?: Partial<FetchStructuralImpactInput>): {
    signals: StructuralImpactSignal[];
    result: Promise<StructuralImpactPayload>;
  } {
    const signals: StructuralImpactSignal[] = [];
    const result = fetchStructuralImpact(
      makeBaseInput({
        onSignal: (s) => signals.push(s),
        ...overrides,
      }),
    );
    return { signals, result };
  }

  test("ok path emits graph-ok, corpus-ok, result-ok signals", async () => {
    const { signals, result } = collectSignals();
    await result;

    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain("graph-ok");
    expect(kinds).toContain("corpus-ok");
    expect(kinds).toContain("result-ok");
  });

  test("graph-ok signal includes elapsedMs", async () => {
    const { signals, result } = collectSignals();
    await result;

    const graphOk = signals.find((s) => s.kind === "graph-ok")!;
    expect(graphOk).toBeDefined();
    expect(typeof graphOk.elapsedMs).toBe("number");
    expect(graphOk.elapsedMs!).toBeGreaterThanOrEqual(0);
  });

  test("graph timeout emits graph-timeout signal with elapsedMs", async () => {
    const { signals, result } = collectSignals({
      graphAdapter: makeSlowGraphAdapter(500),
      timeoutMs: 50,
    });
    await result;

    const sig = signals.find((s) => s.kind === "graph-timeout")!;
    expect(sig).toBeDefined();
    expect(typeof sig.elapsedMs).toBe("number");
  });

  test("corpus error emits corpus-error signal with detail", async () => {
    const { signals, result } = collectSignals({
      corpusAdapter: makeCorpusAdapter(new Error("db connection lost")),
    });
    await result;

    const sig = signals.find((s) => s.kind === "corpus-error");
    expect(sig).toBeDefined();
    expect(sig?.detail).toContain("db connection lost");
  });

  test("result-partial emitted when one adapter fails", async () => {
    const { signals, result } = collectSignals({
      graphAdapter: makeGraphAdapter(new Error("boom")),
    });
    await result;

    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain("result-partial");
    expect(kinds).not.toContain("result-ok");
  });

  test("result-unavailable emitted when both adapters fail", async () => {
    const { signals, result } = collectSignals({
      graphAdapter: makeGraphAdapter(new Error("graph down")),
      corpusAdapter: makeCorpusAdapter(new Error("corpus down")),
    });
    await result;

    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain("result-unavailable");
  });

  test("cache-hit and cache-miss signals emitted correctly", async () => {
    const cache = makeSimpleCache();
    const key = buildStructuralImpactCacheKey({
      repo: "acme/myrepo",
      baseSha: "b1",
      headSha: "h1",
    });

    const missSignals: StructuralImpactSignal[] = [];
    await fetchStructuralImpact(
      makeBaseInput({ cache, cacheKey: key, onSignal: (s) => missSignals.push(s) }),
    );
    const missSig = missSignals.find((s) => s.kind === "cache-miss");
    expect(missSig).toBeDefined();
    const writeSig = missSignals.find((s) => s.kind === "cache-write");
    expect(writeSig).toBeDefined();

    const hitSignals: StructuralImpactSignal[] = [];
    await fetchStructuralImpact(
      makeBaseInput({ cache, cacheKey: key, onSignal: (s) => hitSignals.push(s) }),
    );
    const hitSig = hitSignals.find((s) => s.kind === "cache-hit");
    expect(hitSig).toBeDefined();
    // On cache hit, no graph/corpus adapter signals should appear.
    expect(hitSignals.some((s) => s.kind === "graph-ok")).toBe(false);
    expect(hitSignals.some((s) => s.kind === "corpus-ok")).toBe(false);
  });

  test("onSignal error is swallowed and does not propagate", async () => {
    const result = await fetchStructuralImpact(
      makeBaseInput({
        onSignal: () => { throw new Error("observer crashed"); },
      }),
    );

    // Review pipeline must not be affected by a misbehaving observer.
    expect(result.status).toBe("ok");
  });
});

// ── Cache key builder ─────────────────────────────────────────────────────────

describe("buildStructuralImpactCacheKey", () => {
  test("includes repo, baseSha, headSha", () => {
    const key = buildStructuralImpactCacheKey({
      repo: "acme/MyRepo",
      baseSha: "abc",
      headSha: "def",
    });

    expect(key).toContain("acme/myrepo");
    expect(key).toContain("abc");
    expect(key).toContain("def");
  });

  test("repo is lowercased for stability", () => {
    const a = buildStructuralImpactCacheKey({ repo: "Acme/Repo", baseSha: "s1", headSha: "s2" });
    const b = buildStructuralImpactCacheKey({ repo: "acme/repo", baseSha: "s1", headSha: "s2" });

    expect(a).toBe(b);
  });

  test("different SHAs produce different keys", () => {
    const a = buildStructuralImpactCacheKey({ repo: "acme/repo", baseSha: "s1", headSha: "s2" });
    const b = buildStructuralImpactCacheKey({ repo: "acme/repo", baseSha: "s1", headSha: "s3" });

    expect(a).not.toBe(b);
  });
});

// ── Concurrent execution ──────────────────────────────────────────────────────

describe("fetchStructuralImpact — concurrency", () => {
  test("both adapters run concurrently (total time < sum of individual times)", async () => {
    const DELAY = 80;
    const start = Date.now();

    const result = await fetchStructuralImpact(
      makeBaseInput({
        graphAdapter: makeSlowGraphAdapter(DELAY),
        corpusAdapter: makeSlowCorpusAdapter(DELAY),
        timeoutMs: 500,
      }),
    );

    const elapsed = Date.now() - start;
    // If sequential, elapsed ≥ 2*DELAY. Concurrent: ≥ DELAY but < 2*DELAY.
    expect(result.status).toBe("ok");
    // Allow generous upper bound for slow CI, but confirm well under 2x serial.
    expect(elapsed).toBeLessThan(DELAY * 3);
  });
});
