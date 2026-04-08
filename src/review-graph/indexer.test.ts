import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createReviewGraphIndexer, getLanguageForPath } from "./indexer.ts";
import type {
  ReplaceFileGraphInput,
  ReviewGraphBuildRecord,
  ReviewGraphBuildUpsert,
  ReviewGraphEdgeRecord,
  ReviewGraphFileRecord,
  ReviewGraphNodeRecord,
  ReviewGraphStore,
} from "./types.ts";

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

const workspaceDirs: string[] = [];

async function createWorkspaceFixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "kodiai-review-graph-indexer-"));
  workspaceDirs.push(dir);

  for (const [repoPath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, repoPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return dir;
}

afterEach(async () => {
  while (workspaceDirs.length > 0) {
    const dir = workspaceDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

class InMemoryReviewGraphStore implements ReviewGraphStore {
  private nextBuildId = 1;
  private nextFileId = 1;
  private nextNodeId = 1;
  private nextEdgeId = 1;

  private builds = new Map<string, ReviewGraphBuildRecord>();
  private files = new Map<string, ReviewGraphFileRecord>();
  private nodesByFileId = new Map<number, ReviewGraphNodeRecord[]>();
  private edgesByFileId = new Map<number, ReviewGraphEdgeRecord[]>();

  async upsertBuild(input: ReviewGraphBuildUpsert): Promise<ReviewGraphBuildRecord> {
    const key = `${input.repo}::${input.workspaceKey}`;
    const existing = this.builds.get(key);
    const now = new Date().toISOString();

    const build: ReviewGraphBuildRecord = {
      id: existing?.id ?? this.nextBuildId++,
      repo: input.repo,
      workspaceKey: input.workspaceKey,
      commitSha: input.commitSha ?? null,
      status: input.status,
      startedAt: input.startedAt ? new Date(input.startedAt).toISOString() : existing?.startedAt ?? null,
      completedAt: input.completedAt ? new Date(input.completedAt).toISOString() : null,
      lastError: input.lastError ?? null,
      filesIndexed: input.filesIndexed ?? 0,
      filesFailed: input.filesFailed ?? 0,
      nodesWritten: input.nodesWritten ?? 0,
      edgesWritten: input.edgesWritten ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.builds.set(key, build);
    return build;
  }

  async replaceFileGraph(input: ReplaceFileGraphInput): Promise<{
    file: ReviewGraphFileRecord;
    nodesWritten: number;
    edgesWritten: number;
  }> {
    const fileKey = `${input.file.repo}::${input.file.workspaceKey}::${input.file.path}`;
    const existing = this.files.get(fileKey);
    const now = new Date().toISOString();
    const fileId = existing?.id ?? this.nextFileId++;

    const file: ReviewGraphFileRecord = {
      id: fileId,
      repo: input.file.repo,
      workspaceKey: input.file.workspaceKey,
      path: input.file.path,
      language: input.file.language,
      contentHash: input.file.contentHash ?? null,
      indexedAt: now,
      buildId: input.file.buildId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const nodeIdByStableKey = new Map<string, number>();
    const nodes: ReviewGraphNodeRecord[] = input.nodes.map((node) => {
      const id = this.nextNodeId++;
      nodeIdByStableKey.set(node.stableKey, id);
      return {
        id,
        repo: input.file.repo,
        workspaceKey: input.file.workspaceKey,
        fileId,
        buildId: input.file.buildId ?? null,
        nodeKind: node.nodeKind,
        stableKey: node.stableKey,
        symbolName: node.symbolName ?? null,
        qualifiedName: node.qualifiedName ?? null,
        language: node.language,
        spanStartLine: node.spanStartLine ?? null,
        spanStartCol: node.spanStartCol ?? null,
        spanEndLine: node.spanEndLine ?? null,
        spanEndCol: node.spanEndCol ?? null,
        signature: node.signature ?? null,
        attributes: node.attributes ?? {},
        confidence: node.confidence ?? null,
        createdAt: now,
      };
    });

    const edges: ReviewGraphEdgeRecord[] = input.edges.map((edge) => {
      const sourceNodeId = nodeIdByStableKey.get(edge.sourceStableKey);
      const targetNodeId = nodeIdByStableKey.get(edge.targetStableKey);
      if (!sourceNodeId || !targetNodeId) {
        throw new Error("Cannot write review graph edge because endpoint stable keys were not inserted");
      }
      return {
        id: this.nextEdgeId++,
        repo: input.file.repo,
        workspaceKey: input.file.workspaceKey,
        fileId,
        buildId: input.file.buildId ?? null,
        edgeKind: edge.edgeKind,
        sourceNodeId,
        targetNodeId,
        confidence: edge.confidence ?? null,
        attributes: edge.attributes ?? {},
        createdAt: now,
      };
    });

    this.files.set(fileKey, file);
    this.nodesByFileId.set(fileId, nodes);
    this.edgesByFileId.set(fileId, edges);

    return {
      file,
      nodesWritten: nodes.length,
      edgesWritten: edges.length,
    };
  }

  async getFile(repo: string, workspaceKey: string, pathValue: string): Promise<ReviewGraphFileRecord | null> {
    return this.files.get(`${repo}::${workspaceKey}::${pathValue}`) ?? null;
  }

  async listNodesForFile(fileId: number): Promise<ReviewGraphNodeRecord[]> {
    return this.nodesByFileId.get(fileId) ?? [];
  }

  async listEdgesForFile(fileId: number): Promise<ReviewGraphEdgeRecord[]> {
    return this.edgesByFileId.get(fileId) ?? [];
  }

  async listWorkspaceGraph(repo: string, workspaceKey: string) {
    const files = Array.from(this.files.values())
      .filter((file) => file.repo === repo && file.workspaceKey === workspaceKey)
      .sort((a, b) => a.path.localeCompare(b.path));
    const fileIds = new Set(files.map((file) => file.id));
    const nodes = Array.from(this.nodesByFileId.entries())
      .filter(([fileId]) => fileIds.has(fileId))
      .flatMap(([, fileNodes]) => fileNodes)
      .sort((a, b) => a.id - b.id);
    const edges = Array.from(this.edgesByFileId.entries())
      .filter(([fileId]) => fileIds.has(fileId))
      .flatMap(([, fileEdges]) => fileEdges)
      .sort((a, b) => a.id - b.id);

    return { files, nodes, edges };
  }

  async getBuild(repo: string, workspaceKey: string): Promise<ReviewGraphBuildRecord | null> {
    return this.builds.get(`${repo}::${workspaceKey}`) ?? null;
  }
}

describe("createReviewGraphIndexer", () => {
  test("indexes only supported graph languages from a workspace and records counts", async () => {
    const store = new InMemoryReviewGraphStore();
    const workspaceDir = await createWorkspaceFixture({
      "src/service.py": `def helper(value):\n    return value\n\ndef run():\n    return helper(1)\n`,
      "src/service_test.cpp": `#include \"service.h\"\n\nvoid helper() {}\nvoid ServiceTest_runs_helper() { helper(); }\n`,
      "README.md": "ignore me\n",
    });

    const indexer = createReviewGraphIndexer({ store, logger: mockLogger });
    const result = await indexer.indexWorkspace({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      workspaceDir,
      commitSha: "abc123",
    });

    expect(result.metrics.discovered).toBe(2);
    expect(result.metrics.indexed).toBe(2);
    expect(result.metrics.updated).toBe(0);
    expect(result.metrics.skipped).toBe(0);
    expect(result.metrics.failed).toBe(0);
    expect(result.files.indexed).toEqual(["src/service_test.cpp", "src/service.py"]);
    expect(result.files.skipped).toEqual([]);
    expect(result.build.status).toBe("completed");
    expect(result.build.filesIndexed).toBe(2);
    expect(result.build.filesFailed).toBe(0);
    expect(result.build.nodesWritten).toBeGreaterThan(0);
    expect(result.build.edgesWritten).toBeGreaterThan(0);

    const pythonFile = await store.getFile("owner/repo", "workspace-a", "src/service.py");
    expect(pythonFile?.contentHash).toBeTruthy();
    const pythonNodes = await store.listNodesForFile(pythonFile!.id);
    expect(pythonNodes.some((node) => node.nodeKind === "symbol" && node.qualifiedName === "helper")).toBe(true);
  });

  test("skips unchanged files and reindexes only changed paths incrementally", async () => {
    const store = new InMemoryReviewGraphStore();
    const workspaceDir = await createWorkspaceFixture({
      "src/service.py": `def helper(value):\n    return value\n\ndef run():\n    return helper(1)\n`,
      "src/worker.cpp": `void helper() {}\nvoid runWorker() { helper(); }\n`,
    });

    const indexer = createReviewGraphIndexer({ store, logger: mockLogger });

    const first = await indexer.indexWorkspace({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      workspaceDir,
      commitSha: "sha-1",
    });
    expect(first.metrics.indexed).toBe(2);

    await writeFile(
      path.join(workspaceDir, "src/service.py"),
      `def helper(value):\n    return value * 2\n\ndef run():\n    return helper(2)\n`,
      "utf8",
    );

    const second = await indexer.indexWorkspace({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      workspaceDir,
      commitSha: "sha-2",
      changedPaths: ["src/service.py", "src/worker.cpp", "README.md"],
    });

    expect(second.metrics.discovered).toBe(2);
    expect(second.metrics.indexed).toBe(1);
    expect(second.metrics.updated).toBe(1);
    expect(second.metrics.skipped).toBe(1);
    expect(second.metrics.failed).toBe(0);
    expect(second.files.updated).toEqual(["src/service.py"]);
    expect(second.files.skipped).toEqual(["src/worker.cpp"]);
    expect(second.files.indexed).toEqual([]);
    expect(second.build.commitSha).toBe("sha-2");
    expect(second.build.filesIndexed).toBe(1);

    const pythonFile = await store.getFile("owner/repo", "workspace-a", "src/service.py");
    const cppFile = await store.getFile("owner/repo", "workspace-a", "src/worker.cpp");
    expect(pythonFile?.buildId).toBe(second.build.id);
    expect(cppFile?.buildId).toBe(first.build.id);
  });

  test("records per-file failures without requiring a full rebuild", async () => {
    const store = new InMemoryReviewGraphStore();
    const workspaceDir = await createWorkspaceFixture({
      "src/service.py": `def helper(value):\n    return value\n`,
      "src/worker.cpp": `void helper() {}\nvoid runWorker() { helper(); }\n`,
    });

    const failingIndexer = createReviewGraphIndexer({
      store,
      logger: mockLogger,
      readWorkspaceFile: async (absolutePath) => {
        if (absolutePath.endsWith("worker.cpp")) {
          throw new Error("simulated read failure");
        }
        return await Bun.file(absolutePath).text();
      },
    });

    const result = await failingIndexer.indexWorkspace({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      workspaceDir,
      commitSha: "sha-3",
    });

    expect(result.metrics.discovered).toBe(2);
    expect(result.metrics.indexed).toBe(1);
    expect(result.metrics.failed).toBe(1);
    expect(result.files.failed).toEqual([{ path: "src/worker.cpp", error: "simulated read failure" }]);
    expect(result.build.status).toBe("failed");
    expect(result.build.lastError).toBe("simulated read failure");

    const pythonFile = await store.getFile("owner/repo", "workspace-a", "src/service.py");
    const cppFile = await store.getFile("owner/repo", "workspace-a", "src/worker.cpp");
    expect(pythonFile).not.toBeNull();
    expect(cppFile).toBeNull();
  });
});

describe("getLanguageForPath", () => {
  test("maps python and cpp-family extensions", () => {
    expect(getLanguageForPath("src/app.py")).toBe("python");
    expect(getLanguageForPath("include/service.hpp")).toBe("cpp");
    expect(getLanguageForPath("README.md")).toBeNull();
  });
});
