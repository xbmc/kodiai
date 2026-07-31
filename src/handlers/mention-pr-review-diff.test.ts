import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
  FABRICATED_CONTENT_DIFF_TIMEOUT_MS,
  FABRICATED_CONTENT_MAX_WARNINGS,
  scanDiffForFabricatedContent,
} from "./mention-pr-review-diff.ts";

describe("scanDiffForFabricatedContent", () => {
  test("retains detector warnings and reports truncated diff output", async () => {
    const repeatedHex = "a".repeat(40);
    let invocation: {
      command: string;
      args: string[];
      env?: Record<string, string | undefined>;
      timeoutMs?: number;
      maxStdoutBytes: number;
    } | undefined;

    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      invocation = params;
      params.onStdoutLine("+++ b/generated.ts");
      params.onStdoutLine("@@ -0,0 +1 @@");
      params.onStdoutLine(`+hash=${repeatedHex}`);

      return {
        exitCode: 1,
        stdout: "",
        stderr: "",
        timedOut: false,
        stdoutTruncated: true,
        stderrTruncated: false,
      };
    });

    expect(invocation?.command).toBe("git");
    expect(invocation?.args).toEqual([
      "-C",
      "/tmp/workspace",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--text",
      "--no-color",
      "HEAD~1",
      "HEAD",
    ]);
    expect(invocation?.env).toEqual({ GIT_NO_REPLACE_OBJECTS: "1" });
    expect(invocation?.timeoutMs).toBe(FABRICATED_CONTENT_DIFF_TIMEOUT_MS);
    expect(invocation?.maxStdoutBytes).toBe(2 * 1024 * 1024);
    expect(result).toEqual({
      warnings: [
        `Suspicious low-entropy hex pattern in added line: \`${repeatedHex}...\``,
      ],
      complete: false,
      reason: "output-truncated",
    });
  });

  test("reports command failure without returning findings from incomplete execution", async () => {
    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      params.onStdoutLine(`+hash=${"a".repeat(40)}`);
      return {
        exitCode: 1,
        stdout: "",
        stderr: "sensitive repository error",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });

    expect(result).toEqual({
      warnings: [],
      complete: false,
      reason: "command-failed",
    });
  });

  test("reports stderr truncation as command failure without findings", async () => {
    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      params.onStdoutLine("@@ -0,0 +1 @@");
      params.onStdoutLine(`+hash=${"a".repeat(40)}`);
      return {
        exitCode: 0,
        stdout: "",
        stderr: "bounded stderr",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: true,
      };
    });

    expect(result).toEqual({
      warnings: [],
      complete: false,
      reason: "command-failed",
    });
  });

  test("reports timeout and thrown process errors as command failure", async () => {
    const timedOut = await scanDiffForFabricatedContent("/tmp/workspace", async () => ({
      exitCode: 124,
      stdout: "",
      stderr: "",
      timedOut: true,
      stdoutTruncated: false,
      stderrTruncated: false,
    }));
    const threw = await scanDiffForFabricatedContent("/tmp/workspace", async () => {
      throw new Error("sensitive process failure");
    });

    expect(timedOut).toEqual({
      warnings: [],
      complete: false,
      reason: "command-failed",
    });
    expect(threw).toEqual({
      warnings: [],
      complete: false,
      reason: "command-failed",
    });
  });

  test("treats timeout as command failure even when stdout is truncated", async () => {
    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      params.onStdoutLine("@@ -0,0 +1 @@");
      params.onStdoutLine(`+hash=${"a".repeat(40)}`);
      return {
        exitCode: 124,
        stdout: "",
        stderr: "",
        timedOut: true,
        stdoutTruncated: true,
        stderrTruncated: false,
      };
    });

    expect(result).toEqual({
      warnings: [],
      complete: false,
      reason: "command-failed",
    });
  });

  test("scans added hunk content beginning with two plus characters", async () => {
    const repeatedHex = "a".repeat(40);
    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      params.onStdoutLine("diff --git a/generated.ts b/generated.ts");
      params.onStdoutLine("--- a/generated.ts");
      params.onStdoutLine("+++ b/generated.ts");
      params.onStdoutLine("@@ -0,0 +1 @@");
      params.onStdoutLine(`+++hash=${repeatedHex}`);
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });

    expect(result).toEqual({
      warnings: [
        `Suspicious low-entropy hex pattern in added line: \`${repeatedHex}...\``,
      ],
      complete: true,
    });
  });

  test("deduplicates warnings from repeated suspicious lines", async () => {
    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      params.onStdoutLine("@@ -0,0 +1,1000 @@");
      for (let index = 0; index < 1_000; index += 1) {
        params.onStdoutLine(`+hash=${"a".repeat(40)}`);
      }
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });

    expect(result.warnings).toEqual([
      `Suspicious low-entropy hex pattern in added line: \`${"a".repeat(40)}...\``,
    ]);
  });

  test("caps distinct detector warnings and represents overflow", async () => {
    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      params.onStdoutLine("@@ -0,0 +1,101 @@");
      for (let index = 0; index < 101; index += 1) {
        const hex = index
          .toString(2)
          .padStart(40, "0")
          .replaceAll("0", "a")
          .replaceAll("1", "b");
        params.onStdoutLine(`+hash=${hex}`);
      }
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });

    expect(result.warnings).toHaveLength(FABRICATED_CONTENT_MAX_WARNINGS);
    expect(new Set(result.warnings).size).toBe(FABRICATED_CONTENT_MAX_WARNINGS);
    expect(result.warnings.filter((warning) => (
      warning === "Additional fabricated-content warnings omitted after reaching the limit."
    ))).toHaveLength(1);
    expect(result.warnings.at(-1)).toBe(
      "Additional fabricated-content warnings omitted after reaching the limit.",
    );
    expect(result.complete).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("resets hunk state at combined diff file boundaries", async () => {
    const hunkHex = "a".repeat(40);
    const headerHex = "b".repeat(40);

    for (const boundary of [
      "diff --cc combined.ts",
      "diff --combined combined.ts",
    ]) {
      const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
        params.onStdoutLine("diff --git a/generated.ts b/generated.ts");
        params.onStdoutLine("@@ -0,0 +1 @@");
        params.onStdoutLine(`+hash=${hunkHex}`);
        params.onStdoutLine(boundary);
        params.onStdoutLine("--- a/combined.ts");
        params.onStdoutLine(`+++ b/${headerHex}`);
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      });

      expect(result.warnings).toEqual([
        `Suspicious low-entropy hex pattern in added line: \`${hunkHex}...\``,
      ]);
    }
  });

  test("scans combined hunk additions from a non-first parent", async () => {
    const repeatedHex = "a".repeat(40);
    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      params.onStdoutLine("diff --cc generated.ts");
      params.onStdoutLine("--- a/generated.ts");
      params.onStdoutLine("+++ b/generated.ts");
      params.onStdoutLine("@@@ -0,0 -0,0 +1 @@@");
      params.onStdoutLine(` +hash=${repeatedHex}`);
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });

    expect(result).toEqual({
      warnings: [
        `Suspicious low-entropy hex pattern in added line: \`${repeatedHex}...\``,
      ],
      complete: true,
    });
  });

  test("ignores a repository-configured external diff that suppresses output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kodiai-fabricated-scan-"));
    const repeatedHex = "a".repeat(40);

    try {
      await $`git -C ${dir} init --initial-branch=main`.quiet();
      await $`git -C ${dir} config user.email test@example.com`.quiet();
      await $`git -C ${dir} config user.name "Test User"`.quiet();
      await Bun.write(join(dir, "generated.txt"), "baseline\n");
      await $`git -C ${dir} add -- generated.txt`.quiet();
      await $`git -C ${dir} commit -m baseline`.quiet();

      await Bun.write(join(dir, "generated.txt"), `baseline\nhash=${repeatedHex}\n`);
      await $`git -C ${dir} add -- generated.txt`.quiet();
      await $`git -C ${dir} commit -m suspicious`.quiet();
      await $`git -C ${dir} config diff.external true`.quiet();

      const result = await scanDiffForFabricatedContent(dir);

      expect(result).toEqual({
        warnings: [
          `Suspicious low-entropy hex pattern in added line: \`${repeatedHex}...\``,
        ],
        complete: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("forces raw hunks for a custom diff driver marked binary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kodiai-fabricated-binary-scan-"));
    const repeatedHex = "a".repeat(40);

    try {
      await $`git -C ${dir} init --initial-branch=main`.quiet();
      await $`git -C ${dir} config user.email test@example.com`.quiet();
      await $`git -C ${dir} config user.name "Test User"`.quiet();
      await Bun.write(join(dir, ".gitattributes"), "generated.txt diff=custom\n");
      await Bun.write(join(dir, "generated.txt"), "baseline\n");
      await $`git -C ${dir} add -- .gitattributes generated.txt`.quiet();
      await $`git -C ${dir} commit -m baseline`.quiet();

      await $`git -C ${dir} config diff.custom.textconv true`.quiet();
      await $`git -C ${dir} config diff.custom.binary true`.quiet();
      await Bun.write(join(dir, "generated.txt"), `baseline\nhash=${repeatedHex}\n`);
      await $`git -C ${dir} add -- generated.txt`.quiet();
      await $`git -C ${dir} commit -m suspicious`.quiet();

      const result = await scanDiffForFabricatedContent(dir);

      expect(result).toEqual({
        warnings: [
          `Suspicious low-entropy hex pattern in added line: \`${repeatedHex}...\``,
        ],
        complete: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("disables repository-configured color so diff markers remain parseable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kodiai-fabricated-color-scan-"));
    const repeatedHex = "a".repeat(40);

    try {
      await $`git -C ${dir} init --initial-branch=main`.quiet();
      await $`git -C ${dir} config user.email test@example.com`.quiet();
      await $`git -C ${dir} config user.name "Test User"`.quiet();
      await Bun.write(join(dir, "generated.txt"), "baseline\n");
      await $`git -C ${dir} add -- generated.txt`.quiet();
      await $`git -C ${dir} commit -m baseline`.quiet();

      await Bun.write(join(dir, "generated.txt"), `baseline\nhash=${repeatedHex}\n`);
      await $`git -C ${dir} add -- generated.txt`.quiet();
      await $`git -C ${dir} commit -m suspicious`.quiet();
      await $`git -C ${dir} config color.ui always`.quiet();

      const result = await scanDiffForFabricatedContent(dir);

      expect(result).toEqual({
        warnings: [
          `Suspicious low-entropy hex pattern in added line: \`${repeatedHex}...\``,
        ],
        complete: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
