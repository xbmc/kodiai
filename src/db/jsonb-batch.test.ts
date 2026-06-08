import { describe, expect, test } from "bun:test";
import {
  buildJsonbRecordsetSource,
  executeJsonbRecordBatches,
} from "./jsonb-batch.ts";

describe("executeJsonbRecordBatches", () => {
  test("skips empty input", async () => {
    const results = await executeJsonbRecordBatches([], 2, (row) => row, async () => {
      throw new Error("should not execute empty batches");
    });

    expect(results).toEqual([]);
  });

  test("rejects invalid batch sizes", async () => {
    await expect(
      executeJsonbRecordBatches([{ id: 1 }], 0, (row) => row, async () => undefined),
    ).rejects.toThrow(
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

  test("executes each JSONB batch before serializing the next one", async () => {
    let serializedRows = 0;
    const serializedRowsAtExecution: number[] = [];

    await executeJsonbRecordBatches(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      2,
      (row) => {
        serializedRows += 1;
        return { value_id: row.id };
      },
      async () => {
        serializedRowsAtExecution.push(serializedRows);
      },
    );

    expect(serializedRowsAtExecution).toEqual([2, 3]);
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
