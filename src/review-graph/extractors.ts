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
    const key = JSON.stringify([
      edge.edgeKind,
      edge.sourceStableKey,
      edge.targetStableKey,
      edge.confidence ?? null,
      edge.attributes ?? {},
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
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

  const classMatches = Array.from(input.content.matchAll(/^([ \t]*)class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*:/gm));
  const classByIndent = new Map<number, string>();
  for (const match of classMatches) {
    const indent = match[1]?.length ?? 0;
    classByIndent.set(indent, match[2]!);
  }

  const lines = input.content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

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
        importRecords.push({
          stableKey: buildImportStableKey(input.path, lineNo, `${moduleName}.${part}`),
          importName: part,
          target: moduleName,
          line: lineNo,
          col: line.indexOf(part) + 1,
          kind: "import",
        });
      }
    }

    const defMatch = line.match(/^([ \t]*)def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/);
    if (defMatch) {
      const indent = defMatch[1]?.length ?? 0;
      let containerName: string | undefined;
      for (const [classIndent, className] of Array.from(classByIndent.entries()).sort((a, b) => b[0] - a[0])) {
        if (classIndent < indent) {
          containerName = className;
          break;
        }
      }

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
      const absoluteLine = symbol.line + relative.line - 1;
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
    }
  }

  const finalNodes = dedupeByStableKey(nodes);
  const finalEdges = uniqueEdges(edges).filter((edge) =>
    finalNodes.some((node) => node.stableKey === edge.sourceStableKey)
    && finalNodes.some((node) => node.stableKey === edge.targetStableKey),
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
    metrics: {
      language: "python",
      fileNodeCount: finalNodes.filter((node) => node.nodeKind === "file").length,
      symbolNodeCount: finalNodes.filter((node) => node.nodeKind === "symbol").length,
      importNodeCount: finalNodes.filter((node) => node.nodeKind === "import").length,
      callsiteNodeCount: finalNodes.filter((node) => node.nodeKind === "callsite").length,
      testNodeCount: finalNodes.filter((node) => node.nodeKind === "test").length,
      probableEdgeCount: finalEdges.filter((edge) => (edge.confidence ?? 1) < 1).length,
    },
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

    const includeMatch = line.match(/^\s*#include\s+[<"]([^>"]+)[>"]/);
    if (includeMatch) {
      const target = includeMatch[1]!;
      importRecords.push({
        stableKey: buildImportStableKey(input.path, lineNo, target),
        importName: target,
        target,
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
    const bodyStart = lines.findIndex((line, idx) => idx + 1 >= symbol.line && line.includes(symbol.qualifiedName.split("::").at(-1) ?? symbol.qualifiedName));
    if (bodyStart === -1) continue;

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
    }
  }

  const finalNodes = dedupeByStableKey(nodes);
  const finalEdges = uniqueEdges(edges).filter((edge) =>
    finalNodes.some((node) => node.stableKey === edge.sourceStableKey)
    && finalNodes.some((node) => node.stableKey === edge.targetStableKey),
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
    metrics: {
      language: "cpp",
      fileNodeCount: finalNodes.filter((node) => node.nodeKind === "file").length,
      symbolNodeCount: finalNodes.filter((node) => node.nodeKind === "symbol").length,
      importNodeCount: finalNodes.filter((node) => node.nodeKind === "import").length,
      callsiteNodeCount: finalNodes.filter((node) => node.nodeKind === "callsite").length,
      testNodeCount: finalNodes.filter((node) => node.nodeKind === "test").length,
      probableEdgeCount: finalEdges.filter((edge) => (edge.confidence ?? 1) < 1).length,
    },
  };
}

export function extractReviewGraph(input: ExtractReviewGraphInput): ReviewGraphExtraction {
  if (input.language === "python") return extractPython(input);
  if (input.language === "cpp") return extractCpp(input);
  throw new Error(`Unsupported review graph extraction language: ${input.language}`);
}
