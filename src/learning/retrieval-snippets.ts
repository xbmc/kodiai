import { readFile as readFileFromFs } from "node:fs/promises";
import path from "node:path";
import type { RetrievalResult } from "./types.ts";

const MAX_SNIPPET_CHARS = 180;

type ReadFileFn = (filePath: string) => Promise<string>;

export type SnippetAnchor = {
  path: string;
  line?: number;
  anchor: string;
  snippet?: string;
  distance: number;
};

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeFindingText(value: string): string[] {
  const normalized = normalizeForSearch(value);
  if (!normalized) {
    return [];
  }

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of normalized.split(" ")) {
    if (token.length < 3) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

function buildTokenPhrases(tokens: string[]): string[] {
  if (tokens.length < 2) {
    return [];
  }

  const phrases: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return phrases;
}

function sanitizeSnippet(line: string): string {
  const normalized = line.replace(/`/g, "'").replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_SNIPPET_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_SNIPPET_CHARS).trimEnd()}...`;
}

function findBestLineNumber(lines: string[], findingText: string): number | undefined {
  const tokens = tokenizeFindingText(findingText);
  if (tokens.length === 0) {
    return undefined;
  }

  const phrases = buildTokenPhrases(tokens);

  let bestScore = 0;
  let bestLineNumber: number | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    if (!rawLine.trim()) {
      continue;
    }

    const normalizedLine = normalizeForSearch(rawLine);
    if (!normalizedLine) {
      continue;
    }

    const tokenHits = tokens.reduce((count, token) => {
      if (normalizedLine.includes(token)) {
        return count + 1;
      }
      return count;
    }, 0);
    const phraseHits = phrases.reduce((count, phrase) => {
      if (normalizedLine.includes(phrase)) {
        return count + 1;
      }
      return count;
    }, 0);

    if (tokenHits < 2 && phraseHits === 0) {
      continue;
    }

    const score = tokenHits + phraseHits * 2;
    if (score > bestScore) {
      bestScore = score;
      bestLineNumber = index + 1;
    }
  }

  return bestLineNumber;
}

function anchorCharWeight(anchor: SnippetAnchor): number {
  return anchor.anchor.length + (anchor.snippet ? anchor.snippet.length + 3 : 0);
}

function compareByRelevance(a: SnippetAnchor, b: SnippetAnchor): number {
  if (a.distance !== b.distance) {
    return a.distance - b.distance;
  }
  if (a.path !== b.path) {
    return a.path.localeCompare(b.path);
  }
  return (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
}

function buildPathOnlyAnchor(finding: RetrievalResult): SnippetAnchor {
  return {
    path: finding.record.filePath,
    anchor: finding.record.filePath,
    line: undefined,
    snippet: undefined,
    distance: finding.distance,
  };
}

export async function buildSnippetAnchors(params: {
  workspaceDir: string;
  findings: RetrievalResult[];
  readFile?: ReadFileFn;
}): Promise<SnippetAnchor[]> {
  if (params.findings.length === 0) {
    return [];
  }

  const readFile = params.readFile ?? (async (filePath: string) => readFileFromFs(filePath, "utf8"));
  const fileCache = new Map<string, string | null>();
  const anchors: SnippetAnchor[] = [];

  for (const finding of params.findings) {
    try {
      const repoPath = finding.record.filePath;
      if (!repoPath) {
        anchors.push(buildPathOnlyAnchor(finding));
        continue;
      }

      const absolutePath = path.resolve(params.workspaceDir, repoPath);
      const relativeFromWorkspace = path.relative(params.workspaceDir, absolutePath);
      if (relativeFromWorkspace.startsWith("..") || path.isAbsolute(relativeFromWorkspace)) {
        anchors.push(buildPathOnlyAnchor(finding));
        continue;
      }

      let fileContent: string | null;
      if (fileCache.has(repoPath)) {
        fileContent = fileCache.get(repoPath) ?? null;
      } else {
        try {
          fileContent = await readFile(absolutePath);
          fileCache.set(repoPath, fileContent);
        } catch {
          fileCache.set(repoPath, null);
          fileContent = null;
        }
      }

      if (!fileContent) {
        anchors.push(buildPathOnlyAnchor(finding));
        continue;
      }

      const lines = fileContent.split(/\r?\n/);
      const lineNumber = findBestLineNumber(lines, finding.record.findingText);
      if (!lineNumber) {
        anchors.push(buildPathOnlyAnchor(finding));
        continue;
      }

      const lineText = lines[lineNumber - 1] ?? "";
      const snippet = sanitizeSnippet(lineText);
      anchors.push({
        path: repoPath,
        line: lineNumber,
        anchor: `${repoPath}:${lineNumber}`,
        snippet: snippet || undefined,
        distance: finding.distance,
      });
    } catch {
      anchors.push(buildPathOnlyAnchor(finding));
    }
  }

  return anchors;
}

export function trimSnippetAnchorsToBudget(params: {
  anchors: SnippetAnchor[];
  maxChars: number;
  maxItems: number;
}): SnippetAnchor[] {
  if (params.anchors.length === 0) {
    return [];
  }

  if (params.maxItems <= 0 || params.maxChars <= 0) {
    return [];
  }

  const sorted = [...params.anchors].sort(compareByRelevance);
  const byItemCap = sorted.slice(0, params.maxItems);
  const trimmed = [...byItemCap];

  let totalChars = trimmed.reduce((count, anchor) => count + anchorCharWeight(anchor), 0);
  while (trimmed.length > 0 && totalChars > params.maxChars) {
    const removed = trimmed.pop();
    if (!removed) {
      break;
    }
    totalChars -= anchorCharWeight(removed);
  }

  return trimmed;
}
