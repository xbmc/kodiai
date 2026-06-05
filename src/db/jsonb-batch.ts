export type JsonbRecordBatch<T> = {
  rows: readonly T[];
  json: string;
};

export function buildJsonbRecordBatches<T>(
  rows: readonly T[],
  batchSize: number,
  rowToRecord: (row: T) => Record<string, unknown>,
): JsonbRecordBatch<T>[] {
  if (rows.length === 0) return [];
  const normalizedBatchSize = Math.floor(batchSize);
  if (!Number.isFinite(normalizedBatchSize) || normalizedBatchSize <= 0) {
    throw new Error(`Invalid JSONB recordset batch size: ${batchSize}`);
  }

  const batches: JsonbRecordBatch<T>[] = [];
  for (let i = 0; i < rows.length; i += normalizedBatchSize) {
    const batchRows = rows.slice(i, i + normalizedBatchSize);
    batches.push({
      rows: batchRows,
      json: JSON.stringify(batchRows.map((row) => rowToRecord(row))),
    });
  }
  return batches;
}
