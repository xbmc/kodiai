import type { ReviewGraphEdgeInput, ReviewGraphNodeInput } from "./types.ts";

type SupportedLanguage = "cpp" | "python";

type ExtractReviewGraphInput = {
  repo: string;
  workspaceKey: string;
  path: string;
  content: string;
  language: SupportedLanguage;
};

export type ReviewGraphExtraction = {
  file: {
    repo: string;
    workspaceKey: string;
    path: string;
    language: SupportedLanguage;
  };
  nodes: ReviewGraphNodeInput[];
  edges: ReviewGraphEdgeInput[];
  metrics: {
    language: SupportedLanguage;
    fileNodeCount: number;
    symbolNodeCount: number;
    importNodeCount: number;
    callsiteNodeCount: number;
    testNodeCount: number;
    probableEdgeCount: number;
  };
};

type SymbolRecord = {
  stableKey: string;
  symbolName: string;
  qualifiedName: string;
  kind: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  signature: string | null;
  containerName?: string;
  probableTestConfidence: number | null;
};

type ImportRecord = {
  stableKey: string;
  importName: string;
  target: string;
  targetSymbol?: string;
  targetPath?: string;
  line: number;
  col: number;
  kind: "import" | "include";
};

type CallRecord = {
  stableKey: string;
  callerStableKey: string;
  calleeName: string;
  line: number;
  col: number;
  confidence: number;
};

function buildFileStableKey(path: string): string {
  return `file:${path}`;
}

function buildImportStableKey(path: string, line: number, target: string): string {
  return `import:${path}:${line}:${target}`;
}

function buildCallStableKey(path: string, line: number, caller: string, callee: string): string {
  return `call:${path}:${line}:${caller}->${callee}`;
}

function buildSymbolStableKey(path: string, qualifiedName: string): string {
  return `symbol:${path}:${qualifiedName}`;
}

function pythonModuleToPath(moduleName: string): string {
  return `${moduleName.replace(/\./g, "/")}.py`;
}

function dirnamePath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function normalizeRepoPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function resolveLocalIncludePath(currentPath: string, includeTarget: string): string {
  const baseDir = dirnamePath(currentPath);
  return normalizeRepoPath(baseDir ? `${baseDir}/${includeTarget}` : includeTarget);
}

function buildTestStableKey(path: string, qualifiedName: string): string {
  return `test:${path}:${qualifiedName}`;
}

function lineColFromIndex(text: string, index: number): { line: number; col: number } {
  const upto = text.slice(0, Math.max(0, index));
  const lines = upto.split("\n");
  return {
    line: lines.length,
    col: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function dedupeByStableKey<T extends { stableKey: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.stableKey)) continue;
    seen.add(item.stableKey);
    result.push(item);
  }
  return result;
}

function uniqueEdges(edges: ReviewGraphEdgeInput[]): ReviewGraphEdgeInput[] {
  const seen = new Set<string>();
  const result: ReviewGraphEdgeInput[] = [];
  for (const edge of edges) {
    const attributes = edge.attributes && Object.keys(edge.attributes).length > 0
      ? JSON.stringify(edge.attributes)
      : "";
    const key = [
      edge.edgeKind,
      edge.sourceStableKey,
      edge.targetStableKey,
      edge.confidence ?? "",
      attributes,
    ].join("\u001f");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

function countReviewGraphMetrics(
  language: SupportedLanguage,
  nodes: ReviewGraphNodeInput[],
  edges: ReviewGraphEdgeInput[],
): ReviewGraphExtraction["metrics"] {
  let fileNodeCount = 0;
  let symbolNodeCount = 0;
  let importNodeCount = 0;
  let callsiteNodeCount = 0;
  let testNodeCount = 0;
  for (const node of nodes) {
    if (node.nodeKind === "file") fileNodeCount++;
    else if (node.nodeKind === "symbol") symbolNodeCount++;
    else if (node.nodeKind === "import") importNodeCount++;
    else if (node.nodeKind === "callsite") callsiteNodeCount++;
    else if (node.nodeKind === "test") testNodeCount++;
  }

  let probableEdgeCount = 0;
  for (const edge of edges) {
    if ((edge.confidence ?? 1) < 1) probableEdgeCount++;
  }

  return {
    language,
    fileNodeCount,
    symbolNodeCount,
    importNodeCount,
    callsiteNodeCount,
    testNodeCount,
    probableEdgeCount,
  };
}

function classifyProbableTest(path: string, symbolName: string): number | null {
  const lowerPath = path.toLowerCase();
  const lowerName = symbolName.toLowerCase();
  if (lowerName.startsWith("test_")) return 0.98;
  if (lowerPath.includes("/tests/") || lowerPath.endsWith("_test.py") || lowerPath.startsWith("tests/")) return 0.9;
  if (lowerName.startsWith("test")) return 0.75;
  return null;
}

function classifyProbableCppTest(path: string, symbolName: string): number | null {
  const lowerPath = path.toLowerCase();
  const lowerName = symbolName.toLowerCase();
  if (/^test_/.test(lowerName) || lowerName.includes("fixture") || lowerName.endsWith("test")) {
    return 0.72;
  }
  if (lowerName.includes("servicetest") || lowerName.includes("test_")) {
    return 0.72;
  }
  if (lowerPath.includes("/test") || lowerPath.includes("/tests") || lowerPath.endsWith("test.cpp") || lowerPath.endsWith("_test.cpp")) {
    return lowerName.includes("test") ? 0.72 : null;
  }
  return null;
}

function extractPython(input: ExtractReviewGraphInput): ReviewGraphExtraction {
  const fileStableKey = buildFileStableKey(input.path);
  const symbolRecords: SymbolRecord[] = [];
  const importRecords: ImportRecord[] = [];
  const callRecords: CallRecord[] = [];

  const lines = input.content.split("\n");
  const classStack: Array<{ indent: number; name: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    const currentIndent = line.match(/^([ \t]*)/)?.[1]?.length ?? 0;

    if (line.trim()) {
      while (classStack.length > 0 && classStack[classStack.length - 1]!.indent >= currentIndent) {
        classStack.pop();
      }
    }

    const importMatch = line.match(/^\s*import\s+(.+)$/);
    if (importMatch) {
      for (const part of importMatch[1]!.split(",").map((v) => v.trim()).filter(Boolean)) {
        importRecords.push({
          stableKey: buildImportStableKey(input.path, lineNo, part),
          importName: part,
          target: part,
          line: lineNo,
          col: line.indexOf(part) + 1,
          kind: "import",
        });
      }
    }

    const fromMatch = line.match(/^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+(.+)$/);
    if (fromMatch) {
      const moduleName = fromMatch[1]!;
      const imported = fromMatch[2]!.split(",").map((v) => v.trim()).filter(Boolean);
      for (const part of imported) {
        const aliasMatch = part.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
        const importedName = aliasMatch?.[1] ?? part;
        const localName = aliasMatch?.[2] ?? importedName;
        importRecords.push({
          stableKey: buildImportStableKey(input.path, lineNo, `${moduleName}.${importedName}`),
          importName: localName,
          target: moduleName,
          targetSymbol: importedName,
          line: lineNo,
          col: line.indexOf(part) + 1,
          kind: "import",
        });
      }
    }

    const classMatch = line.match(/^([ \t]*)class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*:/);
    if (classMatch) {
      classStack.push({
        indent: classMatch[1]?.length ?? 0,
        name: classMatch[2]!,
      });
      continue;
    }

    const defMatch = line.match(/^([ \t]*)def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/);
    if (defMatch) {
      const indent = defMatch[1]?.length ?? 0;
      const containerName = [...classStack].reverse().find((entry) => entry.indent < indent)?.name;

      const symbolName = defMatch[2]!;
      const qualifiedName = containerName ? `${containerName}.${symbolName}` : symbolName;
      const probableTestConfidence = classifyProbableTest(input.path, symbolName);
      symbolRecords.push({
        stableKey: buildSymbolStableKey(input.path, qualifiedName),
        symbolName,
        qualifiedName,
        kind: containerName ? "method" : "function",
        line: lineNo,
        col: line.indexOf("def ") + 1,
        endLine: lineNo,
        endCol: line.length + 1,
        signature: `def ${symbolName}(${defMatch[3] ?? ""})`,
        containerName,
        probableTestConfidence,
      });
    }
  }

  for (const symbol of symbolRecords) {
    const symbolLine = lines[symbol.line - 1] ?? "";
    const symbolIndent = symbolLine.match(/^([ \t]*)/)?.[1]?.length ?? 0;
    const bodyLines: string[] = [];
    for (let i = symbol.line; i < lines.length; i++) {
      const current = lines[i]!;
      if (!current.trim()) {
        bodyLines.push(current);
        continue;
      }
      const currentIndent = current.match(/^([ \t]*)/)?.[1]?.length ?? 0;
      if (currentIndent <= symbolIndent) break;
      bodyLines.push(current);
    }

    const body = bodyLines.join("\n");
    const callRegex = /\b([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/g;
    for (const match of body.matchAll(callRegex)) {
      const calleeName = match[1]!;
      if (["if", "for", "while", "return", "class", "def", "with", "print"].includes(calleeName)) continue;
      const relative = lineColFromIndex(body, match.index ?? 0);
      const absoluteLine = symbol.line + relative.line;
      callRecords.push({
        stableKey: buildCallStableKey(input.path, absoluteLine, symbol.qualifiedName, calleeName),
        callerStableKey: symbol.stableKey,
        calleeName,
        line: absoluteLine,
        col: relative.col,
        confidence: calleeName.includes(".") ? 0.78 : 0.9,
      });
    }
  }

  const nodes: ReviewGraphNodeInput[] = [
    {
      nodeKind: "file",
      stableKey: fileStableKey,
      language: "python",
      attributes: { path: input.path },
      confidence: 1,
    },
  ];

  const edges: ReviewGraphEdgeInput[] = [];

  for (const symbol of dedupeByStableKey(symbolRecords)) {
    nodes.push({
      nodeKind: "symbol",
      stableKey: symbol.stableKey,
      symbolName: symbol.symbolName,
      qualifiedName: symbol.qualifiedName,
      language: "python",
      spanStartLine: symbol.line,
      spanStartCol: symbol.col,
      spanEndLine: symbol.endLine,
      spanEndCol: symbol.endCol,
      signature: symbol.signature,
      attributes: { kind: symbol.kind, containerName: symbol.containerName ?? null },
      confidence: 1,
    });
    edges.push({
      edgeKind: "declares",
      sourceStableKey: fileStableKey,
      targetStableKey: symbol.stableKey,
      confidence: 1,
    });

    if (symbol.probableTestConfidence !== null) {
      const testStableKey = buildTestStableKey(input.path, symbol.qualifiedName);
      nodes.push({
        nodeKind: "test",
        stableKey: testStableKey,
        symbolName: symbol.symbolName,
        qualifiedName: symbol.qualifiedName,
        language: "python",
        spanStartLine: symbol.line,
        spanStartCol: symbol.col,
        spanEndLine: symbol.endLine,
        spanEndCol: symbol.endCol,
        signature: symbol.signature,
        attributes: { inferred: true, heuristic: "python-test-name-or-path" },
        confidence: symbol.probableTestConfidence,
      });
      edges.push({
        edgeKind: "tests",
        sourceStableKey: testStableKey,
        targetStableKey: symbol.stableKey,
        confidence: symbol.probableTestConfidence,
        attributes: { heuristic: "python-test-name-or-path" },
      });
    }
  }

  for (const item of dedupeByStableKey(importRecords)) {
    nodes.push({
      nodeKind: "import",
      stableKey: item.stableKey,
      symbolName: item.importName,
      qualifiedName: item.target,
      language: "python",
      spanStartLine: item.line,
      spanStartCol: item.col,
      spanEndLine: item.line,
      spanEndCol: item.col + item.importName.length,
      attributes: { kind: item.kind, target: item.target },
      confidence: 1,
    });
    edges.push({
      edgeKind: "imports",
      sourceStableKey: fileStableKey,
      targetStableKey: item.stableKey,
      confidence: 1,
    });
  }

  const symbolBySimpleName = new Map<string, SymbolRecord>();
  for (const symbol of symbolRecords) {
    symbolBySimpleName.set(symbol.symbolName, symbol);
    symbolBySimpleName.set(symbol.qualifiedName, symbol);
  }
  const importedSymbolTargets = new Map<string, string>();
  for (const item of importRecords) {
    if (!item.targetSymbol) continue;
    importedSymbolTargets.set(
      item.importName,
      buildSymbolStableKey(pythonModuleToPath(item.target), item.targetSymbol),
    );
  }

  for (const call of dedupeByStableKey(callRecords)) {
    nodes.push({
      nodeKind: "callsite",
      stableKey: call.stableKey,
      symbolName: call.calleeName,
      qualifiedName: call.calleeName,
      language: "python",
      spanStartLine: call.line,
      spanStartCol: call.col,
      spanEndLine: call.line,
      spanEndCol: call.col + call.calleeName.length,
      attributes: { callerStableKey: call.callerStableKey, calleeName: call.calleeName },
      confidence: call.confidence,
    });
    const target = symbolBySimpleName.get(call.calleeName)
      ?? symbolBySimpleName.get(call.calleeName.split(".").at(-1) ?? call.calleeName);
    if (target) {
      edges.push({
        edgeKind: "calls",
        sourceStableKey: call.stableKey,
        targetStableKey: target.stableKey,
        confidence: call.confidence,
        attributes: { callerStableKey: call.callerStableKey },
      });
    } else {
      const importedTargetStableKey = importedSymbolTargets.get(call.calleeName);
      if (importedTargetStableKey) {
        edges.push({
          edgeKind: "calls",
          sourceStableKey: call.stableKey,
          targetStableKey: importedTargetStableKey,
          confidence: Math.min(call.confidence, 0.72),
          attributes: {
            callerStableKey: call.callerStableKey,
            crossFile: true,
            resolution: "python-from-import",
          },
        });
      }
    }
  }

  const finalNodes = dedupeByStableKey(nodes);
  const finalNodeKeys = new Set(finalNodes.map((node) => node.stableKey));
  const finalEdges = uniqueEdges(edges).filter((edge) =>
    finalNodeKeys.has(edge.sourceStableKey)
    && (finalNodeKeys.has(edge.targetStableKey) || edge.attributes?.crossFile === true),
  );

  return {
    file: {
      repo: input.repo,
      workspaceKey: input.workspaceKey,
      path: input.path,
      language: "python",
    },
    nodes: finalNodes,
    edges: finalEdges,
    metrics: countReviewGraphMetrics("python", finalNodes, finalEdges),
  };
}

function extractCpp(input: ExtractReviewGraphInput): ReviewGraphExtraction {
  const fileStableKey = buildFileStableKey(input.path);
  const symbolRecords: SymbolRecord[] = [];
  const importRecords: ImportRecord[] = [];
  const callRecords: CallRecord[] = [];

  const lines = input.content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    const includeMatch = line.match(/^\s*#include\s+([<"])([^>"]+)[>"]/);
    if (includeMatch) {
      const delimiter = includeMatch[1]!;
      const target = includeMatch[2]!;
      importRecords.push({
        stableKey: buildImportStableKey(input.path, lineNo, target),
        importName: target,
        target,
        targetPath: delimiter === '"' ? resolveLocalIncludePath(input.path, target) : undefined,
        line: lineNo,
        col: line.indexOf(target) + 1,
        kind: "include",
      });
    }

    const functionMatch = line.match(/^\s*(?:template\s*<[^>]+>\s*)?(?:inline\s+|static\s+|virtual\s+|constexpr\s+|friend\s+)?(?:[A-Za-z_][\w:<>,*&\s~]+?)\s+([A-Za-z_~][\w:]*)\s*\(([^;{}]*)\)\s*(?:const\s*)?(?:\{|$)/);
    if (functionMatch && !line.includes("if (") && !line.includes("for (") && !line.includes("while (")) {
      const rawName = functionMatch[1]!;
      const symbolName = rawName.split("::").at(-1) ?? rawName;
      const probableTestConfidence = classifyProbableCppTest(input.path, symbolName);
      symbolRecords.push({
        stableKey: buildSymbolStableKey(input.path, rawName),
        symbolName,
        qualifiedName: rawName,
        kind: rawName.includes("::") ? "method" : "function",
        line: lineNo,
        col: line.indexOf(rawName) + 1,
        endLine: lineNo,
        endCol: line.length + 1,
        signature: `${rawName}(${functionMatch[2] ?? ""})`,
        probableTestConfidence,
      });
    }
  }

  for (const symbol of symbolRecords) {
    const bodyStart = Math.max(0, symbol.line - 1);
    let braceDepth = 0;
    let started = false;
    const bodyLines: string[] = [];
    for (let i = bodyStart; i < lines.length; i++) {
      const current = lines[i]!;
      if (current.includes("{")) {
        braceDepth += (current.match(/\{/g) ?? []).length;
        started = true;
      }
      if (started) bodyLines.push(current);
      if (current.includes("}")) {
        braceDepth -= (current.match(/\}/g) ?? []).length;
        if (started && braceDepth <= 0) break;
      }
    }

    const body = bodyLines.join("\n");
    const callRegex = /\b([A-Za-z_][A-Za-z0-9_:]*)\s*\(/g;
    for (const match of body.matchAll(callRegex)) {
      const calleeName = match[1]!;
      if (["if", "for", "while", "switch", "return", "sizeof"].includes(calleeName)) continue;
      if (calleeName === symbol.symbolName || calleeName === symbol.qualifiedName) continue;
      const relative = lineColFromIndex(body, match.index ?? 0);
      const absoluteLine = symbol.line + relative.line - 1;
      callRecords.push({
        stableKey: buildCallStableKey(input.path, absoluteLine, symbol.qualifiedName, calleeName),
        callerStableKey: symbol.stableKey,
        calleeName,
        line: absoluteLine,
        col: relative.col,
        confidence: calleeName.includes("::") ? 0.85 : 0.68,
      });
    }
  }

  const nodes: ReviewGraphNodeInput[] = [
    {
      nodeKind: "file",
      stableKey: fileStableKey,
      language: "cpp",
      attributes: { path: input.path },
      confidence: 1,
    },
  ];
  const edges: ReviewGraphEdgeInput[] = [];

  for (const symbol of dedupeByStableKey(symbolRecords)) {
    nodes.push({
      nodeKind: "symbol",
      stableKey: symbol.stableKey,
      symbolName: symbol.symbolName,
      qualifiedName: symbol.qualifiedName,
      language: "cpp",
      spanStartLine: symbol.line,
      spanStartCol: symbol.col,
      spanEndLine: symbol.endLine,
      spanEndCol: symbol.endCol,
      signature: symbol.signature,
      attributes: { kind: symbol.kind },
      confidence: 1,
    });
    edges.push({
      edgeKind: "declares",
      sourceStableKey: fileStableKey,
      targetStableKey: symbol.stableKey,
      confidence: 1,
    });

    if (symbol.probableTestConfidence !== null) {
      const testStableKey = buildTestStableKey(input.path, symbol.qualifiedName);
      nodes.push({
        nodeKind: "test",
        stableKey: testStableKey,
        symbolName: symbol.symbolName,
        qualifiedName: symbol.qualifiedName,
        language: "cpp",
        spanStartLine: symbol.line,
        spanStartCol: symbol.col,
        spanEndLine: symbol.endLine,
        spanEndCol: symbol.endCol,
        signature: symbol.signature,
        attributes: { inferred: true, heuristic: "cpp-test-name-or-path" },
        confidence: symbol.probableTestConfidence,
      });
      edges.push({
        edgeKind: "tests",
        sourceStableKey: testStableKey,
        targetStableKey: symbol.stableKey,
        confidence: symbol.probableTestConfidence,
        attributes: { heuristic: "cpp-test-name-or-path" },
      });
    }
  }

  for (const item of dedupeByStableKey(importRecords)) {
    nodes.push({
      nodeKind: "import",
      stableKey: item.stableKey,
      symbolName: item.importName,
      qualifiedName: item.target,
      language: "cpp",
      spanStartLine: item.line,
      spanStartCol: item.col,
      spanEndLine: item.line,
      spanEndCol: item.col + item.importName.length,
      attributes: { kind: item.kind, target: item.target },
      confidence: 1,
    });
    edges.push({
      edgeKind: "includes",
      sourceStableKey: fileStableKey,
      targetStableKey: item.stableKey,
      confidence: 1,
    });
  }

  const symbolBySimpleName = new Map<string, SymbolRecord>();
  for (const symbol of symbolRecords) {
    symbolBySimpleName.set(symbol.symbolName, symbol);
    symbolBySimpleName.set(symbol.qualifiedName, symbol);
  }
  const localIncludePaths = dedupeByStableKey(importRecords)
    .map((item) => item.targetPath)
    .filter((targetPath): targetPath is string => typeof targetPath === "string" && targetPath.length > 0);

  for (const call of dedupeByStableKey(callRecords)) {
    nodes.push({
      nodeKind: "callsite",
      stableKey: call.stableKey,
      symbolName: call.calleeName.split("::").at(-1) ?? call.calleeName,
      qualifiedName: call.calleeName,
      language: "cpp",
      spanStartLine: call.line,
      spanStartCol: call.col,
      spanEndLine: call.line,
      spanEndCol: call.col + call.calleeName.length,
      attributes: { callerStableKey: call.callerStableKey, calleeName: call.calleeName },
      confidence: call.confidence,
    });
    const target = symbolBySimpleName.get(call.calleeName) ?? symbolBySimpleName.get(call.calleeName.split("::").at(-1) ?? call.calleeName);
    if (target) {
      edges.push({
        edgeKind: "calls",
        sourceStableKey: call.stableKey,
        targetStableKey: target.stableKey,
        confidence: call.confidence,
        attributes: { callerStableKey: call.callerStableKey },
      });
    } else {
      const includeTargetPath = localIncludePaths[0];
      if (includeTargetPath) {
        edges.push({
          edgeKind: "calls",
          sourceStableKey: call.stableKey,
          targetStableKey: buildSymbolStableKey(includeTargetPath, call.calleeName),
          confidence: Math.min(call.confidence, 0.58),
          attributes: {
            callerStableKey: call.callerStableKey,
            crossFile: true,
            resolution: "cpp-local-include",
          },
        });
      }
    }
  }

  const finalNodes = dedupeByStableKey(nodes);
  const finalNodeKeys = new Set(finalNodes.map((node) => node.stableKey));
  const finalEdges = uniqueEdges(edges).filter((edge) =>
    finalNodeKeys.has(edge.sourceStableKey)
    && (finalNodeKeys.has(edge.targetStableKey) || edge.attributes?.crossFile === true),
  );

  return {
    file: {
      repo: input.repo,
      workspaceKey: input.workspaceKey,
      path: input.path,
      language: "cpp",
    },
    nodes: finalNodes,
    edges: finalEdges,
    metrics: countReviewGraphMetrics("cpp", finalNodes, finalEdges),
  };
}

export function extractReviewGraph(input: ExtractReviewGraphInput): ReviewGraphExtraction {
  if (input.language === "python") return extractPython(input);
  if (input.language === "cpp") return extractCpp(input);
  throw new Error(`Unsupported review graph extraction language: ${input.language}`);
}
