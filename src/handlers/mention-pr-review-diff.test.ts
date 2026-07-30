import { describe, expect, test } from "bun:test";
import {
  FABRICATED_CONTENT_MAX_WARNINGS,
  scanDiffForFabricatedContent,
} from "./mention-pr-review-diff.ts";

describe("scanDiffForFabricatedContent", () => {
  test("retains detector warnings and reports truncated diff output", async () => {
    const repeatedHex = "a".repeat(40);

    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      expect(params.command).toBe("git");
      expect(params.args).toEqual(["-C", "/tmp/workspace", "diff", "HEAD~1", "HEAD"]);
      expect(params.maxStdoutBytes).toBe(2 * 1024 * 1024);
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

  test("caps distinct detector warnings", async () => {
    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      params.onStdoutLine("@@ -0,0 +1,1000 @@");
      for (let index = 0; index < 1_000; index += 1) {
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
  });
});
