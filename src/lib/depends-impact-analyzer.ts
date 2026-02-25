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
import { withTimeBudget } from "./usage-analyzer.ts";

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
}) => Promise<{ exitCode: number; stdout?: { toString(): string } | string | null }>;

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
        const { $ } = await import("bun");
        return await $`git -C ${p.workspaceDir} grep -rn --max-count=100 -E ${p.pattern}`
          .quiet()
          .nothrow();
      });

    const includeResult = await withTimeBudget(
      runIncludeGrep({ workspaceDir, pattern: includePattern }),
      timeBudgetMs,
    );

    if (includeResult === null) {
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
          const { $ } = await import("bun");
          return await $`git -C ${p.workspaceDir} grep -rn --max-count=100 -E ${p.pattern} -- '*/CMakeLists.txt'`
            .quiet()
            .nothrow();
        });

      const cmakeResult = await withTimeBudget(
        runCmakeGrep({ workspaceDir, pattern: cmakePattern, pathspec: "CMakeLists.txt" }),
        Math.max(timeBudgetMs / 2, 1000),
      );

      if (cmakeResult === null) {
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
          .filter((f: any) => f.name.startsWith("Find") && f.name.endsWith(".cmake"))
          .map((f: any) => ({ name: f.name, path: f.path }));
      }
    } catch {
      // cmake/modules directory may not exist -- fail open
      return result;
    }

    if (moduleFiles.length === 0) return result;

    // Parse all modules to build dependency graph
    const modules: CmakeDependency[] = [];
    for (const file of moduleFiles) {
      try {
        const fileResponse = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: file.path,
        });

        const fileData = fileResponse.data as any;
        if (!fileData.content) continue;

        const content = Buffer.from(fileData.content, fileData.encoding ?? "base64").toString(
          "utf-8",
        );
        const moduleName = file.name.replace(".cmake", "");
        const parsed = parseCmakeFindModule(content, moduleName);
        modules.push(parsed);
      } catch {
        // Skip individual file errors
        continue;
      }
    }

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

      // Find if our library's cmake module depends on this dependent
      const ourModule = modules.find(
        (m) => m.moduleName.toLowerCase() === `find${libLower}`,
      );

      if (ourModule && ourModule.dependsOn.includes(depLibName)) {
        result.circular.push(`${libLower} <-> ${depLibName}`);
      }
    }

    return result;
  } catch (err) {
    // Fail open
    return result;
  }
}
