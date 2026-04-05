import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDbClient, type Sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { createReviewGraphStore } from "./store.ts";
import type { ReviewGraphStore } from "./types.ts";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
  level: "silent",
} as unknown as import("pino").Logger;

describe.skipIf(!TEST_DB_URL)("createReviewGraphStore", () => {
  let sql: Sql;
  let store: ReviewGraphStore;

  async function truncateAll(): Promise<void> {
    await sql`TRUNCATE
      review_graph_edges,
      review_graph_nodes,
      review_graph_files,
      review_graph_builds
      RESTART IDENTITY CASCADE`;
  }

  beforeAll(async () => {
    const client = createDbClient({
      connectionString: TEST_DB_URL!,
      logger: mockLogger,
    });
    sql = client.sql;
    await runMigrations(sql);
    store = createReviewGraphStore({ sql, logger: mockLogger });
  });

  afterAll(async () => {
    await sql.end();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  test("upsertBuild creates and updates durable build state counters", async () => {
    const first = await store.upsertBuild({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      commitSha: "abc123",
      status: "running",
      startedAt: "2026-04-04T12:00:00.000Z",
      filesIndexed: 2,
      filesFailed: 0,
      nodesWritten: 5,
      edgesWritten: 4,
    });

    expect(first.id).toBeGreaterThan(0);
    expect(first.status).toBe("running");
    expect(first.filesIndexed).toBe(2);
    expect(first.nodesWritten).toBe(5);

    const updated = await store.upsertBuild({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      commitSha: "def456",
      status: "completed",
      startedAt: "2026-04-04T12:00:00.000Z",
      completedAt: "2026-04-04T12:05:00.000Z",
      filesIndexed: 3,
      filesFailed: 1,
      nodesWritten: 9,
      edgesWritten: 7,
    });

    expect(updated.id).toBe(first.id);
    expect(updated.commitSha).toBe("def456");
    expect(updated.status).toBe("completed");
    expect(updated.filesIndexed).toBe(3);
    expect(updated.filesFailed).toBe(1);
    expect(updated.nodesWritten).toBe(9);
    expect(updated.edgesWritten).toBe(7);

    const persisted = await store.getBuild("owner/repo", "workspace-a");
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe("completed");
    expect(persisted!.completedAt).toBe("2026-04-04T12:05:00.000Z");
  });

  test("replaceFileGraph writes file, nodes, and edges for a file scope", async () => {
    const build = await store.upsertBuild({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      status: "running",
    });

    const result = await store.replaceFileGraph({
      file: {
        repo: "owner/repo",
        workspaceKey: "workspace-a",
        path: "src/app.py",
        language: "python",
        contentHash: "hash-v1",
        buildId: build.id,
      },
      nodes: [
        {
          nodeKind: "file",
          stableKey: "file:src/app.py",
          language: "python",
          attributes: { path: "src/app.py" },
        },
        {
          nodeKind: "symbol",
          stableKey: "symbol:src/app.py:handler",
          symbolName: "handler",
          qualifiedName: "app.handler",
          language: "python",
          spanStartLine: 10,
          spanStartCol: 1,
          spanEndLine: 15,
          spanEndCol: 10,
          signature: "def handler()",
          attributes: { kind: "function" },
          confidence: 1,
        },
        {
          nodeKind: "test",
          stableKey: "test:src/app.py:test_handler",
          symbolName: "test_handler",
          qualifiedName: "tests.test_handler",
          language: "python",
          attributes: { inferred: true },
          confidence: 0.6,
        },
      ],
      edges: [
        {
          edgeKind: "declares",
          sourceStableKey: "file:src/app.py",
          targetStableKey: "symbol:src/app.py:handler",
        },
        {
          edgeKind: "tests",
          sourceStableKey: "test:src/app.py:test_handler",
          targetStableKey: "symbol:src/app.py:handler",
          confidence: 0.6,
          attributes: { heuristic: "name-match" },
        },
      ],
    });

    expect(result.file.id).toBeGreaterThan(0);
    expect(result.nodesWritten).toBe(3);
    expect(result.edgesWritten).toBe(2);

    const nodes = await store.listNodesForFile(result.file.id);
    const edges = await store.listEdgesForFile(result.file.id);

    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    expect(nodes.map((node) => node.stableKey)).toEqual([
      "file:src/app.py",
      "symbol:src/app.py:handler",
      "test:src/app.py:test_handler",
    ]);
    expect(edges.map((edge) => edge.edgeKind)).toEqual(["declares", "tests"]);
    expect(edges[1]?.attributes).toEqual({ heuristic: "name-match" });
  });

  test("listWorkspaceGraph returns the workspace snapshot across files", async () => {
    const build = await store.upsertBuild({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      status: "running",
    });

    await store.replaceFileGraph({
      file: {
        repo: "owner/repo",
        workspaceKey: "workspace-a",
        path: "src/a.py",
        language: "python",
        buildId: build.id,
      },
      nodes: [
        { nodeKind: "file", stableKey: "file:src/a.py", language: "python" },
        { nodeKind: "symbol", stableKey: "symbol:src/a.py:run", symbolName: "run", qualifiedName: "run", language: "python" },
      ],
      edges: [
        { edgeKind: "declares", sourceStableKey: "file:src/a.py", targetStableKey: "symbol:src/a.py:run" },
      ],
    });

    await store.replaceFileGraph({
      file: {
        repo: "owner/repo",
        workspaceKey: "workspace-a",
        path: "tests/test_a.py",
        language: "python",
        buildId: build.id,
      },
      nodes: [
        { nodeKind: "file", stableKey: "file:tests/test_a.py", language: "python" },
      ],
      edges: [],
    });

    const snapshot = await store.listWorkspaceGraph("owner/repo", "workspace-a");
    expect(snapshot.files.map((file) => file.path)).toEqual(["src/a.py", "tests/test_a.py"]);
    expect(snapshot.nodes).toHaveLength(3);
    expect(snapshot.edges).toHaveLength(1);
  });

  test("replaceFileGraph atomically replaces prior file-scoped graph records without touching other files", async () => {
    const build = await store.upsertBuild({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      status: "running",
    });

    await store.replaceFileGraph({
      file: {
        repo: "owner/repo",
        workspaceKey: "workspace-a",
        path: "src/alpha.cpp",
        language: "cpp",
        contentHash: "alpha-v1",
        buildId: build.id,
      },
      nodes: [
        { nodeKind: "file", stableKey: "file:src/alpha.cpp", language: "cpp" },
        { nodeKind: "symbol", stableKey: "symbol:src/alpha.cpp:foo", symbolName: "foo", qualifiedName: "foo", language: "cpp" },
      ],
      edges: [
        { edgeKind: "declares", sourceStableKey: "file:src/alpha.cpp", targetStableKey: "symbol:src/alpha.cpp:foo" },
      ],
    });

    const other = await store.replaceFileGraph({
      file: {
        repo: "owner/repo",
        workspaceKey: "workspace-a",
        path: "src/beta.py",
        language: "python",
        contentHash: "beta-v1",
        buildId: build.id,
      },
      nodes: [
        { nodeKind: "file", stableKey: "file:src/beta.py", language: "python" },
      ],
      edges: [],
    });

    const firstWrite = await store.getFile("owner/repo", "workspace-a", "src/alpha.cpp");
    expect(firstWrite).not.toBeNull();
    const firstNodes = await store.listNodesForFile(firstWrite!.id);
    expect(firstNodes).toHaveLength(2);

    const replaced = await store.replaceFileGraph({
      file: {
        repo: "owner/repo",
        workspaceKey: "workspace-a",
        path: "src/alpha.cpp",
        language: "cpp",
        contentHash: "alpha-v2",
        buildId: build.id,
      },
      nodes: [
        { nodeKind: "file", stableKey: "file:src/alpha.cpp", language: "cpp" },
        { nodeKind: "symbol", stableKey: "symbol:src/alpha.cpp:bar", symbolName: "bar", qualifiedName: "bar", language: "cpp" },
        { nodeKind: "callsite", stableKey: "call:src/alpha.cpp:main->bar", language: "cpp", confidence: 0.8 },
      ],
      edges: [
        { edgeKind: "declares", sourceStableKey: "file:src/alpha.cpp", targetStableKey: "symbol:src/alpha.cpp:bar" },
        { edgeKind: "calls", sourceStableKey: "call:src/alpha.cpp:main->bar", targetStableKey: "symbol:src/alpha.cpp:bar", confidence: 0.8 },
      ],
    });

    expect(replaced.file.id).toBe(firstWrite!.id);
    expect(replaced.file.contentHash).toBe("alpha-v2");

    const replacedNodes = await store.listNodesForFile(replaced.file.id);
    const replacedEdges = await store.listEdgesForFile(replaced.file.id);
    const otherNodes = await store.listNodesForFile(other.file.id);

    expect(replacedNodes).toHaveLength(3);
    expect(replacedNodes.some((node) => node.stableKey === "symbol:src/alpha.cpp:foo")).toBe(false);
    expect(replacedNodes.some((node) => node.stableKey === "symbol:src/alpha.cpp:bar")).toBe(true);
    expect(replacedEdges).toHaveLength(2);
    expect(otherNodes).toHaveLength(1);
    expect(otherNodes[0]?.stableKey).toBe("file:src/beta.py");
  });

  test("replaceFileGraph fails when an edge references a missing node stable key", async () => {
    await expect(
      store.replaceFileGraph({
        file: {
          repo: "owner/repo",
          workspaceKey: "workspace-a",
          path: "src/broken.py",
          language: "python",
        },
        nodes: [
          { nodeKind: "file", stableKey: "file:src/broken.py", language: "python" },
        ],
        edges: [
          {
            edgeKind: "declares",
            sourceStableKey: "file:src/broken.py",
            targetStableKey: "symbol:src/broken.py:missing",
          },
        ],
      }),
    ).rejects.toThrow("endpoint stable keys were not inserted");

    const file = await store.getFile("owner/repo", "workspace-a", "src/broken.py");
    expect(file).toBeNull();
  });
});
