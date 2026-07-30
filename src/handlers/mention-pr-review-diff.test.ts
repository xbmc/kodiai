import { describe, expect, test } from "bun:test";
import { scanDiffForFabricatedContent } from "./mention-pr-review-diff.ts";

describe("scanDiffForFabricatedContent", () => {
  test("retains detector warnings and reports truncated diff output", async () => {
    const repeatedHex = "a".repeat(40);

    const result = await scanDiffForFabricatedContent("/tmp/workspace", async (params) => {
      expect(params.command).toBe("git");
      expect(params.args).toEqual(["-C", "/tmp/workspace", "diff", "HEAD~1", "HEAD"]);
      expect(params.maxStdoutBytes).toBe(2 * 1024 * 1024);
      params.onStdoutLine("+++ b/generated.ts");
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
});
