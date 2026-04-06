import { describe, test, expect } from "bun:test";
import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import { createKnowledgeRuntime } from "./runtime.ts";

function createSqlStub(): Sql {
  const sql = ((..._args: unknown[]) => Promise.resolve([])) as unknown as Sql & {
    array: Sql["array"];
  };
  sql.array = ((value: unknown[]) => ({ value })) as unknown as Sql["array"];
  return sql as Sql;
}

function createMockLogger(): {
  logger: Logger;
  infoCalls: unknown[][];
  warnCalls: unknown[][];
} {
  const infoCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];

  const logger = {
    info: (...args: unknown[]) => infoCalls.push(args),
    warn: (...args: unknown[]) => warnCalls.push(args),
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
    level: "silent",
  } as unknown as Logger;

  return { logger, infoCalls, warnCalls };
}

describe("createKnowledgeRuntime rerank wiring", () => {
  test("exposes rerank provider and logs the rerank model at startup", async () => {
    const { logger, infoCalls } = createMockLogger();

    const runtime = createKnowledgeRuntime({
      sql: createSqlStub(),
      logger,
      voyageApiKey: "",
    });

    expect(runtime.rerankProvider.model).toBe("rerank-2.5");
    expect(runtime.retriever).toBeDefined();
    expect(await runtime.rerankProvider.rerank({ query: "find docs", documents: ["doc one"] })).toBeNull();

    const rerankInitCall = infoCalls.find((call) => call[1] === "Rerank provider initialized");
    expect(rerankInitCall).toBeDefined();
    expect(rerankInitCall?.[0]).toMatchObject({ model: "rerank-2.5" });
  });
});
