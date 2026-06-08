export type JsonbRecordBatch<T> = {
  rows: readonly T[];
  json: string;
};

export type JsonbRecordsetColumn = readonly [name: string, type: string];

const SQL_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;
const JSONB_RECORDSET_TYPES = new Set([
  "bigint",
  "boolean",
  "integer",
  "jsonb",
  "real",
  "text",
  "timestamptz",
]);

function assertRecordsetIdentifier(value: string): void {
  if (!SQL_IDENTIFIER_RE.test(value)) {
    throw new Error(`Invalid JSONB recordset identifier: ${value}`);
  }
}

function assertRecordsetType(value: string): void {
  if (value !== value.trim() || /[\s;(),]/.test(value)) {
    throw new Error(`Invalid JSONB recordset type: ${value}`);
  }
  if (!JSONB_RECORDSET_TYPES.has(value)) {
    throw new Error(`Unsupported JSONB recordset type: ${value}`);
  }
}

function normalizeBatchSize(batchSize: number): number {
  const normalizedBatchSize = Math.floor(batchSize);
  if (!Number.isFinite(normalizedBatchSize) || normalizedBatchSize <= 0) {
    throw new Error(`Invalid JSONB recordset batch size: ${batchSize}`);
  }
  return normalizedBatchSize;
}

export function buildJsonbRecordsetSource(
  alias: string,
  columns: readonly JsonbRecordsetColumn[],
): string {
  assertRecordsetIdentifier(alias);
  if (columns.length === 0) {
    throw new Error("JSONB recordset requires at least one column");
  }

  const lines = columns.map(([name, type], index) => {
    assertRecordsetIdentifier(name);
    assertRecordsetType(type);
    const suffix = index === columns.length - 1 ? "" : ",";
    return `  ${name} ${type}${suffix}`;
  });

  return [
    `jsonb_to_recordset($1::jsonb) AS ${alias} (`,
    ...lines,
    ")",
  ].join("\n");
}

export async function executeJsonbRecordBatches<T, R>(
  rows: readonly T[],
  batchSize: number,
  rowToRecord: (row: T) => Record<string, unknown>,
  executeBatch: (batch: JsonbRecordBatch<T>) => Promise<R>,
): Promise<R[]> {
  if (rows.length === 0) return [];
  const normalizedBatchSize = normalizeBatchSize(batchSize);

  const results: R[] = [];
  for (let i = 0; i < rows.length; i += normalizedBatchSize) {
    const batchRows = rows.slice(i, i + normalizedBatchSize);
    const batch: JsonbRecordBatch<T> = {
      rows: batchRows,
      json: JSON.stringify(batchRows.map((row) => rowToRecord(row))),
    };
    results.push(await executeBatch(batch));
  }
  return results;
}
