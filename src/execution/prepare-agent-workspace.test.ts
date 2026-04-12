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

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

test("prepareAgentWorkspace copies the repo and writes agent-config with repoCwd", async () => {
  const sourceRepoDir = await makeTempDir("kodiai-source-repo-");
  const workspaceDir = await makeTempDir("kodiai-agent-workspace-");

  await mkdir(join(sourceRepoDir, "src"), { recursive: true });
  await writeFile(join(sourceRepoDir, "src", "feature.ts"), "export const feature = true;\n");
  await writeFile(join(sourceRepoDir, ".kodiai.yml"), "review:\n  enabled: true\n");

  const { repoCwd } = await prepareAgentWorkspace({
    sourceRepoDir,
    workspaceDir,
    prompt: "Review this PR",
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 25,
    allowedTools: ["Read", "Grep", "Glob"],
    taskType: "review.full",
    mcpServerNames: ["github_comment"],
  });

  expect(repoCwd).toBe(join(workspaceDir, "repo"));
  expect(await readFile(join(repoCwd, "src", "feature.ts"), "utf-8")).toContain("feature = true");
  expect(await readFile(join(repoCwd, ".kodiai.yml"), "utf-8")).toContain("review:");
  expect(await readFile(join(workspaceDir, "prompt.txt"), "utf-8")).toBe("Review this PR");

  const rawAgentConfig = await readFile(join(workspaceDir, "agent-config.json"), "utf-8");
  const agentConfig = JSON.parse(rawAgentConfig) as {
    prompt: string;
    model: string;
    maxTurns: number;
    allowedTools: string[];
    taskType: string;
    repoCwd?: string;
    mcpServerNames?: string[];
  };

  expect(agentConfig.prompt).toBe("Review this PR");
  expect(agentConfig.model).toBe("claude-sonnet-4-5-20250929");
  expect(agentConfig.maxTurns).toBe(25);
  expect(agentConfig.allowedTools).toEqual(["Read", "Grep", "Glob"]);
  expect(agentConfig.taskType).toBe("review.full");
  expect(agentConfig.repoCwd).toBe(repoCwd);
  expect(agentConfig.mcpServerNames).toEqual(["github_comment"]);
});

test("prepareAgentWorkspace materializes symlinks as regular files in the staged repo snapshot", async () => {
  const sourceRepoDir = await makeTempDir("kodiai-source-repo-");
  const workspaceDir = await makeTempDir("kodiai-agent-workspace-");

  await mkdir(join(sourceRepoDir, "system", "settings"), { recursive: true });
  await writeFile(join(sourceRepoDir, "system", "settings", "linux.xml"), "<settings platform=\"linux\" />\n");
  await symlink("linux.xml", join(sourceRepoDir, "system", "settings", "freebsd.xml"));

  await prepareAgentWorkspace({
    sourceRepoDir,
    workspaceDir,
    prompt: "Review this PR",
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 25,
    allowedTools: ["Read", "Grep", "Glob"],
    taskType: "review.full",
    mcpServerNames: ["github_comment"],
  });

  const stagedPath = join(workspaceDir, "repo", "system", "settings", "freebsd.xml");
  expect(await readFile(stagedPath, "utf-8")).toBe("<settings platform=\"linux\" />\n");
  expect((await lstat(stagedPath)).isSymbolicLink()).toBe(false);
});

test("prepareAgentWorkspace does not preserve read-only file modes in the staged repo snapshot", async () => {
  const sourceRepoDir = await makeTempDir("kodiai-source-repo-");
  const workspaceDir = await makeTempDir("kodiai-agent-workspace-");

  const readonlyPath = join(sourceRepoDir, "privacy-policy.txt");
  await writeFile(readonlyPath, "private but readable\n");
  await chmod(readonlyPath, 0o444);

  await prepareAgentWorkspace({
    sourceRepoDir,
    workspaceDir,
    prompt: "Review this PR",
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 25,
    allowedTools: ["Read", "Grep", "Glob"],
    taskType: "review.full",
    mcpServerNames: ["github_comment"],
  });

  const stagedPath = join(workspaceDir, "repo", "privacy-policy.txt");
  await writeFile(stagedPath, "updated\n");
  expect(await readFile(stagedPath, "utf-8")).toBe("updated\n");
});
