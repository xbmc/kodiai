import { readdir, readFile as readFileFromFs } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_PATHS = 5;
const MAX_SCAN_FILES = 400;
const MAX_TERMS = 8;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "could",
  "do",
  "for",
  "from",
  "help",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "should",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "us",
  "we",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "you",
  "your",
]);

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "tmp",
  "out",
]);

const IGNORED_BASENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
]);

const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".map",
  ".min.js",
  ".min.css",
]);

type ReadFileFn = (filePath: string) => Promise<string>;

export type IssueCodeContextPath = {
  path: string;
  line?: number;
  reason: string;
};

export type IssueCodeContextResult = {
  paths: IssueCodeContextPath[];
  contextBlock: string;
};

export type IssueCodeContextAdapters = {
  globFiles?: (workspaceDir: string) => Promise<string[]>;
  grepInFiles?: (params: {
    workspaceDir: string;
    term: string;
    filePaths: string[];
    readFile: ReadFileFn;
  }) => Promise<Array<{ path: string; line?: number }>>;
  readFile?: ReadFileFn;
};

export type BuildIssueCodeContextParams = {
  workspaceDir: string;
  question: string;
  maxPaths?: number;
  adapters?: IssueCodeContextAdapters;
};

type CandidateSignals = {
  pathTerms: Set<string>;
  contentTerms: Set<string>;
  line?: number;
};

function emptyResult(): IssueCodeContextResult {
  return { paths: [], contextBlock: "" };
}

function tokenizeQuestion(question: string): string[] {
  const rawTokens = question.toLowerCase().match(/[a-z0-9_/-]+/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const token of rawTokens) {
    const normalized = token.replace(/^[-_/]+|[-_/]+$/g, "");
    if (normalized.length <= 2) continue;
    if (STOPWORDS.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function normalizeToRepoPath(workspaceDir: string, inputPath: string): string | null {
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(workspaceDir, inputPath);
  const relativePath = path.relative(workspaceDir, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return relativePath.split(path.sep).join("/");
}

function shouldSkipPath(repoPath: string): boolean {
  const normalized = repoPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const base = parts[parts.length - 1] ?? "";

  for (const part of parts.slice(0, -1)) {
    if (IGNORED_DIRS.has(part)) return true;
  }

  if (IGNORED_BASENAMES.has(base)) return true;

  for (const ext of IGNORED_EXTENSIONS) {
    if (base.endsWith(ext)) return true;
  }

  return false;
}

async function defaultGlobFiles(workspaceDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      const repoPath = normalizeToRepoPath(workspaceDir, absolute);
      if (!repoPath) continue;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(absolute);
        continue;
      }

      if (!entry.isFile()) continue;
      if (shouldSkipPath(repoPath)) continue;
      files.push(repoPath);
    }
  }

  await walk(workspaceDir);
  return files;
}

async function defaultReadFile(filePath: string): Promise<string> {
  return readFileFromFs(filePath, "utf8");
}

async function defaultGrepInFiles(params: {
  workspaceDir: string;
  term: string;
  filePaths: string[];
  readFile: ReadFileFn;
}): Promise<Array<{ path: string; line?: number }>> {
  const matches: Array<{ path: string; line?: number }> = [];
  const searchTerm = params.term.toLowerCase();

  for (const repoPath of params.filePaths) {
    const absolutePath = path.resolve(params.workspaceDir, repoPath);

    let content: string;
    try {
      content = await params.readFile(absolutePath);
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      if (!line.toLowerCase().includes(searchTerm)) continue;

      matches.push({ path: repoPath, line: index + 1 });
      break;
    }
  }

  return matches;
}

function buildReason(pathTerms: string[], contentTerms: string[]): string {
  const parts: string[] = [];
  if (pathTerms.length > 0) {
    parts.push(`path matches: ${pathTerms.join(", ")}`);
  }
  if (contentTerms.length > 0) {
    parts.push(`content matches: ${contentTerms.join(", ")}`);
  }
  return parts.join("; ");
}

export async function buildIssueCodeContext(
  params: BuildIssueCodeContextParams,
): Promise<IssueCodeContextResult> {
  try {
    const maxPaths = Number.isInteger(params.maxPaths)
      ? Math.max(0, params.maxPaths ?? DEFAULT_MAX_PATHS)
      : DEFAULT_MAX_PATHS;

    if (maxPaths === 0) return emptyResult();

    const terms = tokenizeQuestion(params.question).slice(0, MAX_TERMS);
    if (terms.length === 0) return emptyResult();

    const adapters = params.adapters ?? {};
    const globFiles = adapters.globFiles ?? defaultGlobFiles;
    const readFile = adapters.readFile ?? defaultReadFile;
    const grepInFiles = adapters.grepInFiles ?? defaultGrepInFiles;

    const rawFilePaths = await globFiles(params.workspaceDir);
    const deduped = new Set<string>();
    const candidatePaths: string[] = [];

    for (const filePath of rawFilePaths) {
      const repoPath = normalizeToRepoPath(params.workspaceDir, filePath);
      if (!repoPath) continue;
      if (shouldSkipPath(repoPath)) continue;
      if (deduped.has(repoPath)) continue;
      deduped.add(repoPath);
      candidatePaths.push(repoPath);
    }

    candidatePaths.sort((a, b) => a.localeCompare(b));
    const scanPaths = candidatePaths.slice(0, MAX_SCAN_FILES);
    if (scanPaths.length === 0) return emptyResult();

    const signalByPath = new Map<string, CandidateSignals>();

    for (const repoPath of scanPaths) {
      const lowerPath = repoPath.toLowerCase();
      const pathTerms = terms.filter((term) => lowerPath.includes(term));
      if (pathTerms.length === 0) continue;

      signalByPath.set(repoPath, {
        pathTerms: new Set(pathTerms),
        contentTerms: new Set(),
      });
    }

    for (const term of terms) {
      const grepMatches = await grepInFiles({
        workspaceDir: params.workspaceDir,
        term,
        filePaths: scanPaths,
        readFile,
      });

      for (const match of grepMatches) {
        const repoPath = normalizeToRepoPath(params.workspaceDir, match.path);
        if (!repoPath || !scanPaths.includes(repoPath)) continue;

        const existing = signalByPath.get(repoPath) ?? {
          pathTerms: new Set<string>(),
          contentTerms: new Set<string>(),
        };
        existing.contentTerms.add(term);

        if (typeof match.line === "number" && match.line > 0) {
          existing.line =
            typeof existing.line === "number"
              ? Math.min(existing.line, match.line)
              : match.line;
        }

        signalByPath.set(repoPath, existing);
      }
    }

    const scored = [...signalByPath.entries()]
      .map(([repoPath, signal]) => {
        const pathTerms = [...signal.pathTerms].sort((a, b) => a.localeCompare(b));
        const contentTerms = [...signal.contentTerms].sort((a, b) => a.localeCompare(b));
        const pathScore = pathTerms.length;
        const contentScore = contentTerms.length;
        const score = pathScore + contentScore * 2;
        return {
          path: repoPath,
          line: signal.line,
          score,
          pathTerms,
          contentTerms,
          reason: buildReason(pathTerms, contentTerms),
        };
      })
      .filter((candidate) => candidate.reason.length > 0);

    if (scored.length === 0) return emptyResult();

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    });

    const strongestScore = scored[0]?.score ?? 0;
    if (strongestScore < 2) return emptyResult();

    const selected = scored.slice(0, maxPaths).map((candidate) => {
      const pointer: IssueCodeContextPath = {
        path: candidate.path,
        reason: candidate.reason,
      };

      if (typeof candidate.line === "number") {
        pointer.line = candidate.line;
      }

      return pointer;
    });

    if (selected.length === 0) return emptyResult();

    const contextLines = ["## Likely Code Pointers", ""];
    for (const pointer of selected) {
      const location =
        typeof pointer.line === "number"
          ? `${pointer.path}:${pointer.line}`
          : pointer.path;
      contextLines.push(`- \`${location}\` - ${pointer.reason}`);
    }

    return {
      paths: selected,
      contextBlock: `${contextLines.join("\n")}\n`,
    };
  } catch {
    return emptyResult();
  }
}
