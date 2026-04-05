import picomatch from "picomatch";
import { createHash } from "node:crypto";
import { classifyFileLanguage } from "../execution/diff-analysis.ts";
import type { CanonicalChunkType } from "./canonical-code-types.ts";

export type CanonicalChunk = {
  filePath: string;
  language: string;
  chunkType: CanonicalChunkType;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  chunkText: string;
  contentHash: string;
};

export type CanonicalExclusionReason =
  | "generated"
  | "vendored"
  | "lockfile"
  | "build_output"
  | "binary_or_asset";

export type CanonicalChunkBoundary = "function" | "class" | "module" | "block";

export type CanonicalChunkerObservability = {
  excluded: boolean;
  exclusionReason: CanonicalExclusionReason | null;
  boundaryDecisions: CanonicalChunkBoundary[];
};

export type CanonicalChunkResult = {
  chunks: CanonicalChunk[];
  observability: CanonicalChunkerObservability;
};

export const DEFAULT_CANONICAL_CODE_EXCLUDE_PATTERNS: Record<CanonicalExclusionReason, string[]> = {
  generated: [
    "**/generated/**",
    "**/__generated__/**",
    "**/gen/**",
    "**/*.generated.*",
    "**/*.g.dart",
    "**/*.pb.*",
    "**/moc_*.cpp",
    "**/ui_*.h",
    "**/qrc_*.cpp",
  ],
  vendored: [
    "**/vendor/**",
    "**/vendors/**",
    "**/third_party/**",
    "**/third-party/**",
    "**/external/**",
    "**/extern/**",
    "**/deps/**",
    "**/submodules/**",
    "**/node_modules/**",
  ],
  lockfile: [
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/bun.lock",
    "**/bun.lockb",
    "**/Cargo.lock",
    "**/Gemfile.lock",
    "**/Pipfile.lock",
    "**/poetry.lock",
    "**/composer.lock",
    "**/go.sum",
  ],
  build_output: [
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/target/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/coverage/**",
    "**/bin/**",
    "**/obj/**",
  ],
  binary_or_asset: [
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.webp",
    "**/*.svg",
    "**/*.ico",
    "**/*.pdf",
    "**/*.zip",
    "**/*.tar",
    "**/*.gz",
    "**/*.7z",
    "**/*.mp3",
    "**/*.mp4",
    "**/*.mov",
    "**/*.ttf",
    "**/*.woff",
    "**/*.woff2",
    "**/*.so",
    "**/*.dll",
    "**/*.dylib",
    "**/*.o",
    "**/*.a",
    "**/*.pyc",
  ],
};

const PYTHON_FUNCTION_RE = /^(?<indent>\s*)(?:async\s+)?def\s+(?<name>[A-Za-z_][\w]*)\s*\(/;
const PYTHON_CLASS_RE = /^(?<indent>\s*)class\s+(?<name>[A-Za-z_][\w]*)\b/;
const TS_FUNCTION_RE = /^(?<indent>\s*)(?:export\s+)?(?:async\s+)?function\s+(?<name>[A-Za-z_$][\w$]*)\s*\(/;
const TS_CLASS_RE = /^(?<indent>\s*)(?:export\s+)?(?:abstract\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)\b/;
const CPP_FUNCTION_RE = /^(?<indent>\s*)(?:(?:inline|static|virtual|constexpr|friend|template\s*<[^>]+>)\s+)*(?:[\w:&*<>,~]+\s+)+(?<name>[A-Za-z_~][\w:]*)\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:->\s*[^\s{]+\s*)?\{/;
const CPP_CLASS_RE = /^(?<indent>\s*)(?:template\s*<[^>]+>\s*)?(?:class|struct)\s+(?<name>[A-Za-z_][\w]*)\b[^;{]*\{/;

function countIndent(line: string): number {
  let count = 0;
  for (const char of line) {
    if (char === " ") count += 1;
    else if (char === "\t") count += 2;
    else break;
  }
  return count;
}

function joinChunkText(lines: string[]): string {
  return lines.join("\n").trim();
}

function computeContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function detectExclusionReason(filePath: string): CanonicalExclusionReason | null {
  for (const [reason, patterns] of Object.entries(DEFAULT_CANONICAL_CODE_EXCLUDE_PATTERNS) as Array<[
    CanonicalExclusionReason,
    string[],
  ]>) {
    if (patterns.length === 0) continue;
    const matcher = picomatch(patterns, { dot: true });
    if (matcher(filePath)) return reason;
  }
  return null;
}

export function getCanonicalChunkExclusionReason(filePath: string): CanonicalExclusionReason | null {
  return detectExclusionReason(filePath);
}

export function isCanonicalCodePathExcluded(filePath: string): boolean {
  return detectExclusionReason(filePath) !== null;
}

function createChunk(params: {
  filePath: string;
  language: string;
  chunkType: CanonicalChunkType;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  lines: string[];
}): CanonicalChunk | null {
  const chunkText = joinChunkText(params.lines);
  if (!chunkText) return null;
  return {
    filePath: params.filePath,
    language: params.language,
    chunkType: params.chunkType,
    symbolName: params.symbolName,
    startLine: params.startLine,
    endLine: params.endLine,
    chunkText,
    contentHash: computeContentHash(chunkText),
  };
}

function chunkPythonFile(filePath: string, language: string, lines: string[]): CanonicalChunkResult {
  const chunks: CanonicalChunk[] = [];
  const boundaries: CanonicalChunkBoundary[] = [];
  let moduleFirstLine = -1;
  let moduleLastLine = -1;
  const consumed = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const classMatch = PYTHON_CLASS_RE.exec(line);
    const functionMatch = PYTHON_FUNCTION_RE.exec(line);

    if (!classMatch && !functionMatch) {
      if (trimmed) {
        if (moduleFirstLine === -1) moduleFirstLine = i + 1;
        moduleLastLine = i + 1;
      }
      continue;
    }

    const indent = countIndent(line);
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j]!;
      const candidateTrimmed = candidate.trim();
      if (!candidateTrimmed) {
        end = j;
        continue;
      }
      if (countIndent(candidate) <= indent) break;
      end = j;
    }

    const chunk = createChunk({
      filePath,
      language,
      chunkType: classMatch ? "class" : "function",
      symbolName: (classMatch?.groups?.name ?? functionMatch?.groups?.name) ?? null,
      startLine: i + 1,
      endLine: end + 1,
      lines: lines.slice(i, end + 1),
    });
    if (chunk) {
      chunks.push(chunk);
      boundaries.push(classMatch ? "class" : "function");
      for (let j = i; j <= end; j++) consumed.add(j);
    }
    i = end;
  }

  const moduleLines: string[] = [];
  if (moduleFirstLine !== -1) {
    for (let i = moduleFirstLine - 1; i < moduleLastLine; i++) {
      if (consumed.has(i)) continue;
      moduleLines.push(lines[i]!);
    }
  }
  const moduleChunk = moduleLines.some((line) => line.trim())
    ? createChunk({
        filePath,
        language,
        chunkType: "module",
        symbolName: null,
        startLine: moduleFirstLine === -1 ? 1 : moduleFirstLine,
        endLine: moduleLastLine === -1 ? lines.length : moduleLastLine,
        lines: moduleLines,
      })
    : null;
  if (moduleChunk) {
    chunks.unshift(moduleChunk);
    boundaries.unshift("module");
  }

  if (chunks.length === 0) {
    const blockChunk = createChunk({
      filePath,
      language,
      chunkType: "block",
      symbolName: null,
      startLine: 1,
      endLine: lines.length,
      lines,
    });
    return {
      chunks: blockChunk ? [blockChunk] : [],
      observability: {
        excluded: false,
        exclusionReason: null,
        boundaryDecisions: blockChunk ? ["block"] : [],
      },
    };
  }

  return {
    chunks,
    observability: {
      excluded: false,
      exclusionReason: null,
      boundaryDecisions: boundaries,
    },
  };
}

function scanBraceBoundBlock(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawOpening = false;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]!;
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        sawOpening = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (sawOpening && depth <= 0) return i;
  }
  return lines.length - 1;
}

function chunkBraceLanguageFile(filePath: string, language: string, lines: string[]): CanonicalChunkResult {
  const chunks: CanonicalChunk[] = [];
  const boundaries: CanonicalChunkBoundary[] = [];
  const consumed = new Set<number>();

  const classRegex = language === "TypeScript" || language === "JavaScript" ? TS_CLASS_RE : CPP_CLASS_RE;
  const functionRegex = language === "TypeScript" || language === "JavaScript" ? TS_FUNCTION_RE : CPP_FUNCTION_RE;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const classMatch = classRegex.exec(line);
    const functionMatch = classMatch ? null : functionRegex.exec(line);
    if (!classMatch && !functionMatch) continue;

    const end = scanBraceBoundBlock(lines, i);
    const chunk = createChunk({
      filePath,
      language,
      chunkType: classMatch ? "class" : "function",
      symbolName: (classMatch?.groups?.name ?? functionMatch?.groups?.name ?? null)?.split("::").pop() ?? null,
      startLine: i + 1,
      endLine: end + 1,
      lines: lines.slice(i, end + 1),
    });
    if (chunk) {
      chunks.push(chunk);
      boundaries.push(classMatch ? "class" : "function");
      for (let j = i; j <= end; j++) consumed.add(j);
    }
    i = end;
  }

  if (chunks.length === 0) {
    const blockChunk = createChunk({
      filePath,
      language,
      chunkType: "block",
      symbolName: null,
      startLine: 1,
      endLine: lines.length,
      lines,
    });
    return {
      chunks: blockChunk ? [blockChunk] : [],
      observability: {
        excluded: false,
        exclusionReason: null,
        boundaryDecisions: blockChunk ? ["block"] : [],
      },
    };
  }

  const moduleLines = lines.filter((_, index) => !consumed.has(index));
  const moduleChunk = moduleLines.some((line) => line.trim())
    ? createChunk({
        filePath,
        language,
        chunkType: "module",
        symbolName: null,
        startLine: 1,
        endLine: lines.length,
        lines: moduleLines,
      })
    : null;

  if (moduleChunk) {
    chunks.unshift(moduleChunk);
    boundaries.unshift("module");
  }

  return {
    chunks,
    observability: {
      excluded: false,
      exclusionReason: null,
      boundaryDecisions: boundaries,
    },
  };
}

export function chunkCanonicalCodeFile(params: { filePath: string; fileContent: string }): CanonicalChunkResult {
  const exclusionReason = detectExclusionReason(params.filePath);
  if (exclusionReason) {
    return {
      chunks: [],
      observability: {
        excluded: true,
        exclusionReason,
        boundaryDecisions: [],
      },
    };
  }

  const language = classifyFileLanguage(params.filePath);
  const lines = params.fileContent.replace(/\r\n/g, "\n").split("\n");

  if (!params.fileContent.trim()) {
    return {
      chunks: [],
      observability: {
        excluded: false,
        exclusionReason: null,
        boundaryDecisions: [],
      },
    };
  }

  if (language === "Python") {
    return chunkPythonFile(params.filePath, language, lines);
  }

  if (language === "C++" || language === "TypeScript" || language === "JavaScript") {
    return chunkBraceLanguageFile(params.filePath, language, lines);
  }

  const moduleChunk = createChunk({
    filePath: params.filePath,
    language,
    chunkType: "module",
    symbolName: null,
    startLine: 1,
    endLine: lines.length,
    lines,
  });
  return {
    chunks: moduleChunk ? [moduleChunk] : [],
    observability: {
      excluded: false,
      exclusionReason: null,
      boundaryDecisions: moduleChunk ? ["module"] : [],
    },
  };
}
