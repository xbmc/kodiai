import { readdir } from "node:fs/promises";
import { join, normalize } from "node:path";

export type AddonRuleFileContext = {
  path: string;
  content?: string;
  omittedReason?: "missing" | "out-of-scope" | "truncated";
};

export type AddonRuleAddonContext = {
  addonId: string;
  files: AddonRuleFileContext[];
  allChangedPaths: string[];
  hasLicenseFile: boolean;
};

export async function collectAddonRuleContext(params: {
  workspaceDir: string;
  files: Array<{ filename: string }>;
  maxFileChars?: number;
}): Promise<AddonRuleAddonContext[]> {
  const maxFileChars = params.maxFileChars ?? 40_000;
  const byAddon = new Map<string, string[]>();

  for (const file of params.files) {
    const normalized = normalizeGitPath(file.filename);
    const slash = normalized.indexOf("/");
    if (slash <= 0) continue;
    const addonId = normalized.slice(0, slash);
    const paths = byAddon.get(addonId) ?? [];
    paths.push(normalized);
    byAddon.set(addonId, paths);
  }

  const contexts: AddonRuleAddonContext[] = [];
  for (const [addonId, allChangedPaths] of [...byAddon.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const files: AddonRuleFileContext[] = [];
    for (const path of [...new Set(allChangedPaths)].sort()) {
      files.push(await collectFileContext(params.workspaceDir, path, maxFileChars));
    }
    contexts.push({
      addonId,
      files,
      allChangedPaths: [...new Set(allChangedPaths)].sort(),
      hasLicenseFile: await addonHasLicenseFile(params.workspaceDir, addonId),
    });
  }

  return contexts;
}

async function addonHasLicenseFile(workspaceDir: string, addonId: string): Promise<boolean> {
  try {
    const addonDir = safeWorkspacePath(workspaceDir, addonId);
    const entries = await readdir(addonDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && /^(licen[sc]e|copying)(?:\.[A-Za-z0-9]+)?$/i.test(entry.name));
  } catch {
    return false;
  }
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isContentScoped(path: string): boolean {
  return path.endsWith("/addon.xml") || path.endsWith(".py") || path.endsWith(".js");
}

async function collectFileContext(
  workspaceDir: string,
  gitPath: string,
  maxFileChars: number,
): Promise<AddonRuleFileContext> {
  if (!isContentScoped(gitPath)) {
    return { path: gitPath, omittedReason: "out-of-scope" };
  }

  try {
    const absolutePath = safeWorkspacePath(workspaceDir, gitPath);
    const content = await Bun.file(absolutePath).text();
    if (content.length > maxFileChars) {
      return { path: gitPath, content: content.slice(0, maxFileChars), omittedReason: "truncated" };
    }
    return { path: gitPath, content };
  } catch {
    return { path: gitPath, omittedReason: "missing" };
  }
}

function safeWorkspacePath(workspaceDir: string, gitPath: string): string {
  const absolutePath = normalize(join(workspaceDir, gitPath));
  const workspaceRoot = normalize(workspaceDir);
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}/`)) {
    throw new Error("addon-rule-context path escaped workspace");
  }
  return absolutePath;
}
