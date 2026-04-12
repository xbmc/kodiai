import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink, lstat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareAgentWorkspace } from "./executor.ts";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function extractRepoArchive(archivePath: string): Promise<string> {
  const destDir = await makeTempDir("kodiai-extracted-repo-");
  const proc = Bun.spawn([
    "tar",
    "-C",
    destDir,
    "-xf",
    archivePath,
  ], {
    stdout: "ignore",
    stderr: "pipe",
  });

  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`failed to extract repo archive: ${stderr.trim()}`);
  }

  return destDir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

test("prepareAgentWorkspace writes repo.tar and agent-config with repoArchivePath", async () => {
  const sourceRepoDir = await makeTempDir("kodiai-source-repo-");
  const workspaceDir = await makeTempDir("kodiai-agent-workspace-");

  await mkdir(join(sourceRepoDir, "src"), { recursive: true });
  await writeFile(join(sourceRepoDir, "src", "feature.ts"), "export const feature = true;\n");
  await writeFile(join(sourceRepoDir, ".kodiai.yml"), "review:\n  enabled: true\n");

  const { repoArchivePath } = await prepareAgentWorkspace({
    sourceRepoDir,
    workspaceDir,
    prompt: "Review this PR",
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 25,
    allowedTools: ["Read", "Grep", "Glob"],
    taskType: "review.full",
    mcpServerNames: ["github_comment"],
  });

  expect(repoArchivePath).toBe(join(workspaceDir, "repo.tar"));
  expect(await readFile(join(workspaceDir, "prompt.txt"), "utf-8")).toBe("Review this PR");

  const extractedRepoDir = await extractRepoArchive(repoArchivePath);
  expect(await readFile(join(extractedRepoDir, "src", "feature.ts"), "utf-8")).toContain("feature = true");
  expect(await readFile(join(extractedRepoDir, ".kodiai.yml"), "utf-8")).toContain("review:");

  const rawAgentConfig = await readFile(join(workspaceDir, "agent-config.json"), "utf-8");
  const agentConfig = JSON.parse(rawAgentConfig) as {
    prompt: string;
    model: string;
    maxTurns: number;
    allowedTools: string[];
    taskType: string;
    repoArchivePath?: string;
    mcpServerNames?: string[];
  };

  expect(agentConfig.prompt).toBe("Review this PR");
  expect(agentConfig.model).toBe("claude-sonnet-4-5-20250929");
  expect(agentConfig.maxTurns).toBe(25);
  expect(agentConfig.allowedTools).toEqual(["Read", "Grep", "Glob"]);
  expect(agentConfig.taskType).toBe("review.full");
  expect(agentConfig.repoArchivePath).toBe(repoArchivePath);
  expect(agentConfig.mcpServerNames).toEqual(["github_comment"]);
});

test("prepareAgentWorkspace materializes symlinks as regular files in repo.tar", async () => {
  const sourceRepoDir = await makeTempDir("kodiai-source-repo-");
  const workspaceDir = await makeTempDir("kodiai-agent-workspace-");

  await mkdir(join(sourceRepoDir, "system", "settings"), { recursive: true });
  await writeFile(join(sourceRepoDir, "system", "settings", "linux.xml"), "<settings platform=\"linux\" />\n");
  await symlink("linux.xml", join(sourceRepoDir, "system", "settings", "freebsd.xml"));

  const { repoArchivePath } = await prepareAgentWorkspace({
    sourceRepoDir,
    workspaceDir,
    prompt: "Review this PR",
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 25,
    allowedTools: ["Read", "Grep", "Glob"],
    taskType: "review.full",
    mcpServerNames: ["github_comment"],
  });

  const extractedRepoDir = await extractRepoArchive(repoArchivePath);
  const stagedPath = join(extractedRepoDir, "system", "settings", "freebsd.xml");
  expect(await readFile(stagedPath, "utf-8")).toBe("<settings platform=\"linux\" />\n");
  expect((await lstat(stagedPath)).isSymbolicLink()).toBe(false);
});

test("prepareAgentWorkspace stages read-only source files into repo.tar without dropping their contents", async () => {
  const sourceRepoDir = await makeTempDir("kodiai-source-repo-");
  const workspaceDir = await makeTempDir("kodiai-agent-workspace-");

  const readonlyPath = join(sourceRepoDir, "privacy-policy.txt");
  await writeFile(readonlyPath, "private but readable\n");
  await chmod(readonlyPath, 0o444);

  const { repoArchivePath } = await prepareAgentWorkspace({
    sourceRepoDir,
    workspaceDir,
    prompt: "Review this PR",
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 25,
    allowedTools: ["Read", "Grep", "Glob"],
    taskType: "review.full",
    mcpServerNames: ["github_comment"],
  });

  const extractedRepoDir = await extractRepoArchive(repoArchivePath);
  const stagedPath = join(extractedRepoDir, "privacy-policy.txt");
  expect(await readFile(stagedPath, "utf-8")).toBe("private but readable\n");
});
