import { describe, expect, test } from "bun:test";
import { resolveKnowledgeDbPath } from "./db-path.ts";

describe("resolveKnowledgeDbPath (deprecated - PostgreSQL migration)", () => {
  test("returns DATABASE_URL when set", () => {
    const resolved = resolveKnowledgeDbPath({
      env: { DATABASE_URL: "postgresql://kodiai:kodiai@localhost:5432/kodiai" },
    });

    expect(resolved.source).toBe("env");
    expect(resolved.dbPath).toBe("postgresql://kodiai:kodiai@localhost:5432/kodiai");
  });

  test("falls back to KNOWLEDGE_DB_PATH when DATABASE_URL not set", () => {
    const resolved = resolveKnowledgeDbPath({
      env: { KNOWLEDGE_DB_PATH: "./data/legacy.db" },
    });

    expect(resolved.source).toBe("env");
    expect(resolved.dbPath).toBe("./data/legacy.db");
  });

  test("returns default path when no env vars set", () => {
    const resolved = resolveKnowledgeDbPath({ env: {} });

    expect(resolved.source).toBe("default");
    expect(resolved.dbPath).toBe("./data/kodiai-knowledge.db");
  });
});
