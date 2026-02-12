import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { DEFAULT_KNOWLEDGE_DB_PATH, resolveKnowledgeDbPath } from "./db-path.ts";

describe("resolveKnowledgeDbPath", () => {
  test("uses KNOWLEDGE_DB_PATH before default path", () => {
    const runtimeDir = "/srv/kodiai-runtime";
    const resolved = resolveKnowledgeDbPath({
      env: { KNOWLEDGE_DB_PATH: "./runtime/kodiai-knowledge.db" },
      cwd: runtimeDir,
    });

    expect(resolved.source).toBe("env");
    expect(resolved.dbPath).toBe(resolve(runtimeDir, "./runtime/kodiai-knowledge.db"));
  });

  test("gives explicit --db override precedence over KNOWLEDGE_DB_PATH", () => {
    const resolved = resolveKnowledgeDbPath({
      dbPath: "./operator/override.db",
      env: { KNOWLEDGE_DB_PATH: "./runtime/from-env.db" },
      cwd: "/home/keith/src/kodiai",
    });

    expect(resolved.source).toBe("arg");
    expect(resolved.dbPath).toBe(resolve("/home/keith/src/kodiai", "./operator/override.db"));
  });

  test("returns stable absolute default path from caller cwd", () => {
    const resolved = resolveKnowledgeDbPath({ cwd: "/tmp/operator-session" });

    expect(resolved.source).toBe("default");
    expect(resolved.dbPath).toBe(join("/tmp/operator-session", DEFAULT_KNOWLEDGE_DB_PATH));
  });

  test("keeps runtime DB location when operator cwd differs", () => {
    const runtimeDb = "/var/lib/kodiai/data/kodiai-knowledge.db";

    const runtimeResolved = resolveKnowledgeDbPath({
      env: { KNOWLEDGE_DB_PATH: runtimeDb },
      cwd: "/srv/kodiai",
    });

    const operatorResolved = resolveKnowledgeDbPath({
      env: { KNOWLEDGE_DB_PATH: runtimeDb },
      cwd: "/home/keith/src/kodiai",
    });

    expect(runtimeResolved.dbPath).toBe(runtimeDb);
    expect(operatorResolved.dbPath).toBe(runtimeDb);
    expect(operatorResolved.source).toBe("env");
  });
});
