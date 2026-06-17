import type {
  ReviewGraphEdgeKind,
  ReviewGraphEdgeRecord,
  ReviewGraphFileRecord,
  ReviewGraphNodeKind,
  ReviewGraphNodeRecord,
  ReviewGraphStore,
  ReviewGraphWorkspaceSnapshot,
} from "./types.ts";
import { buildAliasMatcher, findMatchingAlias } from "./alias-matcher.ts";

export type ReviewGraphQueryInput = {
  repo: string;
  workspaceKey: string;
  changedPaths: string[];
  limit?: number;
};

export type ReviewGraphRankedFile = {
  path: string;
  score: number;
  confidence: number;
  reasons: string[];
  relatedChangedPaths: string[];
  languages: string[];
};

export type ReviewGraphLikelyTest = ReviewGraphRankedFile & {
  testSymbols: string[];
};

export type ReviewGraphDependent = {
  stableKey: string;
  symbolName: string | null;
  qualifiedName: string | null;
  filePath: string;
  score: number;
  confidence: number;
  reasons: string[];
  relatedChangedPaths: string[];
};

export type ReviewGraphBlastRadiusResult = {
  changedFiles: string[];
  seedSymbols: Array<{
    stableKey: string;
    symbolName: string | null;
    qualifiedName: string | null;
    filePath: string;
  }>;
  impactedFiles: ReviewGraphRankedFile[];
  probableDependents: ReviewGraphDependent[];
  likelyTests: ReviewGraphLikelyTest[];
  graphStats: {
    files: number;
    nodes: number;
    edges: number;
    changedFilesFound: number;
  };
};

type FileAccumulator = {
  path: string;
  score: number;
  maxConfidence: number;
  reasons: Set<string>;
  relatedChangedPaths: Set<string>;
  languages: Set<string>;
};

type DependentAccumulator = {
  stableKey: string;
  symbolName: string | null;
  qualifiedName: string | null;
  filePath: string;
  score: number;
  maxConfidence: number;
  reasons: Set<string>;
  relatedChangedPaths: Set<string>;
};

const EDGE_WEIGHT: Record<ReviewGraphEdgeKind, number> = {
  declares: 0.15,
  imports: 0.42,
  includes: 0.42,
  calls: 0.92,
  references: 0.55,
  tests: 0.88,
  contains: 0.2,
};

const KIND_BONUS: Partial<Record<ReviewGraphNodeKind, number>> = {
  symbol: 0.15,
  test: 0.1,
  callsite: 0.05,
  import: 0.03,
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function nodeConfidence(node: ReviewGraphNodeRecord | undefined): number {
  return clamp(node?.confidence ?? 1);
}

function edgeConfidence(edge: ReviewGraphEdgeRecord | undefined): number {
  return clamp(edge?.confidence ?? 1);
}

function getFilePathById(files: ReviewGraphFileRecord[]): Map<number, string> {
  return new Map(files.map((file) => [file.id, file.path]));
}

function addFileSignal(
  map: Map<string, FileAccumulator>,
  input: { path: string; score: number; confidence: number; reason: string; changedPath: string; language?: string | null },
): void {
  const existing = map.get(input.path) ?? {
    path: input.path,
    score: 0,
    maxConfidence: 0,
    reasons: new Set<string>(),
    relatedChangedPaths: new Set<string>(),
    languages: new Set<string>(),
  };
  existing.score += input.score;
  existing.maxConfidence = Math.max(existing.maxConfidence, input.confidence);
  existing.reasons.add(input.reason);
  existing.relatedChangedPaths.add(input.changedPath);
  if (input.language) existing.languages.add(input.language);
  map.set(input.path, existing);
}

function addDependentSignal(
  map: Map<string, DependentAccumulator>,
  input: {
    stableKey: string;
    symbolName: string | null;
    qualifiedName: string | null;
    filePath: string;
    score: number;
    confidence: number;
    reason: string;
    changedPath: string;
  },
): void {
  const existing = map.get(input.stableKey) ?? {
    stableKey: input.stableKey,
    symbolName: input.symbolName,
    qualifiedName: input.qualifiedName,
    filePath: input.filePath,
    score: 0,
    maxConfidence: 0,
    reasons: new Set<string>(),
    relatedChangedPaths: new Set<string>(),
  };
  existing.score += input.score;
  existing.maxConfidence = Math.max(existing.maxConfidence, input.confidence);
  existing.reasons.add(input.reason);
  existing.relatedChangedPaths.add(input.changedPath);
  map.set(input.stableKey, existing);
}

function rankedTieBreakKey(item: object): string {
  const record = item as Record<string, unknown>;
  return [
    typeof record.path === "string" ? record.path : "",
    typeof record.filePath === "string" ? record.filePath : "",
    typeof record.stableKey === "string" ? record.stableKey : "",
    typeof record.qualifiedName === "string" ? record.qualifiedName : "",
    typeof record.symbolName === "string" ? record.symbolName : "",
  ].join("\0");
}

function sortRanked<T extends { score: number; confidence: number }>(items: T[]): T[] {
  return items
    .map((item) => ({ item, tieBreakKey: rankedTieBreakKey(item) }))
    .sort((a, b) => {
      if (b.item.score !== a.item.score) return b.item.score - a.item.score;
      if (b.item.confidence !== a.item.confidence) return b.item.confidence - a.item.confidence;
      return a.tieBreakKey.localeCompare(b.tieBreakKey);
    })
    .map(({ item }) => item);
}

function collectSymbolAliases(node: ReviewGraphNodeRecord): string[] {
  const values = [
    node.symbolName,
    node.qualifiedName,
    node.qualifiedName?.split(".").at(-1) ?? null,
    node.qualifiedName?.split("::").at(-1) ?? null,
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(values));
}

function fileLikelyImportsChangedPath(filePath: string, changedPath: string): boolean {
  const changedBase = changedPath.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? changedPath;
  const normalizedFile = filePath.toLowerCase();
  const normalizedBase = changedBase.toLowerCase();
  return normalizedFile.includes(normalizedBase) || normalizedFile.includes(normalizedBase.replace(/_/g, ""));
}

function textTrigrams(value: string): string[] {
  if (value.length < 3) return [value];
  const grams: string[] = [];
  for (let index = 0; index <= value.length - 3; index += 1) {
    grams.push(value.slice(index, index + 3));
  }
  return grams;
}

function addNodeBucket(
  index: Map<string, Set<ReviewGraphNodeRecord>>,
  key: string,
  node: ReviewGraphNodeRecord,
): void {
  if (!key) return;
  const bucket = index.get(key) ?? new Set<ReviewGraphNodeRecord>();
  bucket.add(node);
  index.set(key, bucket);
}

function addFuzzyTextBuckets(
  index: Map<string, Set<ReviewGraphNodeRecord>>,
  text: string,
  node: ReviewGraphNodeRecord,
): void {
  const normalized = text.toLowerCase();
  for (const gram of textTrigrams(normalized)) {
    addNodeBucket(index, gram, node);
  }
  if (normalized.length <= 128) {
    for (let size = 1; size <= 2; size += 1) {
      for (let start = 0; start <= normalized.length - size; start += 1) {
        addNodeBucket(index, normalized.slice(start, start + size), node);
      }
    }
  }
}

function collectFuzzyCandidates(
  index: Map<string, Set<ReviewGraphNodeRecord>>,
  text: string,
): ReviewGraphNodeRecord[] {
  const candidates = new Set<ReviewGraphNodeRecord>();
  for (const key of textTrigrams(text.toLowerCase())) {
    const bucket = index.get(key);
    if (!bucket) continue;
    for (const node of bucket) candidates.add(node);
  }
  return [...candidates];
}

function collectCallsiteLookupAliases(node: ReviewGraphNodeRecord): string[] {
  const callee = (node.qualifiedName ?? node.symbolName ?? "").toLowerCase();
  if (!callee) return [];
  return Array.from(new Set([
    callee,
    callee.split(".").at(-1) ?? callee,
    callee.split("::").at(-1) ?? callee,
  ]));
}

function buildIndexes(snapshot: ReviewGraphWorkspaceSnapshot) {
  const filePathById = getFilePathById(snapshot.files);
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const nodeByStableKey = new Map(snapshot.nodes.map((node) => [node.stableKey, node]));
  const nodesByFilePath = new Map<string, ReviewGraphNodeRecord[]>();
  const outgoingEdgesByNodeId = new Map<number, ReviewGraphEdgeRecord[]>();
  const incomingEdgesByNodeId = new Map<number, ReviewGraphEdgeRecord[]>();
  const importNodesByTargetGram = new Map<string, Set<ReviewGraphNodeRecord>>();
  const callsiteNodesByAlias = new Map<string, Set<ReviewGraphNodeRecord>>();
  const testNodesByAliasGram = new Map<string, Set<ReviewGraphNodeRecord>>();
  const symbolByFileAndStableKey = new Map<string, ReviewGraphNodeRecord>();

  for (const node of snapshot.nodes) {
    const filePath = filePathById.get(node.fileId);
    if (!filePath) continue;
    const existing = nodesByFilePath.get(filePath) ?? [];
    existing.push(node);
    nodesByFilePath.set(filePath, existing);

    if (node.nodeKind === "import") {
      addFuzzyTextBuckets(
        importNodesByTargetGram,
        `${node.qualifiedName ?? ""} ${node.symbolName ?? ""}`,
        node,
      );
    } else if (node.nodeKind === "callsite") {
      for (const alias of collectCallsiteLookupAliases(node)) {
        addNodeBucket(callsiteNodesByAlias, alias, node);
      }
    } else if (node.nodeKind === "test") {
      for (const alias of collectSymbolAliases(node).map((value) => value.toLowerCase())) {
        addFuzzyTextBuckets(testNodesByAliasGram, alias, node);
      }
    } else if (node.nodeKind === "symbol") {
      symbolByFileAndStableKey.set(`${node.fileId}:${node.stableKey}`, node);
    }
  }

  for (const edge of snapshot.edges) {
    const outgoing = outgoingEdgesByNodeId.get(edge.sourceNodeId) ?? [];
    outgoing.push(edge);
    outgoingEdgesByNodeId.set(edge.sourceNodeId, outgoing);

    const incoming = incomingEdgesByNodeId.get(edge.targetNodeId) ?? [];
    incoming.push(edge);
    incomingEdgesByNodeId.set(edge.targetNodeId, incoming);
  }

  return {
    filePathById,
    nodeById,
    nodeByStableKey,
    nodesByFilePath,
    outgoingEdgesByNodeId,
    incomingEdgesByNodeId,
    importNodesByTargetGram,
    callsiteNodesByAlias,
    testNodesByAliasGram,
    symbolByFileAndStableKey,
  };
}

function collectImportCandidates(
  indexes: ReturnType<typeof buildIndexes>,
  changedPath: string,
): ReviewGraphNodeRecord[] {
  const changedBase = changedPath.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? changedPath;
  const candidates = new Set<ReviewGraphNodeRecord>();
  for (const value of [changedBase, changedBase.replace(/_/g, "")]) {
    for (const node of collectFuzzyCandidates(indexes.importNodesByTargetGram, value)) {
      candidates.add(node);
    }
  }
  return [...candidates];
}

function collectCallsiteCandidates(
  indexes: ReturnType<typeof buildIndexes>,
  symbolAliases: ReadonlySet<string>,
): ReviewGraphNodeRecord[] {
  const candidates = new Set<ReviewGraphNodeRecord>();
  for (const alias of symbolAliases) {
    const bucket = indexes.callsiteNodesByAlias.get(alias);
    if (!bucket) continue;
    for (const node of bucket) candidates.add(node);
  }
  return [...candidates];
}

function collectTestCandidates(
  indexes: ReturnType<typeof buildIndexes>,
  symbolAliases: ReadonlySet<string>,
): ReviewGraphNodeRecord[] {
  const candidates = new Set<ReviewGraphNodeRecord>();
  for (const alias of symbolAliases) {
    for (const node of collectFuzzyCandidates(indexes.testNodesByAliasGram, alias)) {
      candidates.add(node);
    }
  }
  return [...candidates];
}

export function queryBlastRadiusFromSnapshot(
  snapshot: ReviewGraphWorkspaceSnapshot,
  input: ReviewGraphQueryInput,
): ReviewGraphBlastRadiusResult {
  const changedFiles = Array.from(new Set(input.changedPaths.map(normalizePath))).sort((a, b) => a.localeCompare(b));
  const limit = input.limit ?? 20;
  const indexes = buildIndexes(snapshot);
  const changedFileSet = new Set(changedFiles);
  const impacted = new Map<string, FileAccumulator>();
  const likelyTests = new Map<string, FileAccumulator & { testSymbols: Set<string> }>();
  const dependents = new Map<string, DependentAccumulator>();
  const seedNodes: ReviewGraphNodeRecord[] = [];

  for (const changedPath of changedFiles) {
    const fileNodes = indexes.nodesByFilePath.get(changedPath) ?? [];
    if (fileNodes.length === 0) continue;

    const symbolSeeds = fileNodes.filter((node) => node.nodeKind === "symbol" || node.nodeKind === "test");
    seedNodes.push(...symbolSeeds);

    for (const seed of symbolSeeds) {
      const seedConf = nodeConfidence(seed);
      const incoming = indexes.incomingEdgesByNodeId.get(seed.id) ?? [];

      for (const edge of incoming) {
        const source = indexes.nodeById.get(edge.sourceNodeId);
        if (!source) continue;
        const sourcePath = indexes.filePathById.get(source.fileId);
        if (!sourcePath || changedFileSet.has(sourcePath)) continue;

        const edgeConf = edgeConfidence(edge);
        const score = round((EDGE_WEIGHT[edge.edgeKind] ?? 0.2) * edgeConf * seedConf * (1 + (KIND_BONUS[source.nodeKind] ?? 0)));
        const reason = edge.edgeKind === "tests"
          ? `tests changed symbol ${seed.qualifiedName ?? seed.symbolName ?? seed.stableKey}`
          : edge.edgeKind === "calls"
            ? `calls changed symbol ${seed.qualifiedName ?? seed.symbolName ?? seed.stableKey}`
            : `${edge.edgeKind} changed symbol ${seed.qualifiedName ?? seed.symbolName ?? seed.stableKey}`;

        addFileSignal(impacted, {
          path: sourcePath,
          score,
          confidence: edgeConf,
          reason,
          changedPath,
          language: source.language,
        });

        if (source.nodeKind === "test") {
          const existing = likelyTests.get(sourcePath) ?? {
            path: sourcePath,
            score: 0,
            maxConfidence: 0,
            reasons: new Set<string>(),
            relatedChangedPaths: new Set<string>(),
            languages: new Set<string>(),
            testSymbols: new Set<string>(),
          };
          existing.score += score + 0.15;
          existing.maxConfidence = Math.max(existing.maxConfidence, edgeConf);
          existing.reasons.add(reason);
          existing.relatedChangedPaths.add(changedPath);
          existing.languages.add(source.language);
          existing.testSymbols.add(source.qualifiedName ?? source.symbolName ?? source.stableKey);
          likelyTests.set(sourcePath, existing);
        } else if (edge.edgeKind === "calls" || edge.edgeKind === "references") {
          addDependentSignal(dependents, {
            stableKey: source.stableKey,
            symbolName: source.symbolName,
            qualifiedName: source.qualifiedName,
            filePath: sourcePath,
            score,
            confidence: edgeConf,
            reason,
            changedPath,
          });
        }
      }

      const outgoing = indexes.outgoingEdgesByNodeId.get(seed.id) ?? [];
      for (const edge of outgoing) {
        const target = indexes.nodeById.get(edge.targetNodeId);
        if (!target) continue;
        const targetPath = indexes.filePathById.get(target.fileId);
        if (!targetPath || changedFileSet.has(targetPath)) continue;

        const edgeConf = edgeConfidence(edge);
        const score = round((EDGE_WEIGHT[edge.edgeKind] ?? 0.2) * edgeConf * seedConf * 0.85);
        addFileSignal(impacted, {
          path: targetPath,
          score,
          confidence: edgeConf,
          reason: `${seed.qualifiedName ?? seed.symbolName ?? seed.stableKey} ${edge.edgeKind} ${target.qualifiedName ?? target.symbolName ?? target.stableKey}`,
          changedPath,
          language: target.language,
        });
      }
    }

    const fileNode = fileNodes.find((node) => node.nodeKind === "file");
    if (fileNode) {
      const importers = indexes.incomingEdgesByNodeId.get(fileNode.id) ?? [];
      for (const edge of importers) {
        const source = indexes.nodeById.get(edge.sourceNodeId);
        if (!source) continue;
        const sourcePath = indexes.filePathById.get(source.fileId);
        if (!sourcePath || changedFileSet.has(sourcePath)) continue;
        const edgeConf = edgeConfidence(edge);
        addFileSignal(impacted, {
          path: sourcePath,
          score: round((EDGE_WEIGHT[edge.edgeKind] ?? 0.2) * edgeConf * 0.75),
          confidence: edgeConf,
          reason: `${sourcePath} ${edge.edgeKind} changed file ${changedPath}`,
          changedPath,
          language: source.language,
        });
      }
    }

    const changedSymbols = fileNodes.filter((node) => node.nodeKind === "symbol" || node.nodeKind === "test");
    const symbolAliases = new Set(changedSymbols.flatMap((node) => collectSymbolAliases(node).map((value) => value.toLowerCase())));
    const symbolAliasMatcher = buildAliasMatcher(symbolAliases);

    for (const importNode of collectImportCandidates(indexes, changedPath)) {
      const importPath = indexes.filePathById.get(importNode.fileId);
      if (!importPath || changedFileSet.has(importPath)) continue;
      const targetText = `${importNode.qualifiedName ?? ""} ${importNode.symbolName ?? ""}`.toLowerCase();
      if (!fileLikelyImportsChangedPath(targetText, changedPath)) continue;
      const conf = nodeConfidence(importNode);
      addFileSignal(impacted, {
        path: importPath,
        score: round(0.38 * conf),
        confidence: conf,
        reason: `imports or includes changed file ${changedPath}`,
        changedPath,
        language: importNode.language,
      });
    }

    for (const callsite of collectCallsiteCandidates(indexes, symbolAliases)) {
      const callsitePath = indexes.filePathById.get(callsite.fileId);
      if (!callsitePath || changedFileSet.has(callsitePath)) continue;
      const callee = (callsite.qualifiedName ?? callsite.symbolName ?? "").toLowerCase();
      if (!callee || !symbolAliases.has(callee) && !symbolAliases.has(callee.split(".").at(-1) ?? callee) && !symbolAliases.has(callee.split("::").at(-1) ?? callee)) {
        continue;
      }

      const conf = nodeConfidence(callsite);
      addFileSignal(impacted, {
        path: callsitePath,
        score: round(0.62 * conf),
        confidence: conf,
        reason: `calls changed symbol ${callsite.qualifiedName ?? callsite.symbolName ?? callsite.stableKey}`,
        changedPath,
        language: callsite.language,
      });

      const owner = indexes.symbolByFileAndStableKey.get(`${callsite.fileId}:${String(callsite.attributes.callerStableKey ?? "")}`);
      if (owner) {
        addDependentSignal(dependents, {
          stableKey: owner.stableKey,
          symbolName: owner.symbolName,
          qualifiedName: owner.qualifiedName,
          filePath: callsitePath,
          score: round(0.62 * conf),
          confidence: conf,
          reason: `contains callsite reaching changed symbol ${callsite.qualifiedName ?? callsite.symbolName ?? callsite.stableKey}`,
          changedPath,
        });
      }
    }

    for (const testNode of collectTestCandidates(indexes, symbolAliases)) {
      const testPath = indexes.filePathById.get(testNode.fileId);
      if (!testPath || changedFileSet.has(testPath)) continue;
      const aliases = collectSymbolAliases(testNode).map((value) => value.toLowerCase());
      const matchedAlias = findMatchingAlias(aliases, symbolAliasMatcher);
      if (!matchedAlias) continue;

      const conf = nodeConfidence(testNode);
      addFileSignal(impacted, {
        path: testPath,
        score: round(0.7 * conf),
        confidence: conf,
        reason: `test heuristic matches changed symbol ${matchedAlias}`,
        changedPath,
        language: testNode.language,
      });

      const existing = likelyTests.get(testPath) ?? {
        path: testPath,
        score: 0,
        maxConfidence: 0,
        reasons: new Set<string>(),
        relatedChangedPaths: new Set<string>(),
        languages: new Set<string>(),
        testSymbols: new Set<string>(),
      };
      existing.score += round(0.7 * conf);
      existing.maxConfidence = Math.max(existing.maxConfidence, conf);
      existing.reasons.add(`test heuristic matches changed symbol ${matchedAlias}`);
      existing.relatedChangedPaths.add(changedPath);
      existing.languages.add(testNode.language);
      existing.testSymbols.add(testNode.qualifiedName ?? testNode.symbolName ?? testNode.stableKey);
      likelyTests.set(testPath, existing);
    }
  }

  return {
    changedFiles,
    seedSymbols: Array.from(new Map(seedNodes.map((node) => [node.stableKey, node])).values()).map((node) => ({
      stableKey: node.stableKey,
      symbolName: node.symbolName,
      qualifiedName: node.qualifiedName,
      filePath: indexes.filePathById.get(node.fileId) ?? "",
    })),
    impactedFiles: sortRanked(
      Array.from(impacted.values()).map((item) => ({
        path: item.path,
        score: round(item.score),
        confidence: round(item.maxConfidence),
        reasons: Array.from(item.reasons).sort(),
        relatedChangedPaths: Array.from(item.relatedChangedPaths).sort(),
        languages: Array.from(item.languages).sort(),
      })),
    ).slice(0, limit),
    probableDependents: sortRanked(
      Array.from(dependents.values()).map((item) => ({
        stableKey: item.stableKey,
        symbolName: item.symbolName,
        qualifiedName: item.qualifiedName,
        filePath: item.filePath,
        score: round(item.score),
        confidence: round(item.maxConfidence),
        reasons: Array.from(item.reasons).sort(),
        relatedChangedPaths: Array.from(item.relatedChangedPaths).sort(),
      })),
    ).slice(0, limit),
    likelyTests: sortRanked(
      Array.from(likelyTests.values()).map((item) => ({
        path: item.path,
        score: round(item.score),
        confidence: round(item.maxConfidence),
        reasons: Array.from(item.reasons).sort(),
        relatedChangedPaths: Array.from(item.relatedChangedPaths).sort(),
        languages: Array.from(item.languages).sort(),
        testSymbols: Array.from(item.testSymbols).sort(),
      })),
    ).slice(0, limit),
    graphStats: {
      files: snapshot.files.length,
      nodes: snapshot.nodes.length,
      edges: snapshot.edges.length,
      changedFilesFound: changedFiles.filter((path) => indexes.nodesByFilePath.has(path)).length,
    },
  };
}

export function createReviewGraphQuery(opts: { store: ReviewGraphStore }) {
  return {
    async queryBlastRadius(input: ReviewGraphQueryInput): Promise<ReviewGraphBlastRadiusResult> {
      const snapshot = await opts.store.listWorkspaceGraph(input.repo, input.workspaceKey);
      return queryBlastRadiusFromSnapshot(snapshot, input);
    },
  };
}
