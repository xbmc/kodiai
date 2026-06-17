/**
 * [depends] Dependency Impact Analysis Module
 *
 * Provides #include tracing, cmake dependency parsing, and transitive
 * dependency detection for Kodi-convention [depends] dependency bump PRs.
 *
 * All functions follow the fail-open pattern: catch errors, return
 * degradation results, never throw.
 *
 * @module depends-impact-analyzer
 */

import type { Octokit } from "@octokit/rest";
import { runCommandWithCappedOutput } from "./capped-process.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import { withTimeBudget } from "./usage-analyzer.ts";

const MODULE_CONTENT_FETCH_CONCURRENCY = 4;

// ─── Types ──────────────────────────────────────────────────────────────────

export type IncludeConsumer = {
  filePath: string;
  line: number;
  includeDirective: string;
  isDirect: boolean; // true = directly includes library, false = transitive (one level)
};

export type CmakeDependency = {
  moduleName: string; // e.g., "FindHarfBuzz"
  dependsOn: string[]; // e.g., ["freetype", "icu"]
};

export type TransitiveResult = {
  dependents: string[]; // libraries that depend on the bumped library
  newDependencies: string[]; // new find_dependency() calls not in old version
  circular: string[]; // circular dependency pairs detected
};

export type ImpactResult = {
  consumers: IncludeConsumer[];
  transitive: TransitiveResult;
  timeLimitReached: boolean;
  degradationNote: string | null;
};

// ─── Git Grep Output Parser ─────────────────────────────────────────────────

function parseGrepOutput(stdout: string): Array<{ filePath: string; line: number; snippet: string }> {
  const results: Array<{ filePath: string; line: number; snippet: string }> = [];
  const lines = stdout.split("\n").filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) continue;
    results.push({
      filePath: match[1]!,
      line: parseInt(match[2]!, 10),
      snippet: (match[3] ?? "").trim(),
    });
  }

  return results;
}

// ─── findDependencyConsumers ─────────────────────────────────────────────────

type GrepRunner = (params: {
  workspaceDir: string;
  pattern: string;
  pathspec?: string;
}) => Promise<{ exitCode: number; timedOut?: boolean; stdout?: { toString(): string } | string | null }>;

type RepoContentEntry = {
  name?: unknown;
  path?: unknown;
  content?: unknown;
  encoding?: unknown;
};

function isFindModuleEntry(entry: RepoContentEntry): entry is { name: string; path: string } {
  return typeof entry.name === "string" &&
    typeof entry.path === "string" &&
    entry.name.startsWith("Find") &&
    entry.name.endsWith(".cmake");
}

/**
 * Find files in the workspace that consume a given library via #include
 * or cmake target_link_libraries.
 *
 * Uses git grep for discovery. Respects a time budget and returns partial
 * results on timeout. Never throws.
 */
export async function findDependencyConsumers(params: {
  workspaceDir: string;
  libraryName: string;
  octokit: Octokit;
  owner: string;
  repo: string;
  timeBudgetMs?: number;
  /** Test-only hook for #include grep */
  __runGrepForTests?: GrepRunner;
  /** Test-only hook for cmake grep */
  __runCmakeGrepForTests?: GrepRunner;
}): Promise<ImpactResult> {
  const {
    workspaceDir,
    libraryName,
    timeBudgetMs = 5000,
    __runGrepForTests,
    __runCmakeGrepForTests,
  } = params;

  const consumers: IncludeConsumer[] = [];
  let timeLimitReached = false;
  const seenPaths = new Set<string>();

  const libLower = libraryName.toLowerCase();

  try {
    // --- #include pass ---
    const includePattern = `#include.*[<"]${libraryName}[/.]`;

    const runIncludeGrep: GrepRunner =
      __runGrepForTests ??
      (async (p) => {
        return await runCommandWithCappedOutput({
          command: "git",
          args: ["grep", "-rn", "--max-count=100", "-E", p.pattern],
          cwd: p.workspaceDir,
          timeoutMs: timeBudgetMs,
          maxStdoutBytes: 256 * 1024,
          maxStderrBytes: 64 * 1024,
          env: { GIT_TERMINAL_PROMPT: "0" },
        });
      });

    const includePromise = runIncludeGrep({ workspaceDir, pattern: includePattern });
    const includeResult = __runGrepForTests
      ? await withTimeBudget(includePromise, timeBudgetMs)
      : await includePromise;

    if (includeResult === null || includeResult.timedOut) {
      timeLimitReached = true;
    } else if (includeResult.exitCode === 0 && includeResult.stdout) {
      const stdoutText =
        typeof includeResult.stdout === "string"
          ? includeResult.stdout
          : includeResult.stdout.toString();

      const parsed = parseGrepOutput(stdoutText);
      for (const entry of parsed) {
        // Filter: the snippet must actually reference this library
        if (!entry.snippet.toLowerCase().includes(libLower)) continue;

        seenPaths.add(entry.filePath);
        consumers.push({
          filePath: entry.filePath,
          line: entry.line,
          includeDirective: entry.snippet,
          isDirect: true,
        });
      }
    }

    // --- cmake target_link_libraries pass ---
    if (!timeLimitReached) {
      const cmakePattern = `target_link_libraries.*${libraryName}`;

      const runCmakeGrep: GrepRunner =
        __runCmakeGrepForTests ??
        (async (p) => {
          return await runCommandWithCappedOutput({
            command: "git",
            args: ["grep", "-rn", "--max-count=100", "-E", p.pattern, "--", p.pathspec ?? "*/CMakeLists.txt"],
            cwd: p.workspaceDir,
            timeoutMs: Math.max(timeBudgetMs / 2, 1000),
            maxStdoutBytes: 256 * 1024,
            maxStderrBytes: 64 * 1024,
            env: { GIT_TERMINAL_PROMPT: "0" },
          });
        });

      const cmakeBudgetMs = Math.max(timeBudgetMs / 2, 1000);
      const cmakePromise = runCmakeGrep({ workspaceDir, pattern: cmakePattern, pathspec: "*/CMakeLists.txt" });
      const cmakeResult = __runCmakeGrepForTests
        ? await withTimeBudget(cmakePromise, cmakeBudgetMs)
        : await cmakePromise;

      if (cmakeResult === null || cmakeResult.timedOut) {
        timeLimitReached = true;
      } else if (cmakeResult.exitCode === 0 && cmakeResult.stdout) {
        const stdoutText =
          typeof cmakeResult.stdout === "string"
            ? cmakeResult.stdout
            : cmakeResult.stdout.toString();

        const parsed = parseGrepOutput(stdoutText);
        for (const entry of parsed) {
          // Deduplicate: skip if file already seen in #include pass
          if (seenPaths.has(entry.filePath)) continue;
          seenPaths.add(entry.filePath);

          consumers.push({
            filePath: entry.filePath,
            line: entry.line,
            includeDirective: entry.snippet,
            isDirect: true,
          });
        }
      }
    }

    return {
      consumers,
      transitive: { dependents: [], newDependencies: [], circular: [] },
      timeLimitReached,
      degradationNote: null,
    };
  } catch (err) {
    return {
      consumers,
      transitive: { dependents: [], newDependencies: [], circular: [] },
      timeLimitReached,
      degradationNote: `Impact analysis error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── parseCmakeFindModule ────────────────────────────────────────────────────

/**
 * Parse cmake Find module content for dependency declarations.
 *
 * Extracts find_dependency() and find_package() calls, normalizes
 * package names to lowercase.
 */
export function parseCmakeFindModule(content: string, moduleName: string): CmakeDependency {
  const dependsOn: string[] = [];

  // Match find_dependency(XXX) and find_package(XXX ...)
  const findDepRe = /^\s*find_dependency\(\s*(\w+)/gm;
  const findPkgRe = /^\s*find_package\(\s*(\w+)/gm;

  for (const match of content.matchAll(findDepRe)) {
    dependsOn.push(match[1]!.toLowerCase());
  }

  for (const match of content.matchAll(findPkgRe)) {
    dependsOn.push(match[1]!.toLowerCase());
  }

  return { moduleName, dependsOn };
}

// ─── checkTransitiveDependencies ─────────────────────────────────────────────

/**
 * Check for transitive dependency relationships in cmake modules.
 *
 * Fetches cmake Find*.cmake modules from the repo, parses them for
 * dependencies, identifies dependents of the bumped library, detects
 * circular dependencies, and compares old/new cmake content for new deps.
 *
 * Fails open: on any error returns empty results with note.
 */
export async function checkTransitiveDependencies(params: {
  libraryName: string;
  octokit: Octokit;
  owner: string;
  repo: string;
  oldCmakeContent?: string;
  newCmakeContent?: string;
}): Promise<TransitiveResult> {
  const { libraryName, octokit, owner, repo, oldCmakeContent, newCmakeContent } = params;
  const libLower = libraryName.toLowerCase();

  const result: TransitiveResult = {
    dependents: [],
    newDependencies: [],
    circular: [],
  };

  try {
    // --- Detect new dependencies from old/new cmake content comparison ---
    if (oldCmakeContent && newCmakeContent) {
      const oldDeps = parseCmakeFindModule(oldCmakeContent, "old").dependsOn;
      const newDeps = parseCmakeFindModule(newCmakeContent, "new").dependsOn;
      const oldSet = new Set(oldDeps);

      for (const dep of newDeps) {
        if (!oldSet.has(dep)) {
          result.newDependencies.push(dep);
        }
      }
    }

    // --- Fetch cmake modules from repo ---
    let moduleFiles: Array<{ name: string; path: string }> = [];
    try {
      const dirResponse = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "cmake/modules",
      });

      if (Array.isArray(dirResponse.data)) {
        moduleFiles = dirResponse.data
          .filter(isFindModuleEntry)
          .map((f) => ({ name: f.name, path: f.path }));
      }
    } catch {
      // cmake/modules directory may not exist -- fail open
      return result;
    }

    if (moduleFiles.length === 0) return result;

    // Parse all modules to build dependency graph
    const fetchedModules = await mapWithConcurrency(
      moduleFiles,
      MODULE_CONTENT_FETCH_CONCURRENCY,
      async (file) => {
        try {
          const fileResponse = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: file.path,
          });

          const fileData = fileResponse.data as RepoContentEntry;
          if (typeof fileData.content !== "string") return null;

          const encoding: BufferEncoding = fileData.encoding === "utf-8" ? "utf-8" : "base64";
          const content = Buffer.from(fileData.content, encoding).toString(
            "utf-8",
          );
          const moduleName = file.name.replace(".cmake", "");
          const parsed = parseCmakeFindModule(content, moduleName);
          return parsed;
        } catch {
          // Skip individual file errors
          return null;
        }
      },
    );
    const modules = fetchedModules.filter((module): module is CmakeDependency => module !== null);
    const moduleByName = new Map(
      modules.map((module) => [module.moduleName.toLowerCase(), module] as const),
    );
    const ourModule = moduleByName.get(`find${libLower}`);
    const ourModuleDependencies = new Set(ourModule?.dependsOn ?? []);

    // --- Find dependents: modules that list the bumped library in their deps ---
    for (const mod of modules) {
      if (mod.dependsOn.includes(libLower)) {
        result.dependents.push(mod.moduleName);
      }
    }

    // --- Detect circular dependencies ---
    // For each module that depends on our library, check if our library
    // (via its Find module) depends back on them
    for (const dependent of result.dependents) {
      // Extract the library name from the Find module name (e.g., FindHarfBuzz -> harfbuzz)
      const depLibName = dependent.replace(/^Find/, "").toLowerCase();

      if (ourModuleDependencies.has(depLibName)) {
        result.circular.push(`${libLower} <-> ${depLibName}`);
      }
    }

    return result;
  } catch (err) {
    // Fail open
    return result;
  }
}
