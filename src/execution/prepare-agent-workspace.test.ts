import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir, lstat, symlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
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
  const repoDir = repoCwd!;
  expect(await readFile(join(repoDir, "src", "feature.ts"), "utf-8")).toContain("feature = true");
  expect(await readFile(join(repoDir, ".kodiai.yml"), "utf-8")).toContain("review:");
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

test("prepareAgentWorkspace writes a git bundle for repos with tracked symlinks", async () => {
  const sourceRepoDir = await makeTempDir("kodiai-source-symlink-repo-");
  const workspaceDir = await makeTempDir("kodiai-agent-symlink-workspace-");

  await mkdir(join(sourceRepoDir, "system", "settings"), { recursive: true });
  await writeFile(join(sourceRepoDir, ".kodiai.yml"), "review:\n  enabled: true\n");
  await writeFile(join(sourceRepoDir, "system", "settings", "linux.xml"), "<settings />\n");

  await $`git -C ${sourceRepoDir} init`.quiet();
  await $`git -C ${sourceRepoDir} config user.email t@example.com`.quiet();
  await $`git -C ${sourceRepoDir} config user.name T`.quiet();
  await $`git -C ${sourceRepoDir} remote add origin https://github.com/xbmc/xbmc.git`.quiet();
  await symlink("linux.xml", join(sourceRepoDir, "system", "settings", "freebsd.xml"));
  await $`git -C ${sourceRepoDir} add .`.quiet();
  await $`git -C ${sourceRepoDir} commit -m init`.quiet();
  await $`git -C ${sourceRepoDir} branch -M main`.quiet();
  await $`git -C ${sourceRepoDir} checkout -b pr-mention`.quiet();

  const result = await prepareAgentWorkspace({
    sourceRepoDir,
    workspaceDir,
    prompt: "Review this PR",
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 25,
    allowedTools: ["Read", "Grep", "Glob"],
    taskType: "review.full",
    mcpServerNames: ["github_comment"],
  }) as unknown as { repoCwd?: string; repoBundlePath?: string };

  expect(result.repoCwd).toBeUndefined();
  expect(result.repoBundlePath).toBe(join(workspaceDir, "repo.bundle"));
  expect((await lstat(join(workspaceDir, "repo.bundle"))).isFile()).toBe(true);
  await expect(stat(join(workspaceDir, "repo"))).rejects.toThrow();

  const rawAgentConfig = await readFile(join(workspaceDir, "agent-config.json"), "utf-8");
  const agentConfig = JSON.parse(rawAgentConfig) as {
    repoCwd?: string;
    repoBundlePath?: string;
    repoOriginUrl?: string;
  };

  expect(agentConfig.repoCwd).toBeUndefined();
  expect(agentConfig.repoBundlePath).toBe(join(workspaceDir, "repo.bundle"));
  expect(agentConfig.repoOriginUrl).toBe("https://github.com/xbmc/xbmc.git");

  const cloneCheckDir = await makeTempDir("kodiai-bundle-clone-check-");
  await $`git clone ${join(workspaceDir, "repo.bundle")} ${cloneCheckDir}`.quiet();
  expect((await lstat(join(cloneCheckDir, "system", "settings", "freebsd.xml"))).isSymbolicLink()).toBe(true);
  expect((await $`git -C ${cloneCheckDir} status --porcelain`.quiet()).text()).toBe("");
  expect((await $`git -C ${cloneCheckDir} diff origin/main...HEAD --stat`.quiet()).text().trim().length).toBeGreaterThanOrEqual(0);
});

test("prepareAgentWorkspace unshallows PR workspaces before writing repo bundle", async () => {
  const tempRoot = await makeTempDir("kodiai-shallow-bundle-");
  const bareRepoDir = join(tempRoot, "origin.git");
  const seedRepoDir = join(tempRoot, "seed");
  const shallowRepoDir = join(tempRoot, "shallow");
  const workspaceDir = await makeTempDir("kodiai-agent-shallow-workspace-");
  const cloneCheckDir = await makeTempDir("kodiai-bundle-clone-check-");

  await $`git init --bare ${bareRepoDir}`.quiet();
  await $`git clone file://${bareRepoDir} ${seedRepoDir}`.quiet();
  await $`git -C ${seedRepoDir} config user.email t@example.com`.quiet();
  await $`git -C ${seedRepoDir} config user.name T`.quiet();
  await writeFile(join(seedRepoDir, "feature.txt"), "one\n");
  await $`git -C ${seedRepoDir} add feature.txt`.quiet();
  await $`git -C ${seedRepoDir} commit -m one`.quiet();
  await $`git -C ${seedRepoDir} branch -M master`.quiet();
  await $`git -C ${seedRepoDir} push origin master`.quiet();
  await writeFile(join(seedRepoDir, "feature.txt"), "one\ntwo\n");
  await $`git -C ${seedRepoDir} commit -am two`.quiet();
  await $`git -C ${seedRepoDir} push origin master`.quiet();
  await $`git -C ${seedRepoDir} checkout -b pr-mention`.quiet();
  await writeFile(join(seedRepoDir, "feature.txt"), "one\ntwo\npr\n");
  await $`git -C ${seedRepoDir} commit -am pr`.quiet();
  await $`git -C ${seedRepoDir} push origin pr-mention`.quiet();

  await $`git clone --depth=1 --single-branch --branch master file://${bareRepoDir} ${shallowRepoDir}`.quiet();
  await $`git -C ${shallowRepoDir} fetch file://${bareRepoDir} pr-mention:pr-mention`.quiet();
  await $`git -C ${shallowRepoDir} checkout pr-mention`.quiet();
  await $`git -C ${shallowRepoDir} fetch origin master:refs/remotes/origin/master --depth=1`.quiet();
  expect((await $`git -C ${shallowRepoDir} rev-parse --is-shallow-repository`.quiet().text()).trim()).toBe("true");

  const result = await prepareAgentWorkspace({
    sourceRepoDir: shallowRepoDir,
    workspaceDir,
    prompt: "Review this PR",
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 25,
    allowedTools: ["Read", "Grep", "Glob"],
    taskType: "review.full",
    mcpServerNames: ["github_comment"],
  }) as unknown as { repoCwd?: string; repoBundlePath?: string };

  expect(result.repoCwd).toBeUndefined();
  expect(result.repoBundlePath).toBe(join(workspaceDir, "repo.bundle"));
  await $`git clone ${join(workspaceDir, "repo.bundle")} ${cloneCheckDir}`.quiet();
  expect((await $`git -C ${cloneCheckDir} diff origin/master...HEAD --stat`.quiet().text())).toContain("feature.txt");
});
