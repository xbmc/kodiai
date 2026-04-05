import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type {
  ReplaceFileGraphInput,
  ReviewGraphBuildRecord,
  ReviewGraphBuildUpsert,
  ReviewGraphEdgeRecord,
  ReviewGraphFileRecord,
  ReviewGraphNodeRecord,
  ReviewGraphStore,
} from "./types.ts";

type DbRow = Record<string, unknown>;

type FileRow = DbRow & {
  id: number | string;
  repo: string;
  workspace_key: string;
  path: string;
  language: string;
  content_hash: string | null;
  indexed_at: string | Date;
  build_id: number | string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type NodeRow = DbRow & {
  id: number | string;
  repo: string;
  workspace_key: string;
  file_id: number | string;
  build_id: number | string | null;
  node_kind: string;
  stable_key: string;
  symbol_name: string | null;
  qualified_name: string | null;
  language: string;
  span_start_line: number | string | null;
  span_start_col: number | string | null;
  span_end_line: number | string | null;
  span_end_col: number | string | null;
  signature: string | null;
  attributes: unknown;
  confidence: number | string | null;
  created_at: string | Date;
};

type EdgeRow = DbRow & {
  id: number | string;
  repo: string;
  workspace_key: string;
  file_id: number | string;
  build_id: number | string | null;
  edge_kind: string;
  source_node_id: number | string;
  target_node_id: number | string;
  confidence: number | string | null;
  attributes: unknown;
  created_at: string | Date;
};

type BuildRow = DbRow & {
  id: number | string;
  repo: string;
  workspace_key: string;
  commit_sha: string | null;
  status: string;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  last_error: string | null;
  files_indexed: number | string;
  files_failed: number | string;
  nodes_written: number | string;
  edges_written: number | string;
  created_at: string | Date;
  updated_at: string | Date;
};

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.toISOString();
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function mapFileRow(row: FileRow): ReviewGraphFileRecord {
  return {
    id: Number(row.id),
    repo: row.repo,
    workspaceKey: row.workspace_key,
    path: row.path,
    language: row.language,
    contentHash: row.content_hash,
    indexedAt: toIso(row.indexed_at)!,
    buildId: row.build_id === null ? null : Number(row.build_id),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapNodeRow(row: NodeRow): ReviewGraphNodeRecord {
  return {
    id: Number(row.id),
    repo: row.repo,
    workspaceKey: row.workspace_key,
    fileId: Number(row.file_id),
    buildId: row.build_id === null ? null : Number(row.build_id),
    nodeKind: row.node_kind as ReviewGraphNodeRecord["nodeKind"],
    stableKey: row.stable_key,
    symbolName: row.symbol_name,
    qualifiedName: row.qualified_name,
    language: row.language,
    spanStartLine: row.span_start_line === null ? null : Number(row.span_start_line),
    spanStartCol: row.span_start_col === null ? null : Number(row.span_start_col),
    spanEndLine: row.span_end_line === null ? null : Number(row.span_end_line),
    spanEndCol: row.span_end_col === null ? null : Number(row.span_end_col),
    signature: row.signature,
    attributes: parseJsonObject(row.attributes),
    confidence: row.confidence === null ? null : Number(row.confidence),
    createdAt: toIso(row.created_at)!,
  };
}

function mapEdgeRow(row: EdgeRow): ReviewGraphEdgeRecord {
  return {
    id: Number(row.id),
    repo: row.repo,
    workspaceKey: row.workspace_key,
    fileId: Number(row.file_id),
    buildId: row.build_id === null ? null : Number(row.build_id),
    edgeKind: row.edge_kind as ReviewGraphEdgeRecord["edgeKind"],
    sourceNodeId: Number(row.source_node_id),
    targetNodeId: Number(row.target_node_id),
    confidence: row.confidence === null ? null : Number(row.confidence),
    attributes: parseJsonObject(row.attributes),
    createdAt: toIso(row.created_at)!,
  };
}

function mapBuildRow(row: BuildRow): ReviewGraphBuildRecord {
  return {
    id: Number(row.id),
    repo: row.repo,
    workspaceKey: row.workspace_key,
    commitSha: row.commit_sha,
    status: row.status as ReviewGraphBuildRecord["status"],
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
    lastError: row.last_error,
    filesIndexed: Number(row.files_indexed),
    filesFailed: Number(row.files_failed),
    nodesWritten: Number(row.nodes_written),
    edgesWritten: Number(row.edges_written),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export function createReviewGraphStore(opts: {
  sql: Sql;
  logger: Logger;
}): ReviewGraphStore {
  const { sql, logger } = opts;

  return {
    async upsertBuild(input: ReviewGraphBuildUpsert): Promise<ReviewGraphBuildRecord> {
      const rows = await sql`
        INSERT INTO review_graph_builds (
          repo,
          workspace_key,
          commit_sha,
          status,
          started_at,
          completed_at,
          last_error,
          files_indexed,
          files_failed,
          nodes_written,
          edges_written
        ) VALUES (
          ${input.repo},
          ${input.workspaceKey},
          ${input.commitSha ?? null},
          ${input.status},
          ${input.startedAt ? new Date(input.startedAt).toISOString() : null},
          ${input.completedAt ? new Date(input.completedAt).toISOString() : null},
          ${input.lastError ?? null},
          ${input.filesIndexed ?? 0},
          ${input.filesFailed ?? 0},
          ${input.nodesWritten ?? 0},
          ${input.edgesWritten ?? 0}
        )
        ON CONFLICT (repo, workspace_key)
        DO UPDATE SET
          commit_sha = EXCLUDED.commit_sha,
          status = EXCLUDED.status,
          started_at = EXCLUDED.started_at,
          completed_at = EXCLUDED.completed_at,
          last_error = EXCLUDED.last_error,
          files_indexed = EXCLUDED.files_indexed,
          files_failed = EXCLUDED.files_failed,
          nodes_written = EXCLUDED.nodes_written,
          edges_written = EXCLUDED.edges_written,
          updated_at = now()
        RETURNING *
      `;

      return mapBuildRow(rows[0] as unknown as BuildRow);
    },

    async replaceFileGraph(input: ReplaceFileGraphInput): Promise<{
      file: ReviewGraphFileRecord;
      nodesWritten: number;
      edgesWritten: number;
    }> {
      return await sql.begin(async (tx) => {
        const scoped = tx as unknown as Sql;
        const fileRows = await scoped`
          INSERT INTO review_graph_files (
            repo,
            workspace_key,
            path,
            language,
            content_hash,
            indexed_at,
            build_id
          ) VALUES (
            ${input.file.repo},
            ${input.file.workspaceKey},
            ${input.file.path},
            ${input.file.language},
            ${input.file.contentHash ?? null},
            now(),
            ${input.file.buildId ?? null}
          )
          ON CONFLICT (repo, workspace_key, path)
          DO UPDATE SET
            language = EXCLUDED.language,
            content_hash = EXCLUDED.content_hash,
            indexed_at = now(),
            build_id = EXCLUDED.build_id,
            updated_at = now()
          RETURNING *
        `;

        const file = mapFileRow(fileRows[0] as unknown as FileRow);

        await scoped`
          DELETE FROM review_graph_edges
          WHERE repo = ${input.file.repo}
            AND workspace_key = ${input.file.workspaceKey}
            AND file_id = ${file.id}
        `;

        await scoped`
          DELETE FROM review_graph_nodes
          WHERE repo = ${input.file.repo}
            AND workspace_key = ${input.file.workspaceKey}
            AND file_id = ${file.id}
        `;

        const nodeIdByStableKey = new Map<string, number>();
        for (const node of input.nodes) {
          const rows = await scoped`
            INSERT INTO review_graph_nodes (
              repo,
              workspace_key,
              file_id,
              build_id,
              node_kind,
              stable_key,
              symbol_name,
              qualified_name,
              language,
              span_start_line,
              span_start_col,
              span_end_line,
              span_end_col,
              signature,
              attributes,
              confidence
            ) VALUES (
              ${input.file.repo},
              ${input.file.workspaceKey},
              ${file.id},
              ${input.file.buildId ?? null},
              ${node.nodeKind},
              ${node.stableKey},
              ${node.symbolName ?? null},
              ${node.qualifiedName ?? null},
              ${node.language},
              ${node.spanStartLine ?? null},
              ${node.spanStartCol ?? null},
              ${node.spanEndLine ?? null},
              ${node.spanEndCol ?? null},
              ${node.signature ?? null},
              ${JSON.stringify(node.attributes ?? {})}::jsonb,
              ${node.confidence ?? null}
            )
            RETURNING id
          `;
          nodeIdByStableKey.set(node.stableKey, Number(rows[0]!.id));
        }

        let edgesWritten = 0;
        for (const edge of input.edges) {
          const sourceNodeId = nodeIdByStableKey.get(edge.sourceStableKey);
          const targetNodeId = nodeIdByStableKey.get(edge.targetStableKey);

          if (!sourceNodeId || !targetNodeId) {
            throw new Error(
              `Cannot write review graph edge '${edge.edgeKind}' for '${input.file.path}' because one or both endpoint stable keys were not inserted`,
            );
          }

          await scoped`
            INSERT INTO review_graph_edges (
              repo,
              workspace_key,
              file_id,
              build_id,
              edge_kind,
              source_node_id,
              target_node_id,
              confidence,
              attributes
            ) VALUES (
              ${input.file.repo},
              ${input.file.workspaceKey},
              ${file.id},
              ${input.file.buildId ?? null},
              ${edge.edgeKind},
              ${sourceNodeId},
              ${targetNodeId},
              ${edge.confidence ?? null},
              ${JSON.stringify(edge.attributes ?? {})}::jsonb
            )
          `;
          edgesWritten += 1;
        }

        logger.debug(
          {
            repo: input.file.repo,
            workspaceKey: input.file.workspaceKey,
            path: input.file.path,
            fileId: file.id,
            nodesWritten: input.nodes.length,
            edgesWritten,
            buildId: input.file.buildId ?? null,
          },
          "Replaced review graph records for file",
        );

        return {
          file,
          nodesWritten: input.nodes.length,
          edgesWritten,
        };
      });
    },

    async getFile(repo: string, workspaceKey: string, path: string): Promise<ReviewGraphFileRecord | null> {
      const rows = await sql`
        SELECT *
        FROM review_graph_files
        WHERE repo = ${repo}
          AND workspace_key = ${workspaceKey}
          AND path = ${path}
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return mapFileRow(rows[0] as unknown as FileRow);
    },

    async listNodesForFile(fileId: number): Promise<ReviewGraphNodeRecord[]> {
      const rows = await sql`
        SELECT *
        FROM review_graph_nodes
        WHERE file_id = ${fileId}
        ORDER BY id ASC
      `;
      return rows.map((row) => mapNodeRow(row as unknown as NodeRow));
    },

    async listEdgesForFile(fileId: number): Promise<ReviewGraphEdgeRecord[]> {
      const rows = await sql`
        SELECT *
        FROM review_graph_edges
        WHERE file_id = ${fileId}
        ORDER BY id ASC
      `;
      return rows.map((row) => mapEdgeRow(row as unknown as EdgeRow));
    },

    async getBuild(repo: string, workspaceKey: string): Promise<ReviewGraphBuildRecord | null> {
      const rows = await sql`
        SELECT *
        FROM review_graph_builds
        WHERE repo = ${repo}
          AND workspace_key = ${workspaceKey}
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return mapBuildRow(rows[0] as unknown as BuildRow);
    },
  };
}
