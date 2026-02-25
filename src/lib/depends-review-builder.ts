/**
 * [depends] Structured Review Comment Builder
 *
 * Builds structured markdown review comments for Kodi-convention [depends]
 * dependency bump PRs. Includes TL;DR verdict, version diff table, changelog
 * highlights, impact assessment, hash verification, and inline comments.
 *
 * @module depends-review-builder
 */

import type { DependsBumpInfo } from "./depends-bump-detector.ts";
import type {
  VersionFileDiff,
  DependsChangelogContext,
  HashVerificationResult,
  PatchChange,
} from "./depends-bump-enrichment.ts";
import type { ImpactResult, TransitiveResult } from "./depends-impact-analyzer.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DependsVerdict = {
  level: "safe" | "risky" | "needs-attention";
  emoji: string;
  label: string;
  summary: string;
};

export type DependsReviewData = {
  info: DependsBumpInfo;
  versionDiffs: Array<{
    packageName: string;
    oldVersion: string | null;
    newVersion: string | null;
    versionFileDiff: VersionFileDiff | null;
  }>;
  changelogs: Array<{ packageName: string; changelog: DependsChangelogContext }>;
  hashResults: Array<{ packageName: string; result: HashVerificationResult }>;
  patchChanges: PatchChange[];
  impact: ImpactResult | null;
  transitive: TransitiveResult | null;
  retrievalContext: string | null;
  platform: string | null;
};

export type InlineComment = {
  path: string;
  line: number;
  body: string;
};

// ─── Verdict Computation ────────────────────────────────────────────────────

/**
 * Compute a heuristic-based verdict for the dependency bump.
 *
 * - "safe": no breaking changes, no hash mismatches, no new transitive deps, < 5 consumers
 * - "needs-attention": has breaking changes OR new transitive deps OR > 5 consumers OR hash unavailable
 * - "risky": hash mismatch OR breaking changes + many consumers OR patch removals
 */
export function computeDependsVerdict(data: DependsReviewData): DependsVerdict {
  const hasHashMismatch = data.hashResults.some(
    (h) => h.result.status === "mismatch",
  );
  const hasBreakingChanges = data.changelogs.some(
    (c) => c.changelog.breakingChanges.length > 0,
  );
  const hasNewTransitiveDeps =
    (data.transitive?.newDependencies?.length ?? 0) > 0;
  const consumerCount = data.impact?.consumers?.length ?? 0;
  const hasPatchRemovals = data.patchChanges.some(
    (p) => p.action === "removed",
  );
  const hasHashUnavailable = data.hashResults.some(
    (h) => h.result.status === "unavailable",
  );

  // Risky: hash mismatch, or breaking changes + many consumers, or patch removals
  if (hasHashMismatch) {
    return {
      level: "risky",
      emoji: "\u{1F6D1}",
      label: "Risky \u2014 review carefully",
      summary: "SHA512 hash mismatch detected against upstream tarball.",
    };
  }

  if (hasBreakingChanges && consumerCount > 5) {
    return {
      level: "risky",
      emoji: "\u{1F6D1}",
      label: "Risky \u2014 review carefully",
      summary: `Breaking changes detected with ${consumerCount} consuming files.`,
    };
  }

  if (hasPatchRemovals) {
    return {
      level: "risky",
      emoji: "\u{1F6D1}",
      label: "Risky \u2014 review carefully",
      summary: "Patches removed \u2014 verify they are no longer needed for the new version.",
    };
  }

  // Needs attention: breaking changes, new transitive deps, many consumers, hash unavailable
  if (hasBreakingChanges) {
    return {
      level: "needs-attention",
      emoji: "\u26A0\uFE0F",
      label: "Needs attention",
      summary: "Breaking changes reported in upstream changelog.",
    };
  }

  if (hasNewTransitiveDeps) {
    return {
      level: "needs-attention",
      emoji: "\u26A0\uFE0F",
      label: "Needs attention",
      summary: `New transitive dependencies introduced: ${data.transitive!.newDependencies.join(", ")}.`,
    };
  }

  if (consumerCount > 5) {
    return {
      level: "needs-attention",
      emoji: "\u26A0\uFE0F",
      label: "Needs attention",
      summary: `${consumerCount} files consume this library \u2014 broad impact.`,
    };
  }

  if (hasHashUnavailable) {
    return {
      level: "needs-attention",
      emoji: "\u26A0\uFE0F",
      label: "Needs attention",
      summary: "Hash verification could not be completed \u2014 upstream tarball unavailable.",
    };
  }

  // Safe
  return {
    level: "safe",
    emoji: "\u2705",
    label: "Safe to merge",
    summary: "No breaking changes, hashes verified, limited impact scope.",
  };
}

// ─── Comment Builder ────────────────────────────────────────────────────────

/**
 * Build a structured markdown review comment for a [depends] dependency bump.
 *
 * Sections: TL;DR verdict, Version Diff table, Changelog Highlights,
 * Impact Assessment, Hash Verification, Patch Changes, Historical Context,
 * Platform note.
 */
export function buildDependsReviewComment(data: DependsReviewData): string {
  const verdict = computeDependsVerdict(data);
  const sections: string[] = [];

  // 1. TL;DR verdict
  sections.push(`## ${verdict.emoji} ${verdict.label}`);
  sections.push("");
  sections.push(verdict.summary);
  sections.push("");

  // 2. Version Diff table
  if (data.versionDiffs.length > 0) {
    sections.push("### Version Diff");
    sections.push("");
    sections.push("| Package | Old | New | Hash Status |");
    sections.push("|---------|-----|-----|-------------|");

    for (const vd of data.versionDiffs) {
      const hashResult = data.hashResults.find(
        (h) => h.packageName === vd.packageName,
      );
      const hashStatus = hashResult
        ? formatHashStatus(hashResult.result)
        : "\u2014";
      sections.push(
        `| ${vd.packageName} | ${vd.oldVersion ?? "\u2014"} | ${vd.newVersion ?? "\u2014"} | ${hashStatus} |`,
      );
    }
    sections.push("");
  }

  // 3. Changelog Highlights (per-package for multi-package)
  const hasChangelogs = data.changelogs.some(
    (c) => c.changelog.highlights.length > 0 || c.changelog.degradationNote,
  );
  if (hasChangelogs) {
    sections.push("### Changelog Highlights");
    sections.push("");

    for (const entry of data.changelogs) {
      if (data.changelogs.length > 1) {
        sections.push(`**${entry.packageName}:**`);
        sections.push("");
      }

      if (entry.changelog.highlights.length > 0) {
        for (const h of entry.changelog.highlights) {
          sections.push(`- ${h}`);
        }
      }

      if (
        entry.changelog.breakingChanges &&
        entry.changelog.breakingChanges.length > 0
      ) {
        sections.push("");
        sections.push(
          `> **Breaking changes:** ${entry.changelog.breakingChanges.join("; ")}`,
        );
      }

      if (entry.changelog.degradationNote) {
        sections.push("");
        sections.push(`> ${entry.changelog.degradationNote}`);
      }

      if (entry.changelog.url) {
        sections.push("");
        sections.push(`[Full changelog](${entry.changelog.url})`);
      }

      sections.push("");
    }
  }

  // 4. Impact Assessment
  if (data.impact) {
    sections.push("### Impact Assessment");
    sections.push("");

    const count = data.impact.consumers.length;
    sections.push(
      `**${count} consuming file${count !== 1 ? "s" : ""}** found in the codebase.`,
    );
    sections.push("");

    if (count > 0) {
      const topConsumers = data.impact.consumers.slice(0, 10);
      for (const c of topConsumers) {
        sections.push(`- \`${c.filePath}\` (line ${c.line})`);
      }
      if (count > 10) {
        sections.push(`- ... and ${count - 10} more`);
      }
      sections.push("");
    }

    // Transitive dependencies woven into impact section
    if (data.transitive) {
      if (data.transitive.dependents.length > 0) {
        sections.push(
          `**Transitive dependents:** ${data.transitive.dependents.join(", ")}`,
        );
        sections.push("");
      }
      if (data.transitive.newDependencies.length > 0) {
        sections.push(
          `**New transitive dependencies:** ${data.transitive.newDependencies.join(", ")}`,
        );
        sections.push("");
      }
      if (data.transitive.circular.length > 0) {
        sections.push(
          `> **Circular dependency detected:** ${data.transitive.circular.join(", ")}`,
        );
        sections.push("");
      }
    }

    if (data.impact.timeLimitReached) {
      sections.push(
        "> Analysis time limit reached \u2014 results may be incomplete.",
      );
      sections.push("");
    }

    if (data.impact.degradationNote) {
      sections.push(`> ${data.impact.degradationNote}`);
      sections.push("");
    }
  }

  // 5. Hash Verification
  const nonSkippedHashes = data.hashResults.filter(
    (h) => h.result.status !== "skipped",
  );
  if (nonSkippedHashes.length > 0) {
    sections.push("### Hash Verification");
    sections.push("");

    for (const hr of nonSkippedHashes) {
      const icon =
        hr.result.status === "verified"
          ? "\u2705"
          : hr.result.status === "mismatch"
            ? "\u274C"
            : "\u26A0\uFE0F";
      sections.push(`- ${icon} **${hr.packageName}:** ${hr.result.detail}`);
    }
    sections.push("");
  }

  // 6. Patch Changes
  if (data.patchChanges.length > 0) {
    sections.push("### Patch Changes");
    sections.push("");

    for (const pc of data.patchChanges) {
      const icon =
        pc.action === "added"
          ? "\u2795"
          : pc.action === "removed"
            ? "\u2796"
            : "\u270F\uFE0F";
      sections.push(`- ${icon} \`${pc.file}\` (${pc.action})`);
    }
    sections.push("");
  }

  // 7. Past Context (historical)
  if (data.retrievalContext) {
    sections.push("### Historical Context");
    sections.push("");
    sections.push(data.retrievalContext);
    sections.push("");
  }

  // 8. Platform note
  if (data.platform === "windows") {
    sections.push(
      "> **Note:** Windows dependencies use pre-built binaries without hash verification.",
    );
    sections.push("");
  }

  return sections.join("\n").trimEnd();
}

// ─── Inline Comments ────────────────────────────────────────────────────────

/**
 * Generate inline review comments for specific file findings.
 *
 * - Hash mismatch on VERSION files -> inline comment on the SHA512 line
 * - Removed patches -> inline comment noting removal
 * - New find_dependency() calls in cmake files -> inline comment noting new transitive dep
 */
export function buildDependsInlineComments(
  data: DependsReviewData,
  prFiles: Array<{ filename: string; patch?: string }>,
): InlineComment[] {
  const comments: InlineComment[] = [];

  // Hash mismatch inline comments on VERSION files
  for (const hr of data.hashResults) {
    if (hr.result.status !== "mismatch") continue;

    // Find the VERSION file for this package in PR files
    const versionFile = prFiles.find(
      (f) =>
        f.filename.toLowerCase().includes(hr.packageName.toLowerCase()) &&
        f.filename.toUpperCase().includes("VERSION"),
    );

    if (versionFile?.patch) {
      const sha512Line = findPatchLineNumber(versionFile.patch, "SHA512");
      if (sha512Line > 0) {
        comments.push({
          path: versionFile.filename,
          line: sha512Line,
          body: `\u{1F6A8} **Hash mismatch:** ${hr.result.detail}\n\nThe SHA512 in this VERSION file does not match the upstream tarball. This could indicate a supply chain issue or a re-packaged archive.`,
        });
      }
    }
  }

  // Removed patch inline comments
  for (const pc of data.patchChanges) {
    if (pc.action !== "removed") continue;

    const prFile = prFiles.find((f) => f.filename === pc.file);
    if (prFile) {
      comments.push({
        path: pc.file,
        line: 1,
        body: `\u26A0\uFE0F **Patch removed:** Verify this patch is no longer needed for the new version. If the upstream fix was incorporated, this removal is expected.`,
      });
    }
  }

  // New transitive dependency inline comments on cmake files
  if (data.transitive && data.transitive.newDependencies.length > 0) {
    for (const prFile of prFiles) {
      if (!prFile.filename.endsWith(".cmake") || !prFile.patch) continue;

      for (const newDep of data.transitive.newDependencies) {
        if (
          prFile.patch
            .toLowerCase()
            .includes(`find_dependency(${newDep.toLowerCase()}`)
        ) {
          const depLine = findPatchLineNumber(prFile.patch, `find_dependency(${newDep}`);
          if (depLine > 0) {
            comments.push({
              path: prFile.filename,
              line: depLine,
              body: `\u{1F195} **New transitive dependency:** \`${newDep}\` was not required before this bump. Ensure it is available in all build environments.`,
            });
          }
        }
      }
    }
  }

  return comments;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatHashStatus(result: HashVerificationResult): string {
  switch (result.status) {
    case "verified":
      return "\u2705 Verified";
    case "mismatch":
      return "\u274C Mismatch";
    case "unavailable":
      return "\u26A0\uFE0F Unavailable";
    case "skipped":
      return "\u2014";
  }
}

/**
 * Find the line number in a unified diff patch for a line containing the given text.
 * Returns the new-file line number (for GitHub review API), or 0 if not found.
 */
function findPatchLineNumber(patch: string, searchText: string): number {
  const lines = patch.split("\n");
  let newLineNum = 0;
  const searchLower = searchText.toLowerCase();

  for (const line of lines) {
    // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLineNum = parseInt(hunkMatch[1]!, 10) - 1;
      continue;
    }

    if (line.startsWith("-")) {
      // Removed line: doesn't increment new line counter
      continue;
    }

    if (line.startsWith("+") || !line.startsWith("\\")) {
      newLineNum++;
    }

    if (line.startsWith("+") && line.toLowerCase().includes(searchLower)) {
      return newLineNum;
    }
  }

  return 0;
}
