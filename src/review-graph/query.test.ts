import { describe, expect, test } from "bun:test";
import { createReviewGraphIndexer } from "./indexer.ts";
import { createReviewGraphQuery } from "./query.ts";
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

  async replaceFileGraph(input: ReplaceFileGraphInput): Promise<{ file: ReviewGraphFileRecord; nodesWritten: number; edgesWritten: number }> {
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

    return { file, nodesWritten: nodes.length, edgesWritten: edges.length };
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

describe("createReviewGraphQuery", () => {
  test("ranks python blast radius dependents and likely tests above weaker neighbors", async () => {
    const store = new InMemoryReviewGraphStore();
    const indexer = createReviewGraphIndexer({
      store,
      logger: mockLogger,
      walkWorkspace: async () => [
        "src/service.py",
        "src/controller.py",
        "src/cli.py",
        "tests/test_service.py",
      ],
      readWorkspaceFile: async (absolutePath) => {
        const repoPath = absolutePath.replace(/^.*?(src\/|tests\/)/, "$1");
        const fixtures: Record<string, string> = {
          "src/service.py": `def helper(value):\n    return value * 2\n\ndef run():\n    return helper(3)\n`,
          "src/controller.py": `from src.service import helper\n\ndef execute():\n    return helper(1)\n`,
          "src/cli.py": `from src.service import run\n\ndef main():\n    return run()\n`,
          "tests/test_service.py": `from src.service import helper\n\ndef test_helper_doubles():\n    assert helper(2) == 4\n`,
        };
        const content = fixtures[repoPath];
        if (!content) throw new Error(`missing fixture for ${repoPath}`);
        return content;
      },
    });

    await indexer.indexWorkspace({
      repo: "owner/repo",
      workspaceKey: "workspace-py",
      workspaceDir: "/virtual/workspace",
    });

    const query = createReviewGraphQuery({ store });
    const result = await query.queryBlastRadius({
      repo: "owner/repo",
      workspaceKey: "workspace-py",
      changedPaths: ["src/service.py"],
    });

    expect(result.graphStats.changedFilesFound).toBe(1);
    expect(result.seedSymbols.some((symbol) => symbol.qualifiedName === "helper")).toBe(true);
    expect(result.impactedFiles[0]?.path).toBe("tests/test_service.py");
    expect(result.impactedFiles.map((file) => file.path)).toContain("src/controller.py");
    expect(result.probableDependents.some((item) => item.filePath === "src/controller.py" && item.qualifiedName === "execute")).toBe(true);
    expect(result.likelyTests[0]?.path).toBe("tests/test_service.py");
    expect(result.likelyTests[0]?.testSymbols).toContain("test_helper_doubles");
    expect(result.likelyTests[0]!.reasons.some((reason) => reason.includes("helper"))).toBe(true);
    expect(result.likelyTests[0]?.confidence).toBeGreaterThan(0.9);
  });

  test("returns graph-ranked C++ impacted files and test candidates for changed symbols", async () => {
    const store = new InMemoryReviewGraphStore();
    const indexer = createReviewGraphIndexer({
      store,
      logger: mockLogger,
      walkWorkspace: async () => [
        "src/service.cpp",
        "src/controller.cpp",
        "src/view.cpp",
        "tests/service_test.cpp",
      ],
      readWorkspaceFile: async (absolutePath) => {
        const repoPath = absolutePath.replace(/^.*?(src\/|tests\/)/, "$1");
        const fixtures: Record<string, string> = {
          "src/service.cpp": `int helper() { return 1; }\nint runService() { return helper(); }\n`,
          "src/controller.cpp": `int helper();\nint executeController() { return helper(); }\n`,
          "src/view.cpp": `int runService();\nint paintView() { return runService(); }\n`,
          "tests/service_test.cpp": `int helper();\nvoid ServiceTest_runs_helper() { helper(); }\n`,
        };
        const content = fixtures[repoPath];
        if (!content) throw new Error(`missing fixture for ${repoPath}`);
        return content;
      },
    });

    await indexer.indexWorkspace({
      repo: "owner/repo",
      workspaceKey: "workspace-cpp",
      workspaceDir: "/virtual/workspace",
    });

    const query = createReviewGraphQuery({ store });
    const result = await query.queryBlastRadius({
      repo: "owner/repo",
      workspaceKey: "workspace-cpp",
      changedPaths: ["src/service.cpp"],
    });

    expect(result.seedSymbols.some((symbol) => symbol.qualifiedName === "helper")).toBe(true);
    expect(result.impactedFiles.map((file) => file.path)).toEqual(expect.arrayContaining([
      "src/controller.cpp",
      "src/view.cpp",
      "tests/service_test.cpp",
    ]));
    expect(result.likelyTests[0]?.path).toBe("tests/service_test.cpp");
    expect(result.likelyTests[0]?.confidence).toBeGreaterThanOrEqual(0.72);
    expect(result.probableDependents.some((item) => item.filePath === "src/controller.cpp" && item.qualifiedName === "executeController")).toBe(true);
    expect(result.impactedFiles.find((file) => file.path === "tests/service_test.cpp")!.reasons.some((reason) => reason.includes("helper"))).toBe(true);
  });
});
