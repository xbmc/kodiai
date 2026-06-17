import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { batchInsertFromSqliteQuery } from "./sqlite-batch.ts";

describe("batchInsertFromSqliteQuery", () => {
  test("pages SQLite query results into bounded batches", async () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE rows (id INTEGER PRIMARY KEY, value TEXT)");
    for (let i = 1; i <= 5; i++) {
      db.run("INSERT INTO rows (id, value) VALUES (?, ?)", [i, `value-${i}`]);
    }

    const batches: number[][] = [];
    const count = await batchInsertFromSqliteQuery<{ id: number }>(
      db,
      "SELECT id FROM rows ORDER BY id",
      2,
      async (batch) => {
        batches.push(batch.map((row) => row.id));
      },
    );

    expect(count).toBe(5);
    expect(batches).toEqual([[1, 2], [3, 4], [5]]);
    db.close();
  });
});
