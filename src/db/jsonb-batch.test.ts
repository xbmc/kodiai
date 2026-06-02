import { describe, expect, test } from "bun:test";
import type { Sql } from "./client.ts";
import { insertJsonbRecordsetBatches } from "./jsonb-batch.ts";

function createMockSql() {
  const unsafeCalls: Array<{ query: string; values: unknown[] }> = [];
  const sql = (() => Promise.resolve([])) as unknown as Sql & {
    unsafeCalls: typeof unsafeCalls;
  };

  sql.unsafe = ((query: string, values: unknown[]) => {
    unsafeCalls.push({ query, values });
    return Promise.resolve([{ ok: true }]);
  }) as unknown as Sql["unsafe"];
  sql.unsafeCalls = unsafeCalls;
  return sql;
}

describe("insertJsonbRecordsetBatches", () => {
  test("builds chunked jsonb recordset inserts with configured columns", async () => {
    const sql = createMockSql();

    const returnedRows = await insertJsonbRecordsetBatches(sql, {
      tableName: "example_table",
      staticColumns: [{ name: "repo", selectExpression: "$2" }],
      columns: [
        { name: "id", type: "integer" },
        { name: "embedding", type: "text", selectExpression: "batch_rows.embedding::vector" },
      ],
      rows: [{ id: 1, embedding: "[1,2]" }, { id: 2, embedding: "[3,4]" }, { id: 3, embedding: "[5,6]" }],
      batchSize: 2,
      rowToRecord: (row) => row,
      onConflictClause: "ON CONFLICT (id) DO NOTHING",
      params: ["owner/repo"],
    });

    expect(sql.unsafeCalls).toHaveLength(2);
    expect(sql.unsafeCalls[0]!.query).toContain("INSERT INTO example_table");
    expect(sql.unsafeCalls[0]!.query).toContain("$2");
    expect(sql.unsafeCalls[0]!.query).toContain("batch_rows.embedding::vector");
    expect(sql.unsafeCalls[0]!.query).toContain("jsonb_to_recordset($1::jsonb)");
    expect(sql.unsafeCalls[0]!.query).toContain("ON CONFLICT (id) DO NOTHING");
    expect(returnedRows).toEqual([{ ok: true }, { ok: true }]);
    expect(JSON.parse(sql.unsafeCalls[0]!.values[0] as string)).toEqual([
      { id: 1, embedding: "[1,2]" },
      { id: 2, embedding: "[3,4]" },
    ]);
    expect(sql.unsafeCalls[0]!.values[1]).toBe("owner/repo");
    expect(JSON.parse(sql.unsafeCalls[1]!.values[0] as string)).toEqual([
      { id: 3, embedding: "[5,6]" },
    ]);
  });

  test("skips empty input without issuing unsafe SQL", async () => {
    const sql = createMockSql();

    await insertJsonbRecordsetBatches(sql, {
      tableName: "example_table",
      columns: [{ name: "id", type: "integer" }],
      rows: [],
      batchSize: 2,
      rowToRecord: (row) => row,
    });

    expect(sql.unsafeCalls).toHaveLength(0);
  });

  test("rejects invalid batch sizes before issuing unsafe SQL", async () => {
    const sql = createMockSql();

    await expect(insertJsonbRecordsetBatches(sql, {
      tableName: "example_table",
      columns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
      batchSize: 0,
      rowToRecord: (row) => row,
    })).rejects.toThrow("Invalid JSONB recordset batch size");

    expect(sql.unsafeCalls).toHaveLength(0);
  });

  test("rejects unsafe SQL fragments before issuing unsafe SQL", async () => {
    const sql = createMockSql();

    await expect(insertJsonbRecordsetBatches(sql, {
      tableName: "example_table; DROP TABLE findings",
      columns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
      batchSize: 1,
      rowToRecord: (row) => row,
    })).rejects.toThrow("Invalid table name");

    await expect(insertJsonbRecordsetBatches(sql, {
      tableName: "example_table",
      columns: [{ name: "id", type: "integer", selectExpression: "batch_rows.id; DROP TABLE findings" }],
      rows: [{ id: 1 }],
      batchSize: 1,
      rowToRecord: (row) => row,
    })).rejects.toThrow("Invalid select expression");

    expect(sql.unsafeCalls).toHaveLength(0);
  });
});
