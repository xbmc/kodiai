import type { Sql } from "./client.ts";

export type JsonbRecordsetColumn = {
  name: string;
  type: string;
  selectExpression?: string;
};

export type JsonbRecordsetBatchInsertOptions<T> = {
  tableName: string;
  columns: readonly JsonbRecordsetColumn[];
  rows: readonly T[];
  batchSize: number;
  rowToRecord: (row: T) => Record<string, unknown>;
  onConflictClause?: string;
};

function chunked<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export async function insertJsonbRecordsetBatches<T>(
  sql: Sql,
  options: JsonbRecordsetBatchInsertOptions<T>,
): Promise<void> {
  if (options.rows.length === 0) return;

  const insertColumns = options.columns.map((column) => column.name).join(", ");
  const selectColumns = options.columns
    .map((column) => column.selectExpression ?? `batch_rows.${column.name}`)
    .join(",\n          ");
  const recordsetColumns = options.columns
    .map((column) => `${column.name} ${column.type}`)
    .join(",\n          ");

  for (const batch of chunked(options.rows, options.batchSize)) {
    const records = batch.map((row) => options.rowToRecord(row));
    await sql.unsafe(
      `
        INSERT INTO ${options.tableName} (
          ${insertColumns}
        )
        SELECT
          ${selectColumns}
        FROM jsonb_to_recordset($1::jsonb) AS batch_rows (
          ${recordsetColumns}
        )
        ${options.onConflictClause ?? ""}
      `,
      [JSON.stringify(records)],
    );
  }
}
