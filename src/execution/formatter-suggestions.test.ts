import { describe, expect, test } from "bun:test";
import {
  FORMATTER_STDERR_SUMMARY_MAX_CHARS,
  parseFormatterUnifiedDiff,
  resolveFormatterCommand,
  runFormatterCommand,
  type FormatterProcessRunner,
} from "./formatter-suggestions.ts";

const workspaceDir = "/tmp/kodiai-workspace";

function createRunner(
  result: Awaited<ReturnType<FormatterProcessRunner>>,
): FormatterProcessRunner {
  return async () => result;
}

describe("resolveFormatterCommand", () => {
  test("returns undefined for blank or missing formatter commands", () => {
    expect(resolveFormatterCommand({ command: undefined, baseRef: "main", headRef: "feature", diffRange: "origin/main...HEAD" })).toBeUndefined();
    expect(resolveFormatterCommand({ command: "   ", baseRef: "main", headRef: "feature", diffRange: "origin/main...HEAD" })).toBeUndefined();
  });

  test("substitutes only allowlisted placeholders and leaves unknown braces literal", () => {
    const resolved = resolveFormatterCommand({
      command: "bun run format --base {baseRef} --head {headRef} --range {diffRange} --literal {workspaceDir} ${GITHUB_TOKEN}",
      baseRef: "main",
      headRef: "feature/format",
      diffRange: "origin/main...HEAD",
    });

    expect(resolved).toBe("bun run format --base main --head feature/format --range origin/main...HEAD --literal {workspaceDir} ${GITHUB_TOKEN}");
  });
});

describe("parseFormatterUnifiedDiff", () => {
  test("parses one modified file with one hunk and cursor positions", () => {
    const result = parseFormatterUnifiedDiff([
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@ function demo()",
      " const keep = true;",
      "-const oldName = 1;",
      "+const newName = 1;",
      " export { keep };",
      "",
    ].join("\n"));

    expect(result.skipped).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({
      oldPath: "src/a.ts",
      newPath: "src/a.ts",
      hunks: [
        {
          oldStart: 1,
          oldLineCount: 3,
          newStart: 1,
          newLineCount: 3,
          section: "function demo()",
          lines: [
            { kind: "context", text: "const keep = true;", oldLine: 1, newLine: 1 },
            { kind: "removed", text: "const oldName = 1;", oldLine: 2, newLine: undefined },
            { kind: "added", text: "const newName = 1;", oldLine: undefined, newLine: 2 },
            { kind: "context", text: "export { keep };", oldLine: 3, newLine: 3 },
          ],
        },
      ],
    });
  });

  test("parses multiple files and multiple hunks with default one-line counts", () => {
    const result = parseFormatterUnifiedDiff([
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10 +10 @@",
      "-oldA",
      "+newA",
      "@@ -20,2 +20,2 @@",
      " keepA",
      "-oldB",
      "+newB",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -3 +3 @@",
      "-oldC",
      "+newC",
      "",
    ].join("\n"));

    expect(result.skipped).toEqual([]);
    expect(result.files.map((file) => file.newPath)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.files[0]?.hunks).toHaveLength(2);
    expect(result.files[0]?.hunks[0]).toMatchObject({ oldStart: 10, oldLineCount: 1, newStart: 10, newLineCount: 1 });
    expect(result.files[1]?.hunks[0]?.lines).toContainEqual({ kind: "added", text: "newC", oldLine: undefined, newLine: 3 });
  });

  test("preserves blank added lines and ignores no-newline markers", () => {
    const result = parseFormatterUnifiedDiff([
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,3 @@",
      " line",
      "+",
      "+next",
      "\\ No newline at end of file",
      "",
    ].join("\n"));

    expect(result.skipped).toEqual([]);
    expect(result.files[0]?.hunks[0]?.lines).toEqual([
      { kind: "context", text: "line", oldLine: 1, newLine: 1 },
      { kind: "added", text: "", oldLine: undefined, newLine: 2 },
      { kind: "added", text: "next", oldLine: undefined, newLine: 3 },
    ]);
  });

  test("returns empty parsed files for an empty diff", () => {
    expect(parseFormatterUnifiedDiff("")).toEqual({ files: [], skipped: [] });
  });

  test("skips binary, added, deleted, renamed, and malformed file diffs conservatively", () => {
    const result = parseFormatterUnifiedDiff([
      "diff --git a/src/binary.png b/src/binary.png",
      "Binary files a/src/binary.png and b/src/binary.png differ",
      "diff --git a/src/added.ts b/src/added.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/added.ts",
      "@@ -0,0 +1 @@",
      "+added",
      "diff --git a/src/deleted.ts b/src/deleted.ts",
      "deleted file mode 100644",
      "--- a/src/deleted.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-deleted",
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 98%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "--- a/src/old.ts",
      "+++ b/src/new.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/malformed.ts b/src/malformed.ts",
      "--- a/src/malformed.ts",
      "+++ b/src/malformed.ts",
      "@@ nope @@",
      "+bad",
      "",
    ].join("\n"));

    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([
      { reason: "unsupported-file", detail: "binary diff is not supported", oldPath: "src/binary.png", newPath: "src/binary.png" },
      { reason: "unsupported-file", detail: "added file is not supported", oldPath: undefined, newPath: "src/added.ts" },
      { reason: "unsupported-file", detail: "deleted file is not supported", oldPath: "src/deleted.ts", newPath: undefined },
      { reason: "unsupported-file", detail: "renamed file is not supported", oldPath: "src/old.ts", newPath: "src/new.ts" },
      { reason: "malformed-diff", detail: "file has diff body but no valid hunks", oldPath: "src/malformed.ts", newPath: "src/malformed.ts" },
    ]);
  });

  test("skips malformed hunk ranges instead of guessing", () => {
    const result = parseFormatterUnifiedDiff([
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,x +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n"));

    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([
      { reason: "malformed-diff", detail: "file has diff body but no valid hunks", oldPath: "src/a.ts", newPath: "src/a.ts" },
    ]);
  });
});

describe("runFormatterCommand", () => {
  test("returns no-command without invoking a process for a missing command", async () => {
    let calls = 0;
    const result = await runFormatterCommand({
      workspaceDir,
      command: undefined,
      baseRef: "main",
      headRef: "feature",
      diffRange: "origin/main...HEAD",
      timeoutMs: 1000,
      runProcess: async () => {
        calls += 1;
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      },
    });

    expect(calls).toBe(0);
    expect(result.status).toBe("no-command");
    expect(result.resolvedCommand).toBeUndefined();
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBeUndefined();
    expect(result.timedOut).toBe(false);
  });

  test("passes resolved command, workspace cwd, and timeout to the injected process runner", async () => {
    const calls: Parameters<FormatterProcessRunner>[0][] = [];
    const result = await runFormatterCommand({
      workspaceDir,
      command: "formatter --base {baseRef} --head {headRef} --range {diffRange}",
      baseRef: "main",
      headRef: "feature",
      diffRange: "origin/main...HEAD",
      timeoutMs: 1234,
      runProcess: async (request) => {
        calls.push(request);
        return { exitCode: 0, stdout: "diff --git a/a.ts b/a.ts\n", stderr: "", timedOut: false, durationMs: 7 };
      },
    });

    expect(calls).toEqual([{ command: "formatter --base main --head feature --range origin/main...HEAD", cwd: workspaceDir, timeoutMs: 1234 }]);
    expect(result.status).toBe("success");
    expect(result.resolvedCommand).toBe("formatter --base main --head feature --range origin/main...HEAD");
    expect(result.stdout).toBe("diff --git a/a.ts b/a.ts\n");
    expect(result.durationMs).toBe(7);
  });

  test("returns no-op for exit 0 with whitespace-only stdout", async () => {
    const result = await runFormatterCommand({
      workspaceDir,
      command: "formatter",
      baseRef: "main",
      headRef: "feature",
      diffRange: "origin/main...HEAD",
      timeoutMs: 1000,
      runProcess: createRunner({ exitCode: 0, stdout: " \n\t ", stderr: "", timedOut: false, durationMs: 4 }),
    });

    expect(result.status).toBe("no-op");
    expect(result.stdout).toBe(" \n\t ");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test("returns success for exit 0 with formatter diff stdout", async () => {
    const stdout = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const result = await runFormatterCommand({
      workspaceDir,
      command: "formatter",
      baseRef: "main",
      headRef: "feature",
      diffRange: "origin/main...HEAD",
      timeoutMs: 1000,
      runProcess: createRunner({ exitCode: 0, stdout, stderr: "", timedOut: false, durationMs: 9 }),
    });

    expect(result.status).toBe("success");
    expect(result.stdout).toBe(stdout);
    expect(result.exitCode).toBe(0);
  });

  test("returns failed with bounded and redacted stderr summary for nonzero exit", async () => {
    const token = `ghp_${"a".repeat(36)}`;
    const longStderr = `${token}\n${"x".repeat(FORMATTER_STDERR_SUMMARY_MAX_CHARS + 50)}`;
    const result = await runFormatterCommand({
      workspaceDir,
      command: "formatter",
      baseRef: "main",
      headRef: "feature",
      diffRange: "origin/main...HEAD",
      timeoutMs: 1000,
      runProcess: createRunner({ exitCode: 2, stdout: "partial", stderr: longStderr, timedOut: false, durationMs: 12 }),
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    expect(result.stderrSummary).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(result.stderrSummary).not.toContain(token);
    expect(result.stderrSummary.length).toBeLessThanOrEqual(FORMATTER_STDERR_SUMMARY_MAX_CHARS);
    expect(result.stdout).toBe("partial");
  });

  test("returns timed-out when the process runner reports a timeout", async () => {
    const result = await runFormatterCommand({
      workspaceDir,
      command: "formatter",
      baseRef: "main",
      headRef: "feature",
      diffRange: "origin/main...HEAD",
      timeoutMs: 1000,
      runProcess: createRunner({ exitCode: 124, stdout: "", stderr: "hung", timedOut: true, durationMs: 1000 }),
    });

    expect(result.status).toBe("timed-out");
    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.stderrSummary).toBe("hung");
  });
});
