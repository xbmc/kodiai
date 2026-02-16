import { $ } from "bun";

export type UsageEvidence = {
  filePath: string;
  line: number;
  snippet: string;
};

export type UsageAnalysisResult = {
  evidence: UsageEvidence[];
  searchTerms: string[];
  timedOut: boolean;
};

/**
 * Build a set of search terms from the package name and breaking change snippets.
 *
 * Notes:
 * - Always includes the bare package name so we can at least find imports.
 * - Extracts dot-call patterns like `foo.bar()` and backtick-wrapped identifiers.
 */
export function buildSearchTerms(packageName: string, snippets: string[]): string[] {
  const terms = new Set<string>();

  if (packageName && packageName.trim()) {
    terms.add(packageName.trim());
  }

  const dotCallRe = /\b[a-zA-Z_]\w*(?:\.\w+)+\(\)/g;
  const backtickRe = /`([^`]+)`/g;

  for (const snippet of snippets) {
    if (!snippet) continue;

    for (const match of snippet.matchAll(dotCallRe)) {
      const term = match[0]?.trim();
      if (term) terms.add(term);
    }

    for (const match of snippet.matchAll(backtickRe)) {
      const term = match[1]?.trim();
      if (term) terms.add(term);
    }
  }

  return Array.from(terms);
}

export function parseGitGrepOutput(stdout: string): UsageEvidence[] {
  const evidence: UsageEvidence[] = [];
  const lines = stdout.split("\n").filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) continue;

    evidence.push({
      filePath: match[1]!,
      line: parseInt(match[2]!, 10),
      snippet: (match[3] ?? "").trim(),
    });
  }

  return evidence;
}

export async function withTimeBudget<T>(promise: Promise<T>, timeBudgetMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeBudgetMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Grep the workspace for imports/usage of a specific package.
 *
 * - Respects a time budget (default 3s) and returns timedOut=true if exceeded.
 * - Fails open: returns empty evidence on any error path and never throws.
 */
export async function analyzePackageUsage(params: {
  workspaceDir: string;
  packageName: string;
  breakingChangeSnippets: string[];
  ecosystem: string;
  timeBudgetMs?: number;
  /** Test-only hook for deterministic timeout testing. */
  __runGrepForTests?: (params: { workspaceDir: string; pattern: string }) => Promise<{
    exitCode: number;
    stdout?: { toString(): string } | string | null;
  }>;
}): Promise<UsageAnalysisResult> {
  const {
    workspaceDir,
    packageName,
    breakingChangeSnippets,
    ecosystem: _ecosystem,
    timeBudgetMs = 3000,
    __runGrepForTests,
  } = params;

  const searchTerms = buildSearchTerms(packageName, breakingChangeSnippets);
  if (searchTerms.length === 0) {
    return { evidence: [], searchTerms: [], timedOut: false };
  }

  const pattern = searchTerms.join("\\|");

  try {
    const runGrep =
      __runGrepForTests ??
      (async (p: { workspaceDir: string; pattern: string }) => {
        return await $`git -C ${p.workspaceDir} grep -rn --max-count=20 ${p.pattern}`
          .quiet()
          .nothrow();
      });

    const grepPromise = runGrep({ workspaceDir, pattern });

    const result = await withTimeBudget(grepPromise, timeBudgetMs);
    if (result === null) {
      return { evidence: [], searchTerms, timedOut: true };
    }

    if (result.exitCode !== 0 || !result.stdout) {
      return { evidence: [], searchTerms, timedOut: false };
    }

    const stdoutText =
      typeof result.stdout === "string" ? result.stdout : result.stdout.toString();
    const evidence = parseGitGrepOutput(stdoutText).slice(0, 20);
    return { evidence, searchTerms, timedOut: false };
  } catch {
    return { evidence: [], searchTerms, timedOut: false };
  }
}
