export const REVIEW_GRAPH_NODE_KINDS = [
  "file",
  "symbol",
  "import",
  "callsite",
  "test",
] as const;

export type ReviewGraphNodeKind = typeof REVIEW_GRAPH_NODE_KINDS[number];

export const REVIEW_GRAPH_EDGE_KINDS = [
  "declares",
  "imports",
  "includes",
  "calls",
  "references",
  "tests",
  "contains",
] as const;

export type ReviewGraphEdgeKind = typeof REVIEW_GRAPH_EDGE_KINDS[number];

export const REVIEW_GRAPH_BUILD_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export type ReviewGraphBuildStatus = typeof REVIEW_GRAPH_BUILD_STATUSES[number];

export type ReviewGraphNodeAttributes = Record<string, unknown>;
export type ReviewGraphEdgeAttributes = Record<string, unknown>;

export type ReviewGraphNodeRecord = {
  id: number;
  repo: string;
  workspaceKey: string;
  fileId: number;
  buildId: number | null;
  nodeKind: ReviewGraphNodeKind;
  stableKey: string;
  symbolName: string | null;
  qualifiedName: string | null;
  language: string;
  spanStartLine: number | null;
  spanStartCol: number | null;
  spanEndLine: number | null;
  spanEndCol: number | null;
  signature: string | null;
  attributes: ReviewGraphNodeAttributes;
  confidence: number | null;
  createdAt: string;
};

export type ReviewGraphEdgeRecord = {
  id: number;
  repo: string;
  workspaceKey: string;
  fileId: number;
  buildId: number | null;
  edgeKind: ReviewGraphEdgeKind;
  sourceNodeId: number;
  targetNodeId: number;
  confidence: number | null;
  attributes: ReviewGraphEdgeAttributes;
  createdAt: string;
};

export type ReviewGraphFileRecord = {
  id: number;
  repo: string;
  workspaceKey: string;
  path: string;
  language: string;
  contentHash: string | null;
  indexedAt: string;
  buildId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewGraphBuildRecord = {
  id: number;
  repo: string;
  workspaceKey: string;
  commitSha: string | null;
  status: ReviewGraphBuildStatus;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  filesIndexed: number;
  filesFailed: number;
  nodesWritten: number;
  edgesWritten: number;
  createdAt: string;
  updatedAt: string;
};

export type ReviewGraphFileInput = {
  repo: string;
  workspaceKey: string;
  path: string;
  language: string;
  contentHash?: string | null;
  buildId?: number | null;
};

export type ReviewGraphNodeInput = {
  nodeKind: ReviewGraphNodeKind;
  stableKey: string;
  symbolName?: string | null;
  qualifiedName?: string | null;
  language: string;
  spanStartLine?: number | null;
  spanStartCol?: number | null;
  spanEndLine?: number | null;
  spanEndCol?: number | null;
  signature?: string | null;
  attributes?: ReviewGraphNodeAttributes;
  confidence?: number | null;
};

export type ReviewGraphEdgeInput = {
  edgeKind: ReviewGraphEdgeKind;
  sourceStableKey: string;
  targetStableKey: string;
  confidence?: number | null;
  attributes?: ReviewGraphEdgeAttributes;
};

export type ReplaceFileGraphInput = {
  file: ReviewGraphFileInput;
  nodes: ReviewGraphNodeInput[];
  edges: ReviewGraphEdgeInput[];
};

export type ReviewGraphBuildUpsert = {
  repo: string;
  workspaceKey: string;
  commitSha?: string | null;
  status: ReviewGraphBuildStatus;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  lastError?: string | null;
  filesIndexed?: number;
  filesFailed?: number;
  nodesWritten?: number;
  edgesWritten?: number;
};

export type ReviewGraphStore = {
  upsertBuild(input: ReviewGraphBuildUpsert): Promise<ReviewGraphBuildRecord>;
  replaceFileGraph(input: ReplaceFileGraphInput): Promise<{
    file: ReviewGraphFileRecord;
    nodesWritten: number;
    edgesWritten: number;
  }>;
  getFile(repo: string, workspaceKey: string, path: string): Promise<ReviewGraphFileRecord | null>;
  listNodesForFile(fileId: number): Promise<ReviewGraphNodeRecord[]>;
  listEdgesForFile(fileId: number): Promise<ReviewGraphEdgeRecord[]>;
  getBuild(repo: string, workspaceKey: string): Promise<ReviewGraphBuildRecord | null>;
};
