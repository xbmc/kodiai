import { describe, expect, test } from "bun:test";
import { buildJsonbRecordBatches } from "./jsonb-batch.ts";

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
});
