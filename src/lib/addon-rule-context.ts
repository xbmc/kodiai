import type { PullRequestFileMetadata } from "./github-pr-files.ts";

export type AddonRuleFileContext = {
  path: string;
  status?: string;
  additions?: number | null;
  deletions?: number | null;
  patch?: string;
  omittedReason?: "out-of-scope" | "patch-unavailable" | "truncated";
};

export type AddonRuleAddonContext = {
  addonId: string;
  files: AddonRuleFileContext[];
  allChangedPaths: string[];
};

export function collectAddonRuleContext(params: {
  files: readonly PullRequestFileMetadata[];
  maxPatchChars?: number;
}): AddonRuleAddonContext[] {
  const maxPatchChars = params.maxPatchChars ?? 40_000;
  const byAddon = new Map<string, PullRequestFileMetadata[]>();

  for (const file of params.files) {
    const filename = normalizeGitPath(file.filename);
    const slash = filename.indexOf("/");
    if (slash <= 0) continue;

    const addonId = filename.slice(0, slash);
    const files = byAddon.get(addonId) ?? [];
    files.push({ ...file, filename });
    byAddon.set(addonId, files);
  }

  return [...byAddon.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([addonId, files]) => {
      const uniqueFiles = dedupeAndSortFiles(files);
      return {
        addonId,
        allChangedPaths: uniqueFiles.map((file) => file.filename),
        files: uniqueFiles.map((file) => toFileContext(file, maxPatchChars)),
      };
    });
}

function dedupeAndSortFiles(files: readonly PullRequestFileMetadata[]): PullRequestFileMetadata[] {
  const byPath = new Map<string, PullRequestFileMetadata>();
  for (const file of files) byPath.set(file.filename, file);
  return [...byPath.values()].sort((left, right) => left.filename.localeCompare(right.filename));
}

function toFileContext(file: PullRequestFileMetadata, maxPatchChars: number): AddonRuleFileContext {
  const base = {
    path: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
  };

  if (!isContentScoped(file.filename)) {
    return { ...base, omittedReason: "out-of-scope" };
  }

  if (file.patch == null) {
    return { ...base, omittedReason: "patch-unavailable" };
  }

  if (file.patch.length > maxPatchChars) {
    return {
      ...base,
      patch: file.patch.slice(0, maxPatchChars),
      omittedReason: "truncated",
    };
  }

  return { ...base, patch: file.patch };
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isContentScoped(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.endsWith("/addon.xml")
    || normalized.endsWith(".py")
    || normalized.endsWith(".js");
}
