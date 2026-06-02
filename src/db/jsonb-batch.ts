import type { Sql } from "./client.ts";

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/i;
const TYPE_RE = /^[a-z0-9_]+(?:\[\])?(?:\s*\([^)]*\))?$/i;
const SAFE_FRAGMENT_RE = /^[\s\w.(),:'"*+\-=/<>[\]${}]+$/;

export type JsonbRecordsetColumn = {
  name: string;
  type: string;
  selectExpression?: string;
};

export type JsonbRecordsetStaticColumn = {
  name: string;
  selectExpression: string;
};

export type JsonbRecordsetBatchInsertOptions<T> = {
  tableName: string;
  staticColumns?: readonly JsonbRecordsetStaticColumn[];
  columns: readonly JsonbRecordsetColumn[];
  rows: readonly T[];
  batchSize: number;
  rowToRecord: (row: T) => Record<string, unknown>;
  onConflictClause?: string;
  returningClause?: string;
  params?: readonly unknown[];
};

function chunked<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function assertSqlFragment(value: string, label: string): void {
  if (!SAFE_FRAGMENT_RE.test(value) || value.includes(";") || value.includes("--") || value.includes("/*")) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function validateOptions<T>(options: JsonbRecordsetBatchInsertOptions<T>): void {
  assertIdentifier(options.tableName, "table name");
  for (const column of options.staticColumns ?? []) {
    assertIdentifier(column.name, "static column name");
    assertSqlFragment(column.selectExpression, `static select expression for ${column.name}`);
  }
  for (const column of options.columns) {
    assertIdentifier(column.name, "recordset column name");
    if (!TYPE_RE.test(column.type) || column.type.includes(";")) {
      throw new Error(`Invalid recordset column type for ${column.name}: ${column.type}`);
    }
    if (column.selectExpression) {
      assertSqlFragment(column.selectExpression, `select expression for ${column.name}`);
    }
  }
  if (options.onConflictClause) {
    assertSqlFragment(options.onConflictClause, "conflict clause");
  }
  if (options.returningClause) {
    assertSqlFragment(options.returningClause, "returning clause");
  }
}

export async function insertJsonbRecordsetBatches<T>(
  sql: Sql,
  options: JsonbRecordsetBatchInsertOptions<T>,
): Promise<unknown[]> {
  if (options.rows.length === 0) return [];
  const batchSize = Math.floor(options.batchSize);
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error(`Invalid JSONB recordset batch size: ${options.batchSize}`);
  }
  validateOptions(options);

  const insertColumns = [
    ...(options.staticColumns ?? []).map((column) => column.name),
    ...options.columns.map((column) => column.name),
  ].join(", ");
  const selectColumns = [
    ...(options.staticColumns ?? []).map((column) => column.selectExpression),
    ...options.columns.map((column) => column.selectExpression ?? `batch_rows.${column.name}`),
  ]
    .join(",\n          ");
  const recordsetColumns = options.columns
    .map((column) => `${column.name} ${column.type}`)
    .join(",\n          ");
  const returnedRows: unknown[] = [];

  for (const batch of chunked(options.rows, batchSize)) {
    const records = batch.map((row) => options.rowToRecord(row));
    const queryParams = [
      JSON.stringify(records),
      ...(options.params ?? []),
    ] as Parameters<Sql["unsafe"]>[1];
    const rows = await sql.unsafe(
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
        ${options.returningClause ?? ""}
      `,
      queryParams,
    );
    returnedRows.push(...rows);
  }

  return returnedRows;
}
