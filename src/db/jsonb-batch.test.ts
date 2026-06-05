import { describe, expect, test } from "bun:test";
import {
  buildJsonbRecordBatches,
  buildJsonbRecordsetSource,
  executeJsonbRecordBatches,
} from "./jsonb-batch.ts";

describe("buildJsonbRecordBatches", () => {
  test("builds JSONB payloads in bounded chunks", () => {
    const batches = buildJsonbRecordBatches(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      2,
      (row) => ({ value_id: row.id }),
    );

    expect(batches).toHaveLength(2);
    expect(batches[0]!.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(JSON.parse(batches[0]!.json)).toEqual([
      { value_id: 1 },
      { value_id: 2 },
    ]);
    expect(JSON.parse(batches[1]!.json)).toEqual([{ value_id: 3 }]);
  });

  test("skips empty input", () => {
    expect(buildJsonbRecordBatches([], 2, (row) => row)).toEqual([]);
  });

  test("rejects invalid batch sizes", () => {
    expect(() => buildJsonbRecordBatches([{ id: 1 }], 0, (row) => row)).toThrow(
      "Invalid JSONB recordset batch size",
    );
  });

  test("executes JSONB batches through one canonical loop", async () => {
    const seen: unknown[] = [];

    const results = await executeJsonbRecordBatches(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      2,
      (row) => ({ value_id: row.id }),
      async (batch) => {
        seen.push(JSON.parse(batch.json));
        return batch.rows.length;
      },
    );

    expect(results).toEqual([2, 1]);
    expect(seen).toEqual([
      [{ value_id: 1 }, { value_id: 2 }],
      [{ value_id: 3 }],
    ]);
  });

  test("builds recordset source SQL from named column definitions", () => {
    const source = buildJsonbRecordsetSource("batch_rows", [
      ["review_id", "integer"],
      ["comment_id", "bigint"],
      ["created_at", "timestamptz"],
    ]);

    expect(source).toBe([
      "jsonb_to_recordset($1::jsonb) AS batch_rows (",
      "  review_id integer,",
      "  comment_id bigint,",
      "  created_at timestamptz",
      ")",
    ].join("\n"));
  });

  test("rejects unsafe recordset identifiers and types", () => {
    expect(() => buildJsonbRecordsetSource("batch rows", [["id", "integer"]])).toThrow(
      "Invalid JSONB recordset identifier",
    );
    expect(() => buildJsonbRecordsetSource("batch_rows", [["bad-name", "integer"]])).toThrow(
      "Invalid JSONB recordset identifier",
    );
    expect(() => buildJsonbRecordsetSource("batch_rows", [["id", "integer; drop table"]])).toThrow(
      "Invalid JSONB recordset type",
    );
    expect(() => buildJsonbRecordsetSource("batch_rows", [["id", "money"]])).toThrow(
      "Unsupported JSONB recordset type",
    );
  });
});
