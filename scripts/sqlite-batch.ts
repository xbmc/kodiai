import type { Database } from "bun:sqlite";

export async function batchInsertFromSqliteQuery<T extends Record<string, unknown>>(
  db: Database,
  selectSql: string,
  batchSize: number,
  insertFn: (batch: T[]) => Promise<void>,
): Promise<number> {
  let total = 0;
  let batch: T[] = [];
  const statement = db.query(selectSql);
  try {
    async function flushBatch(): Promise<void> {
      await insertFn(batch);
      total += batch.length;
      batch = [];
    }

    for (const row of statement.iterate() as Iterable<T>) {
      batch.push(row);
      if (batch.length >= batchSize) {
        await flushBatch();
      }
    }

    if (batch.length > 0) {
      await flushBatch();
    }
  } finally {
    statement.finalize();
  }

  return total;
}
