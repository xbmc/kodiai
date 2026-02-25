import { test, expect, describe } from "bun:test";
import { createCodeSnippetStore } from "./code-snippet-store.ts";

// Minimal mock for sql template tag
function createMockSql() {
  const calls: Array<{ query: string; values: unknown[] }> = [];

  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({
      query: strings.join("?"),
      values,
    });
    return Promise.resolve(Object.assign([], { count: 1 }));
  };

  return { sql, calls };
}

function createMockLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => createMockLogger(),
  } as unknown as import("pino").Logger;
}

describe("createCodeSnippetStore", () => {
  test("returns object with all required methods", () => {
    const { sql } = createMockSql();
    const store = createCodeSnippetStore({
      sql: sql as unknown as import("../db/client.ts").Sql,
      logger: createMockLogger(),
    });

    expect(typeof store.writeSnippet).toBe("function");
    expect(typeof store.writeOccurrence).toBe("function");
    expect(typeof store.searchByEmbedding).toBe("function");
    expect(typeof store.searchByFullText).toBe("function");
    expect(typeof store.close).toBe("function");
  });

  test("writeSnippet calls sql with content hash and embedding", async () => {
    const { sql, calls } = createMockSql();
    const store = createCodeSnippetStore({
      sql: sql as unknown as import("../db/client.ts").Sql,
      logger: createMockLogger(),
    });

    const embedding = new Float32Array([0.1, 0.2, 0.3]);
    await store.writeSnippet(
      {
        contentHash: "abc123",
        embeddedText: "test text",
        language: "typescript",
        embeddingModel: "voyage-code-3",
      },
      embedding,
    );

    expect(calls.length).toBe(1);
    // Verify the SQL contains ON CONFLICT for dedup
    expect(calls[0]!.query).toContain("ON CONFLICT");
    expect(calls[0]!.query).toContain("content_hash");
    expect(calls[0]!.query).toContain("DO NOTHING");
    // Verify values include the content hash
    expect(calls[0]!.values).toContain("abc123");
  });

  test("writeOccurrence calls sql with occurrence data", async () => {
    const { sql, calls } = createMockSql();
    const store = createCodeSnippetStore({
      sql: sql as unknown as import("../db/client.ts").Sql,
      logger: createMockLogger(),
    });

    await store.writeOccurrence({
      contentHash: "abc123",
      repo: "owner/repo",
      owner: "owner",
      prNumber: 42,
      prTitle: "Fix bug",
      filePath: "src/main.ts",
      startLine: 10,
      endLine: 15,
      functionContext: "function foo()",
    });

    expect(calls.length).toBe(1);
    expect(calls[0]!.query).toContain("code_snippet_occurrences");
    expect(calls[0]!.values).toContain("abc123");
    expect(calls[0]!.values).toContain("owner/repo");
    expect(calls[0]!.values).toContain(42);
  });

  test("close does not throw", () => {
    const { sql } = createMockSql();
    const store = createCodeSnippetStore({
      sql: sql as unknown as import("../db/client.ts").Sql,
      logger: createMockLogger(),
    });

    expect(() => store.close()).not.toThrow();
  });
});
