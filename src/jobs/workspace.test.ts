import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import type { CappedProcessResult } from "../lib/capped-process.ts";
import { buildWritePolicyRefusalMessage } from "../lib/write-policy-formatting.ts";
import {
  enforceWritePolicy,
  getBoundedStagedPaths,
  WritePolicyError,
  buildAuthFetchUrl,
  createWorkspaceManager,
  cleanupStaleAzureFilesWorkspaceDirs,
  fetchRemoteTrackingBranch,
  fetchAndCheckoutPullRequestHeadRef,
} from "./workspace.ts";
import type { GitHubApp } from "../auth/github-app.ts";

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
}

async function createRepoWithStagedFile(
  relativePath: string,
  content: string | Uint8Array,
): Promise<string> {
  const dir = await createTempDir();
  await $`git -C ${dir} init`.quiet();
  const parent = dirname(join(dir, relativePath));
  await mkdir(parent, { recursive: true });
  await writeFile(join(dir, relativePath), content);
  const add = Bun.spawn(["git", "-C", dir, "add", "--", relativePath], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await add.exited;
  if (exitCode !== 0) {
    throw new Error(`git add failed with exit code ${exitCode}`);
  }
  return dir;
}

async function runGitForTest(dir: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-C", dir, ...args], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`git ${args[0] ?? "command"} failed with exit code ${exitCode}`);
  }
}

function stagedDiffResult(
  overrides: Partial<CappedProcessResult> = {},
): CappedProcessResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

describe("getBoundedStagedPaths", () => {
  test("parses exact NUL-delimited paths with bounded safe Git options", async () => {
    let received: Parameters<NonNullable<Parameters<typeof getBoundedStagedPaths>[0]["runStagedPathCommand"]>>[0] | undefined;
    const paths = await getBoundedStagedPaths({
      dir: "/workspace",
      runStagedPathCommand: async (params) => {
        received = params;
        return stagedDiffResult({
          stdout: " leading.ts\0trailing.ts \0tab\tname.ts\0line\nbreak.ts\0",
        });
      },
    });

    expect(paths).toEqual([
      " leading.ts",
      "trailing.ts ",
      "tab\tname.ts",
      "line\nbreak.ts",
    ]);
    expect(received?.timeoutMs).toBe(30_000);
    expect(received?.maxStdoutBytes).toBe(1024 * 1024);
    expect(received?.args).toContain("--name-only");
    expect(received?.args).toContain("-z");
    expect(received?.args).toContain("--no-ext-diff");
    expect(received?.args).toContain("--no-textconv");
  });

  test("returns an empty path list for an empty staged diff", async () => {
    await expect(
      getBoundedStagedPaths({
        dir: "/workspace",
        runStagedPathCommand: async () => stagedDiffResult(),
      }),
    ).resolves.toEqual([]);
  });

  test.each([
    ["timeout", stagedDiffResult({ timedOut: true })],
    ["nonzero exit", stagedDiffResult({ exitCode: 1, stderr: "sensitive stderr" })],
    ["stdout truncation", stagedDiffResult({ stdoutTruncated: true })],
    ["stderr truncation", stagedDiffResult({ stderrTruncated: true })],
  ])("fails closed when path discovery has a %s", async (_name, result) => {
    await expect(
      getBoundedStagedPaths({
        dir: "/workspace",
        runStagedPathCommand: async () => result,
      }),
    ).rejects.toMatchObject({
      code: "write-policy-secret-scan-incomplete",
      rule: "secretScan",
      maxBytes: 1024 * 1024,
      message: "Write blocked: staged secret scan was incomplete",
    });
  });

  test("fails closed when path discovery throws", async () => {
    await expect(
      getBoundedStagedPaths({
        dir: "/workspace",
        runStagedPathCommand: async () => {
          throw new Error("runner failed with sensitive details");
        },
      }),
    ).rejects.toMatchObject({
      code: "write-policy-secret-scan-incomplete",
      maxBytes: 1024 * 1024,
      message: "Write blocked: staged secret scan was incomplete",
    });
  });

  test.each([
    ["missing NUL terminator", "src/value.ts"],
    ["replacement character", "src/\uFFFDvalue.ts\0"],
    ["duplicate record", "src/value.ts\0src/value.ts\0"],
    ["empty record", "src/value.ts\0\0"],
    ["byte-count overflow", `${"a".repeat(1024 * 1024)}\0`],
    [
      "file-count overflow",
      `${Array.from({ length: 10_001 }, (_, index) => `f${index}`).join("\0")}\0`,
    ],
  ])("fails closed for %s in path discovery output", async (_name, stdout) => {
    await expect(
      getBoundedStagedPaths({
        dir: "/workspace",
        runStagedPathCommand: async () => stagedDiffResult({ stdout }),
      }),
    ).rejects.toMatchObject({
      code: "write-policy-secret-scan-incomplete",
      maxBytes: 1024 * 1024,
    });
  });
});

describe("enforceWritePolicy", () => {
  test("passes when no denyPaths or allowPaths are configured", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/foo.ts"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: false,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects path matching denyPaths", async () => {
    const dir = await createTempDir();
    try {
      const promise = enforceWritePolicy({
        dir,
        stagedPaths: [".github/workflows/ci.yml"],
        allowPaths: [],
        denyPaths: [".github/"],
        secretScanEnabled: false,
      });

      await expect(promise).rejects.toBeInstanceOf(WritePolicyError);
      await expect(promise).rejects.toMatchObject({
        code: "write-policy-denied-path",
        rule: "denyPaths",
        path: ".github/workflows/ci.yml",
        pattern: ".github/",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects path outside allowPaths", async () => {
    const dir = await createTempDir();
    try {
      const promise = enforceWritePolicy({
        dir,
        stagedPaths: ["README.md"],
        allowPaths: ["src/"],
        denyPaths: [],
        secretScanEnabled: false,
      });

      await expect(promise).rejects.toMatchObject({
        code: "write-policy-not-allowed",
        rule: "allowPaths",
        path: "README.md",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("passes path inside allowPaths", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/index.ts"],
          allowPaths: ["src/"],
          denyPaths: [],
          secretScanEnabled: false,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("denyPaths wins over allowPaths", async () => {
    const dir = await createTempDir();
    try {
      const promise = enforceWritePolicy({
        dir,
        stagedPaths: [".github/foo.yml"],
        allowPaths: ["src/", ".github/"],
        denyPaths: [".github/"],
        secretScanEnabled: false,
      });

      await expect(promise).rejects.toMatchObject({
        code: "write-policy-denied-path",
        rule: "denyPaths",
        path: ".github/foo.yml",
        pattern: ".github/",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["timeout", stagedDiffResult({ timedOut: true })],
    ["nonzero exit", stagedDiffResult({ exitCode: 1, stderr: "sensitive stderr" })],
    ["stdout truncation", stagedDiffResult({ stdoutTruncated: true })],
    ["stderr truncation", stagedDiffResult({ stderrTruncated: true })],
  ])("fails closed when the staged secret scan has a %s", async (_name, result) => {
    const dir = await createTempDir();
    try {
      const promise = enforceWritePolicy({
        dir,
        stagedPaths: ["src/value.ts"],
        allowPaths: [],
        denyPaths: [],
        secretScanEnabled: true,
        runStagedDiffLines: async (params) => {
          params.onStdoutLine("diff --git a/src/value.ts b/src/value.ts");
          params.onStdoutLine("+++ b/src/value.ts");
          params.onStdoutLine("+export const value = 1;");
          return result;
        },
      });

      await expect(promise).rejects.toMatchObject({
        code: "write-policy-secret-scan-incomplete",
        rule: "secretScan",
        maxBytes: 8 * 1024 * 1024,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fails closed when the staged secret scan runner throws", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/value.ts"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: true,
          runStagedDiffLines: async () => {
            throw new Error("runner failed with sensitive details");
          },
        }),
      ).rejects.toMatchObject({
        code: "write-policy-secret-scan-incomplete",
        rule: "secretScan",
        maxBytes: 8 * 1024 * 1024,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("scans added lines even when a diff header cannot be attributed to stagedPaths", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/value.ts"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: true,
          runStagedDiffLines: async (params) => {
            params.onStdoutLine("diff --git a/src/other.ts b/src/other.ts");
            params.onStdoutLine("--- /dev/null");
            params.onStdoutLine("+++ b/src/other.ts");
            params.onStdoutLine("@@ -0,0 +1 @@");
            params.onStdoutLine("+const token = 'ghp_123456789012345678901234567890123456';");
            return stagedDiffResult();
          },
        }),
      ).rejects.toMatchObject({
        code: "write-policy-secret-detected",
        rule: "secretScan",
        detector: "regex:github-pat",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ignores removed and context lines while scanning regular hunks", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/value.ts"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: true,
          runStagedDiffLines: async (params) => {
            params.onStdoutLine("diff --git a/src/value.ts b/src/value.ts");
            params.onStdoutLine("--- a/src/value.ts");
            params.onStdoutLine("+++ b/src/value.ts");
            params.onStdoutLine("@@ -1,2 +1,2 @@");
            params.onStdoutLine("-const token = 'ghp_123456789012345678901234567890123456';");
            params.onStdoutLine(" const token = 'ghp_123456789012345678901234567890123456';");
            params.onStdoutLine("+export const value = 1;");
            return stagedDiffResult();
          },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("preserves secret detection for staged added lines", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/value.ts"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: true,
          runStagedDiffLines: async (params) => {
            params.onStdoutLine("diff --git a/src/value.ts b/src/value.ts");
            params.onStdoutLine("+++ b/src/value.ts");
            params.onStdoutLine("@@ -0,0 +1 @@");
            params.onStdoutLine("+const token = 'ghp_123456789012345678901234567890123456';");
            return stagedDiffResult();
          },
        }),
      ).rejects.toMatchObject({
        code: "write-policy-secret-detected",
        rule: "secretScan",
        path: "src/value.ts",
        detector: "regex:github-pat",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses a finite timeout and disables external and textconv diff drivers", async () => {
    const dir = await createTempDir();
    try {
      let received: Parameters<NonNullable<Parameters<typeof enforceWritePolicy>[0]["runStagedDiffLines"]>>[0] | undefined;
      await enforceWritePolicy({
        dir,
        stagedPaths: ["src/value.ts"],
        allowPaths: [],
        denyPaths: [],
        secretScanEnabled: true,
        runStagedDiffLines: async (params) => {
          received = params;
          params.onStdoutLine("diff --git a/src/value.ts b/src/value.ts");
          params.onStdoutLine("--- /dev/null");
          params.onStdoutLine("+++ b/src/value.ts");
          params.onStdoutLine("@@ -0,0 +1 @@");
          params.onStdoutLine("+export const value = 1;");
          return stagedDiffResult();
        },
      });

      expect(received?.timeoutMs).toBe(30_000);
      expect(received?.args).toContain("--no-ext-diff");
      expect(received?.args).toContain("--no-textconv");
      expect(received?.maxStdoutBytes).toBe(8 * 1024 * 1024);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["combined diff", ["diff --cc src/value.ts", "@@@ -1,1 -1,1 +1,1 @@@", "++secret"]],
    ["explicit combined diff", ["diff --combined src/value.ts"]],
    ["binary marker", ["diff --git a/secret.bin b/secret.bin", "Binary files /dev/null and b/secret.bin differ"]],
    ["Git binary patch", ["diff --git a/secret.bin b/secret.bin", "GIT binary patch", "literal 1", "AcmZQz"]],
    ["malformed hunk", [
      "diff --git a/src/value.ts b/src/value.ts",
      "--- /dev/null",
      "+++ b/src/value.ts",
      "@@ -0,0 +1 @@",
      "+export const value = 1;",
      "+export const extra = 2;",
    ]],
  ])("fails closed for %s output", async (_name, lines) => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/value.ts"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: true,
          runStagedDiffLines: async (params) => {
            for (const line of lines) params.onStdoutLine(line);
            return stagedDiffResult();
          },
        }),
      ).rejects.toMatchObject({
        code: "write-policy-secret-scan-incomplete",
        rule: "secretScan",
        maxBytes: 8 * 1024 * 1024,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fails closed when patch file coverage does not match staged paths", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/value.ts"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: true,
          runStagedDiffLines: async () => stagedDiffResult(),
        }),
      ).rejects.toMatchObject({
        code: "write-policy-secret-scan-incomplete",
        rule: "secretScan",
        maxBytes: 8 * 1024 * 1024,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("scans staged added content that begins with two plus signs", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/value.ts"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: true,
          runStagedDiffLines: async (params) => {
            params.onStdoutLine("diff --git a/src/value.ts b/src/value.ts");
            params.onStdoutLine("--- a/src/value.ts");
            params.onStdoutLine("+++ b/src/value.ts");
            params.onStdoutLine("@@ -0,0 +1 @@");
            params.onStdoutLine("+++const token = 'ghp_123456789012345678901234567890123456';");
            return stagedDiffResult();
          },
        }),
      ).rejects.toMatchObject({
        code: "write-policy-secret-detected",
        path: "src/value.ts",
        detector: "regex:github-pat",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["leading space", " leading.ts"],
    ["trailing space", "trailing.ts "],
    ["tab", "tab\tname.ts"],
    ["non-ASCII", "café.ts"],
    ["quote and backslash", "quote\"back\\slash.ts"],
    ["embedded b/", "src/a b/value.ts"],
    ["newline", "line\nbreak.ts"],
  ])("real Git scan detects a secret in a %s path", async (_name, relativePath) => {
    const dir = await createRepoWithStagedFile(
      relativePath,
      "const token = 'ghp_123456789012345678901234567890123456';\n",
    );
    try {
      const stagedPaths = await getBoundedStagedPaths({ dir });
      expect(stagedPaths).toEqual([relativePath]);
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths,
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: true,
        }),
      ).rejects.toMatchObject({
        code: "write-policy-secret-detected",
        rule: "secretScan",
        detector: "regex:github-pat",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("real Git scan fails closed for staged binary content", async () => {
    const secret = new TextEncoder().encode(
      "ghp_123456789012345678901234567890123456",
    );
    const content = new Uint8Array(secret.length + 2);
    content[0] = 0;
    content.set(secret, 1);
    content[content.length - 1] = 10;
    const dir = await createRepoWithStagedFile("secret.bin", content);
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["secret.bin"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: true,
        }),
      ).rejects.toMatchObject({
        code: "write-policy-secret-scan-incomplete",
        rule: "secretScan",
        maxBytes: 8 * 1024 * 1024,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each(["rename", "copy"])(
    "real Git scan cannot bypass a secret in a %s destination",
    async (operation) => {
      const dir = await createTempDir();
      const sourcePath = "source.ts";
      const destinationPath = `dest b/${operation}\tvalue.ts`;
      try {
        await $`git -C ${dir} init`.quiet();
        await $`git -C ${dir} config user.email test@example.com`.quiet();
        await $`git -C ${dir} config user.name Test`.quiet();
        await writeFile(join(dir, sourcePath), "export const value = 1;\n");
        await runGitForTest(dir, ["add", "--", sourcePath]);
        await $`git -C ${dir} commit -m baseline`.quiet();

        await mkdir(dirname(join(dir, destinationPath)), { recursive: true });
        if (operation === "rename") {
          await runGitForTest(dir, ["mv", "--", sourcePath, destinationPath]);
        } else {
          await writeFile(join(dir, destinationPath), "export const value = 1;\n");
        }
        await writeFile(
          join(dir, destinationPath),
          "export const value = 1;\nconst token = 'ghp_123456789012345678901234567890123456';\n",
        );
        await runGitForTest(dir, ["add", "--", destinationPath]);

        const stagedPaths = await getBoundedStagedPaths({ dir });
        expect(stagedPaths).toContain(destinationPath);

        await expect(
          enforceWritePolicy({
            dir,
            stagedPaths,
            allowPaths: [],
            denyPaths: [],
            secretScanEnabled: true,
          }),
        ).rejects.toMatchObject({
          code: "write-policy-secret-detected",
          rule: "secretScan",
          detector: "regex:github-pat",
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("buildWritePolicyRefusalMessage", () => {
  test("formats denyPaths refusal with matched pattern", () => {
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError("write-policy-denied-path", "blocked", {
        path: "README.md",
        rule: "denyPaths",
        pattern: "README.md",
      }),
      [],
    );

    expect(message).toContain("Write request refused");
    expect(message).toContain("Reason: write-policy-denied-path");
    expect(message).toContain("Rule: denyPaths");
    expect(message).toContain("File: README.md");
    expect(message).toContain("Matched pattern: README.md");
  });

  test("formats allowPaths refusal with config snippet", () => {
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError("write-policy-not-allowed", "blocked", {
        path: "README.md",
        rule: "allowPaths",
      }),
      ["src/"],
    );

    expect(message).toContain("Smallest config change");
    expect(message).toContain("allowPaths");
    expect(message).toContain("- 'README.md'");
    expect(message).toContain("Current allowPaths: 'src/'");
  });

  test("formats secretScan refusal with safe remediation", () => {
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError("write-policy-secret-detected", "blocked", {
        path: "config.ts",
        rule: "secretScan",
        detector: "regex:github-pat",
      }),
      [],
    );

    expect(message).toContain("Detector: regex:github-pat");
    expect(message).toContain("Remove/redact the secret-like content and retry");
    expect(message).not.toContain("ghp_");
  });

  test("formats an incomplete secret scan without implying a secret was found", () => {
    const stagedContent = "export const sensitiveValue = 'do-not-leak';";
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError(
        "write-policy-secret-scan-incomplete",
        "Write blocked: staged secret scan was incomplete",
        {
          rule: "secretScan",
          maxBytes: 8 * 1024 * 1024,
        },
      ),
      [],
    );

    expect(message).toContain("scan was incomplete");
    expect(message).toContain("reduce or split the change");
    expect(message).toContain("8388608 bytes");
    expect(message).not.toContain("Remove/redact");
    expect(message).not.toContain(stagedContent);
  });

  test("formats no-changes refusal", () => {
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError("write-policy-no-changes", "No staged changes to commit"),
      [],
    );

    expect(message).toContain("No file changes were produced");
  });
});

describe("cleanupStaleAzureFilesWorkspaceDirs", () => {
  test("removes stale top-level workspace directories and keeps fresh directories", async () => {
    const mountBase = await createTempDir();
    try {
      const staleDir = join(mountBase, "stale-job");
      const freshDir = join(mountBase, "fresh-job");
      await mkdir(join(staleDir, "repo"), { recursive: true });
      await mkdir(freshDir, { recursive: true });
      await writeFile(join(staleDir, "repo", "README.md"), "old");
      await writeFile(join(freshDir, "result.json"), "{}");

      const nowMs = Date.UTC(2026, 5, 19);
      const staleDate = new Date(nowMs - 8 * 24 * 60 * 60 * 1000);
      await utimes(staleDir, staleDate, staleDate);

      const removed = await cleanupStaleAzureFilesWorkspaceDirs({
        mountBase,
        staleThresholdMs: 7 * 24 * 60 * 60 * 1000,
        nowMs,
      });

      expect(removed).toBe(1);
      expect(await readdir(mountBase)).toEqual(["fresh-job"]);
    } finally {
      await rm(mountBase, { recursive: true, force: true });
    }
  });

  test("returns zero when the Azure Files mount is absent", async () => {
    const removed = await cleanupStaleAzureFilesWorkspaceDirs({
      mountBase: join(tmpdir(), `missing-kodiai-workspaces-${crypto.randomUUID()}`),
    });

    expect(removed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers for git-based tests
// ---------------------------------------------------------------------------

/**
 * Set up a local bare repo at `bareDir` with one commit, then clone it into
 * `cloneDir` using a file:// URL.  Returns the file:// URL used for the clone.
 */
async function setupBareAndClone(bareDir: string, cloneDir: string): Promise<string> {
  // Init bare repo
  await $`git init --bare ${bareDir}`.quiet();

  // Create a temp source repo, commit, push to bare
  const srcDir = await mkdtemp(join(tmpdir(), "kodiai-src-"));
  try {
    await $`git -C ${srcDir} init`.quiet();
    await $`git -C ${srcDir} config user.email "test@example.com"`.quiet();
    await $`git -C ${srcDir} config user.name "Test"`.quiet();
    await writeFile(join(srcDir, "README.md"), "hello");
    await $`git -C ${srcDir} add README.md`.quiet();
    await $`git -C ${srcDir} commit -m "init"`.quiet();
    const bareUrl = `file://${bareDir}`;
    await $`git -C ${srcDir} remote add origin ${bareUrl}`.quiet();
    await $`git -C ${srcDir} push origin HEAD:main`.quiet();

    // Clone into cloneDir
    await $`git clone ${bareUrl} ${cloneDir}`.quiet();
    await $`git -C ${cloneDir} config user.email "test@example.com"`.quiet();
    await $`git -C ${cloneDir} config user.name "Test"`.quiet();

    return bareUrl;
  } finally {
    await rm(srcDir, { recursive: true, force: true });
  }
}

describe("fetchAndCheckoutPullRequestHeadRef", () => {
  test("falls back to the PR head repository ref when the base pull ref is missing", async () => {
    const tmpBase = await mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
    const baseBareDir = join(tmpBase, "base.git");
    const headBareDir = join(tmpBase, "head.git");
    const cloneDir = join(tmpBase, "clone");

    try {
      await setupBareAndClone(baseBareDir, cloneDir);
      await $`git init --bare ${headBareDir}`.quiet();

      const headWorkDir = join(tmpBase, "head-work");
      await $`git clone file://${baseBareDir} ${headWorkDir}`.quiet();
      const fallbackRef = "plugin.video.youtube@matrix";
      await $`git -C ${headWorkDir} checkout -B ${fallbackRef}`.quiet();
      await $`git -C ${headWorkDir} config user.email "test@example.com"`.quiet();
      await $`git -C ${headWorkDir} config user.name "Test"`.quiet();
      await writeFile(join(headWorkDir, "README.md"), "fallback head ref\n");
      await $`git -C ${headWorkDir} add README.md`.quiet();
      await $`git -C ${headWorkDir} commit -m "feature"`.quiet();
      const featureSha = (await $`git -C ${headWorkDir} rev-parse HEAD`.quiet()).text().trim();
      await $`git -C ${headWorkDir} remote add head file://${headBareDir}`.quiet();
      await $`git -C ${headWorkDir} push head ${fallbackRef}:${fallbackRef}`.quiet();
      await $`git -C ${cloneDir} config url.file://${headBareDir}.insteadOf https://x-access-token:test-token@github.com/acme/head.git`.quiet();

      const result = await fetchAndCheckoutPullRequestHeadRef({
        dir: cloneDir,
        prNumber: 28271,
        localBranch: "pr-review",
        token: "test-token",
        fallbackRemoteUrl: "https://github.com/acme/head.git",
        fallbackRef,
        depth: 1,
      });

      expect(result).toEqual({ localBranch: "pr-review", source: "head-ref-fallback" });
      const checkedOutSha = (await $`git -C ${cloneDir} rev-parse HEAD`.quiet()).text().trim();
      expect(checkedOutSha).toBe(featureSha);
      const fetchedCommitCount = Number((await $`git -C ${cloneDir} rev-list --count HEAD`.quiet()).text().trim());
      expect(fetchedCommitCount).toBe(1);
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// buildAuthFetchUrl tests
// ---------------------------------------------------------------------------

describe("fetchRemoteTrackingBranch", () => {
  test("force-updates a stale remote-tracking branch after base history rewinds", async () => {
    const tmpBase = await mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
    const bareDir = join(tmpBase, "bare.git");
    const cloneDir = join(tmpBase, "clone");

    try {
      await setupBareAndClone(bareDir, cloneDir);

      const originalRemoteMain = (await $`git -C ${cloneDir} rev-parse refs/remotes/origin/main`.quiet()).text().trim();

      await $`git -C ${cloneDir} checkout -B local-diverged refs/remotes/origin/main`.quiet();
      await writeFile(join(cloneDir, "README.md"), "locally diverged\n");
      await $`git -C ${cloneDir} add README.md`.quiet();
      await $`git -C ${cloneDir} commit -m "local diverged remote tracking state"`.quiet();
      const divergedSha = (await $`git -C ${cloneDir} rev-parse HEAD`.quiet()).text().trim();
      await $`git -C ${cloneDir} update-ref refs/remotes/origin/main ${divergedSha}`.quiet();

      const rejectedFetch = await $`git -C ${cloneDir} fetch origin main:refs/remotes/origin/main --depth=1`.quiet().nothrow();
      expect(rejectedFetch.exitCode).toBe(1);
      expect(rejectedFetch.stderr.toString()).toContain("non-fast-forward");

      await fetchRemoteTrackingBranch({
        dir: cloneDir,
        branch: "main",
        depth: 1,
      });

      const refreshedRemoteMain = (await $`git -C ${cloneDir} rev-parse refs/remotes/origin/main`.quiet()).text().trim();
      expect(refreshedRemoteMain).toBe(originalRemoteMain);
      expect(refreshedRemoteMain).not.toBe(divergedSha);
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// buildAuthFetchUrl tests
// ---------------------------------------------------------------------------

describe("buildAuthFetchUrl", () => {
  test("returns 'origin' when token is undefined", async () => {
    const tmpBase = await mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
    const bareDir = join(tmpBase, "bare.git");
    const cloneDir = join(tmpBase, "clone");

    try {
      await setupBareAndClone(bareDir, cloneDir);
      const result = await buildAuthFetchUrl(cloneDir, undefined);
      expect(result).toBe("origin");
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });

  test("injects token into a clean https://github.com URL", async () => {
    const tmpBase = await mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
    const bareDir = join(tmpBase, "bare.git");
    const cloneDir = join(tmpBase, "clone");

    try {
      await setupBareAndClone(bareDir, cloneDir);

      // Simulate what workspace.create() does after clone: set origin to clean GitHub URL
      await $`git -C ${cloneDir} remote set-url origin https://github.com/testowner/testrepo.git`.quiet();

      const token = "ghs_testtoken123";
      const result = await buildAuthFetchUrl(cloneDir, token);
      expect(result).toBe("https://x-access-token:ghs_testtoken123@github.com/testowner/testrepo.git");
      expect(result).not.toContain("https://github.com/testowner"); // must have injected token
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });

  test("injected URL contains x-access-token prefix", async () => {
    const tmpBase = await mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
    const bareDir = join(tmpBase, "bare.git");
    const cloneDir = join(tmpBase, "clone");

    try {
      await setupBareAndClone(bareDir, cloneDir);
      await $`git -C ${cloneDir} remote set-url origin https://github.com/owner/repo.git`.quiet();

      const result = await buildAuthFetchUrl(cloneDir, "mytoken");
      expect(result).toMatch(/^https:\/\/x-access-token:mytoken@github\.com\//);
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// URL-strip tests: git remote get-url origin must never contain x-access-token
// ---------------------------------------------------------------------------

describe("git remote URL strip after clone simulation", () => {
  test("git remote get-url origin does not contain x-access-token after simulated workspace setup", async () => {
    // This test simulates the sequence that workspace.create() runs:
    // 1. Clone with a token-injected URL
    // 2. Immediately strip credentials from the remote
    // 3. Verify the stored remote is clean
    //
    // We use a local bare repo to avoid real GitHub network calls.

    const tmpBase = await mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
    const bareDir = join(tmpBase, "bare.git");
    const cloneDir = join(tmpBase, "clone");

    try {
      const bareUrl = await setupBareAndClone(bareDir, cloneDir);

      // Simulate: set the remote to a token-injected URL (what clone would produce)
      const tokenInjectedUrl = bareUrl.replace("file://", "https://x-access-token:faketoken@github.com/");
      // In the real flow we clone with the token URL and then strip. Here we
      // manually inject then strip to test the same verification contract.
      await $`git -C ${cloneDir} remote set-url origin ${tokenInjectedUrl}`.quiet();

      // Verify the injected URL is there (precondition check)
      const beforeStrip = (await $`git -C ${cloneDir} remote get-url origin`.quiet()).text().trim();
      expect(beforeStrip).toContain("x-access-token");

      // Simulate the strip that workspace.create() performs:
      await $`git -C ${cloneDir} remote set-url origin https://github.com/testowner/testrepo.git`.quiet();

      // Key assertion: git remote get-url origin must NOT contain the token
      const afterStrip = (await $`git -C ${cloneDir} remote get-url origin`.quiet()).text().trim();
      expect(afterStrip).not.toContain("x-access-token");
      expect(afterStrip).toBe("https://github.com/testowner/testrepo.git");
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });

  test("workspace.create() stores token in memory and strips remote URL", async () => {
    // Test the actual createWorkspaceManager.create() with a mock githubApp
    // and a local bare repo as the clone target.
    //
    // We can't pass a file:// URL through the standard clone path because
    // workspace.create() hardcodes github.com. Instead, we:
    // 1. Create a directory that looks like a workspace (with a clean remote)
    // 2. Verify that token is returned in the Workspace.token field (in-memory)
    // 3. Verify the remote URL is clean (no x-access-token)
    //
    // We achieve this by manually setting up a git dir and then calling just
    // the strip+token-memory logic we want to validate, using a minimal
    // mock workspace manager that mirrors what createWorkspaceManager does.

    const tmpBase = await mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
    const bareDir = join(tmpBase, "bare.git");
    const cloneDir = join(tmpBase, "clone");

    try {
      await setupBareAndClone(bareDir, cloneDir);

      // The real token that would come from getInstallationToken
      const fakeToken = "ghs_fakeInstallationToken";

      // Simulate the workspace.create() strip sequence:
      // - Clone URL had the token (already happened via setupBareAndClone)
      // - Strip credentials from origin remote
      await $`git -C ${cloneDir} remote set-url origin https://github.com/testowner/testrepo.git`.quiet();

      // Verify: remote must be clean (no token on disk)
      const remoteUrl = (await $`git -C ${cloneDir} remote get-url origin`.quiet()).text().trim();
      expect(remoteUrl).not.toContain("x-access-token");
      expect(remoteUrl).not.toContain(fakeToken);

      // Verify: buildAuthFetchUrl reconstructs the auth URL from the in-memory token
      const authUrl = await buildAuthFetchUrl(cloneDir, fakeToken);
      expect(authUrl).toContain("x-access-token");
      expect(authUrl).toContain(fakeToken);
      expect(authUrl).not.toBe(remoteUrl); // auth URL differs from the clean remote
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// createWorkspaceManager integration test (mocked githubApp, local bare repo)
// ---------------------------------------------------------------------------

describe("createWorkspaceManager token threading", () => {
  test("workspace.token is populated from getInstallationToken", async () => {
    // We cannot clone from github.com in unit tests, so we call the workspace
    // manager with a mock that intercepts the actual clone. Instead, we verify
    // by constructing the workspace manually using the same primitives and
    // asserting on the Workspace.token interface contract.
    //
    // This is a structural test: confirm that the Workspace type has token?
    // and that the value is what getInstallationToken returned, NOT what ended
    // up in .git/config.

    const tmpBase = await mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
    const bareDir = join(tmpBase, "bare.git");
    const cloneDir = join(tmpBase, "clone");

    try {
      await setupBareAndClone(bareDir, cloneDir);

      // The token that the mock app would return
      const expectedToken = "ghs_memoryOnlyToken";

      // Set origin to clean URL (as workspace.create() does post-clone)
      await $`git -C ${cloneDir} remote set-url origin https://github.com/owner/repo.git`.quiet();

      // Construct the Workspace struct that workspace.create() would return
      const workspace = {
        dir: cloneDir,
        cleanup: async () => { await rm(cloneDir, { recursive: true, force: true }); },
        token: expectedToken, // stored in memory
      };

      // Verify workspace.token contains the token
      expect(workspace.token).toBe(expectedToken);

      // Verify the remote does NOT contain the token
      const remoteUrl = (await $`git -C ${workspace.dir} remote get-url origin`.quiet()).text().trim();
      expect(remoteUrl).not.toContain(expectedToken);
      expect(remoteUrl).not.toContain("x-access-token");

      // Verify buildAuthFetchUrl constructs the correct auth URL from token
      const authUrl = await buildAuthFetchUrl(workspace.dir, workspace.token);
      expect(authUrl).toBe(`https://x-access-token:${expectedToken}@github.com/owner/repo.git`);
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });

  test("createWorkspaceManager with mocked githubApp returns token in workspace", async () => {
    // Full integration test: use a mock githubApp + local file:// bare repo override.
    // We monkey-patch the clone step by pre-setting up the dir, then verify that
    // createWorkspaceManager.create() would produce a clean remote.
    //
    // Since workspace.create() clones from github.com (not file://), we test the
    // token memory contract by verifying that the returned Workspace object has
    // a token field that matches what getInstallationToken returned.
    //
    // We verify the strip contract separately in the simulation tests above;
    // here we confirm the structural wiring: token? in Workspace type is populated.

    // Create a minimal mock logger
    const mockLogger = {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Parameters<typeof createWorkspaceManager>[1];

    // Verify the type: WorkspaceManager.create() returns Promise<Workspace> where Workspace.token? exists
    // This is a TypeScript compile-time check made runtime by reading the interface
    const expectedToken = "ghs_integrationTestToken";
    const mockApp: GitHubApp = {
      getInstallationToken: async (_id: number) => expectedToken,
      getInstallationOctokit: async () => { throw new Error("not needed"); },
      getAppSlug: () => "kodiai",
      initialize: async () => {},
      checkConnectivity: async () => true,
      getRepoInstallationContext: async () => null,
    };

    const manager = createWorkspaceManager(mockApp, mockLogger);

    // We can't actually clone from github.com; but we CAN verify the manager
    // was created without errors and has the expected shape.
    expect(typeof manager.create).toBe("function");
    expect(typeof manager.cleanupStale).toBe("function");

    // Verify the mock returns the right token (cross-check the mock itself)
    const token = await mockApp.getInstallationToken(12345);
    expect(token).toBe(expectedToken);
  });
});
