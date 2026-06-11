import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { createWebhookQueueStore } from "./webhook-queue-store.ts";
import type { Sql } from "../db/client.ts";
import type { TelemetryStore } from "../telemetry/types.ts";

function createNoopLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => createNoopLogger(),
  } as unknown as Logger;
}

const noopTelemetryStore = {
  record: async () => undefined,
} as unknown as TelemetryStore;

type QueryLogEntry = { text: string; values: unknown[] };

/**
 * Fake postgres.js tagged-template client: records each query's text and
 * returns canned rows matched by substring.
 */
function createFakeSql(responses: Array<{ match: string; rows: Record<string, unknown>[] }>) {
  const queries: QueryLogEntry[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    const hit = responses.find((r) => text.includes(r.match));
    return Promise.resolve(hit?.rows ?? []);
  };
  const sqlWithBegin = Object.assign(run, {
    begin: async (cb: (tx: unknown) => Promise<unknown>) => cb(run),
  });
  return { sql: sqlWithBegin as unknown as Sql, queries };
}

describe("webhook queue store crash recovery", () => {
  test("dequeuePending resets stale 'processing' rows back to 'pending' before selecting", async () => {
    const { sql, queries } = createFakeSql([
      { match: "SET status = 'pending'", rows: [{ id: 7 }, { id: 9 }] },
      {
        match: "WHERE status = 'pending' ORDER BY",
        rows: [
          {
            id: 7,
            source: "github",
            delivery_id: "d-7",
            event_name: "issue_comment",
            headers: {},
            body: "{}",
            queued_at: new Date("2026-06-11T00:00:00Z"),
            processed_at: null,
            status: "pending",
          },
        ],
      },
    ]);

    const store = createWebhookQueueStore({ sql, logger: createNoopLogger(), telemetryStore: noopTelemetryStore });
    const entries = await store.dequeuePending();

    const recoveryQuery = queries.find((q) => q.text.includes("SET status = 'pending'"));
    expect(recoveryQuery).toBeDefined();
    expect(recoveryQuery!.text).toContain("WHERE status = 'processing'");
    expect(recoveryQuery!.text).toContain("INTERVAL '60 seconds'");

    const recoveryIndex = queries.findIndex((q) => q.text.includes("SET status = 'pending'"));
    const selectIndex = queries.findIndex((q) => q.text.includes("WHERE status = 'pending' ORDER BY"));
    expect(recoveryIndex).toBeGreaterThanOrEqual(0);
    expect(selectIndex).toBeGreaterThan(recoveryIndex);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.deliveryId).toBe("d-7");
  });

  test("dequeuePending stays quiet when no rows are stuck", async () => {
    const { sql, queries } = createFakeSql([]);
    const store = createWebhookQueueStore({ sql, logger: createNoopLogger(), telemetryStore: noopTelemetryStore });

    const entries = await store.dequeuePending();

    expect(entries).toEqual([]);
    // Recovery + select both ran inside the transaction even with nothing to do.
    expect(queries.some((q) => q.text.includes("WHERE status = 'processing'"))).toBeTrue();
  });
});
