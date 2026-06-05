import { describe, expect, test } from "bun:test";
import { createContributorProfileStore } from "./profile-store.ts";

function createMockLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => createMockLogger(),
  } as unknown as import("pino").Logger;
}

function createRetryOnceSql() {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  let attempts = 0;
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join("?"), values });
    attempts++;
    if (attempts === 1) {
      const err = new Error(
        "write CONNECTION_ENDED kodiai-pg.postgres.database.azure.com:5432",
      );
      Object.assign(err, { code: "CONNECTION_ENDED" });
      return Promise.reject(err);
    }
    return Promise.resolve(Object.assign([], { count: 1 }));
  };
  return { sql, calls };
}

describe("createContributorProfileStore transient retries", () => {
  test("upsertExpertise retries transient connection-ended writes", async () => {
    const { sql, calls } = createRetryOnceSql();
    const store = createContributorProfileStore({
      sql: sql as unknown as import("../db/client.ts").Sql,
      logger: createMockLogger(),
    });

    await store.upsertExpertise({
      profileId: 123,
      dimension: "language",
      topic: "typescript",
      score: 0.75,
      rawSignals: 4,
      lastActive: new Date("2026-01-01T00:00:00Z"),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.query).toContain("contributor_expertise");
  });

  test("updateTier retries transient connection-ended writes", async () => {
    const { sql, calls } = createRetryOnceSql();
    const store = createContributorProfileStore({
      sql: sql as unknown as import("../db/client.ts").Sql,
      logger: createMockLogger(),
    });

    await store.updateTier(123, "trusted", 0.83);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.query).toContain("contributor_profiles");
  });
});
