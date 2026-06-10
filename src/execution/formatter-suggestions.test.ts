import { describe, expect, test } from "bun:test";
import {
  FORMATTER_STDERR_SUMMARY_MAX_CHARS,
  buildPrDiffCommentabilityIndex,
  mapFormatterDiffToSuggestions,
  parseFormatterUnifiedDiff,
  readProcessStreamForFormatter,
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

describe("buildPrDiffCommentabilityIndex", () => {
  test("records RIGHT-side context and added lines but excludes deletions", () => {
    const index = buildPrDiffCommentabilityIndex([
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " keep one",
      "-removed",
      "+added",
      " keep two",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -10 +11 @@",
      "+new b",
      "",
    ].join("\n"));

    expect([...index.get("src/a.ts") ?? []]).toEqual([1, 2, 3]);
    expect([...index.get("src/b.ts") ?? []]).toEqual([11]);
  });

  test("malformed PR diff hunks do not invent commentable lines", () => {
    const index = buildPrDiffCommentabilityIndex([
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ nope @@",
      "+added",
      "",
    ].join("\n"));

    expect(index.get("src/a.ts")).toBeUndefined();
  });
});

describe("mapFormatterDiffToSuggestions", () => {
  test("maps one-line replacements to line-only RIGHT-side GitHub suggestions", () => {
    const formatterDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -2 +2 @@",
      "-const oldName = 1;",
      "+const newName = 1;",
      "",
    ].join("\n");
    const prDiffIndex = new Map([["src/a.ts", new Set([2])]]);

    const result = mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex, maxSuggestions: 10 });

    expect(result.suggestions).toEqual([
      {
        path: "src/a.ts",
        line: 2,
        side: "RIGHT",
        suggestionBody: "```suggestion\nconst newName = 1;\n```",
        oldStart: 2,
        oldEnd: 2,
        newStart: 2,
        hunkHeader: "@@ -2 +2 @@",
      },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.counts).toMatchObject({ suggestions: 1, skipped: 0, capped: 0 });
    expect(result.capped).toBe(false);
  });

  test("maps multi-line and uneven-count replacements when every old target line is commentable", () => {
    const formatterDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,2 +10,3 @@",
      "-const a = 1;",
      "-const b = 2;",
      "+const a = 1;",
      "+",
      "+const b = 2;",
      "",
    ].join("\n");
    const prDiffIndex = new Map([["src/a.ts", new Set([10, 11])]]);

    const result = mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex, maxSuggestions: 10 });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ path: "src/a.ts", startLine: 10, line: 11, side: "RIGHT", oldStart: 10, oldEnd: 11, newStart: 10 });
    expect(result.suggestions[0]?.suggestionBody).toBe("```suggestion\nconst a = 1;\n\nconst b = 2;\n```");
    expect(result.skipped).toEqual([]);
  });

  test("skips pure insertions and pure deletions", () => {
    const formatterDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,3 @@",
      " keep",
      "+inserted",
      " keep too",
      "@@ -10,2 +10 @@",
      " keep before",
      "-deleted",
      " keep after",
      "",
    ].join("\n");
    const prDiffIndex = new Map([["src/a.ts", new Set([1, 2, 10, 11])]]);

    const result = mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex, maxSuggestions: 10 });

    expect(result.suggestions).toEqual([]);
    expect(result.skipped.map((skip) => skip.reason)).toEqual(["pure-insertion", "pure-deletion"]);
    expect(result.counts).toMatchObject({ suggestions: 0, skipped: 2, capped: 0 });
  });

  test("skips formatter replacement ranges outside the PR diff RIGHT-side index", () => {
    const formatterDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5 +5 @@",
      "-old",
      "+new",
      "",
    ].join("\n");

    const result = mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex: new Map(), maxSuggestions: 10 });

    expect(result.suggestions).toEqual([]);
    expect(result.skipped).toEqual([
      { reason: "target-range-not-in-pr-diff", detail: "src/a.ts:5-5 is not fully commentable on the PR RIGHT side", oldPath: "src/a.ts", newPath: "src/a.ts" },
    ]);
  });

  test("skips path mismatches and off-by-one target ranges without guessing", () => {
    const formatterDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5 +5 @@",
      "-old path mismatch",
      "+new path mismatch",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -10,2 +10,2 @@",
      "-old one",
      "-old two",
      "+new one",
      "+new two",
      "",
    ].join("\n");
    const prDiffIndex = new Map([
      ["src/other.ts", new Set([5])],
      ["src/b.ts", new Set([10])],
    ]);

    const result = mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex, maxSuggestions: 10 });

    expect(result.suggestions).toEqual([]);
    expect(result.skipped).toEqual([
      { reason: "target-range-not-in-pr-diff", detail: "src/a.ts:5-5 is not fully commentable on the PR RIGHT side", oldPath: "src/a.ts", newPath: "src/a.ts" },
      { reason: "target-range-not-in-pr-diff", detail: "src/b.ts:10-11 is not fully commentable on the PR RIGHT side", oldPath: "src/b.ts", newPath: "src/b.ts" },
    ]);
  });

  test("returns partial success for mixed safe and unsafe formatter hunks", () => {
    const formatterDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -2 +2 @@",
      "-old safe",
      "+new safe",
      "@@ -8 +8 @@",
      "-old unsafe",
      "+new unsafe",
      "",
    ].join("\n");
    const prDiffIndex = new Map([["src/a.ts", new Set([2])]]);

    const result = mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex, maxSuggestions: 10 });

    expect(result.suggestions.map((suggestion) => suggestion.line)).toEqual([2]);
    expect(result.skipped.map((skip) => skip.reason)).toEqual(["target-range-not-in-pr-diff"]);
    expect(result.counts).toMatchObject({ suggestions: 1, skipped: 1, capped: 0 });
  });

  test("caps safe candidates after validation and records dropped suggestions", () => {
    const formatterDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old one",
      "+new one",
      "@@ -2 +2 @@",
      "-old two",
      "+new two",
      "@@ -3 +3 @@",
      "-old three",
      "+new three",
      "",
    ].join("\n");
    const prDiffIndex = new Map([["src/a.ts", new Set([1, 2, 3])]]);

    const result = mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex, maxSuggestions: 1 });

    expect(result.suggestions.map((suggestion) => suggestion.line)).toEqual([1]);
    expect(result.capped).toBe(true);
    expect(result.skipped.map((skip) => skip.reason)).toEqual(["max-suggestions-exceeded", "max-suggestions-exceeded"]);
    expect(result.counts).toMatchObject({ suggestions: 1, skipped: 2, capped: 2 });
  });

  test("propagates parser skips into mapper diagnostics", () => {
    const formatterDiff = [
      "diff --git a/src/added.ts b/src/added.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/added.ts",
      "@@ -0,0 +1 @@",
      "+added",
      "",
    ].join("\n");

    const result = mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex: new Map(), maxSuggestions: 10 });

    expect(result.suggestions).toEqual([]);
    expect(result.skipped).toEqual([
      { reason: "unsupported-file", detail: "added file is not supported", oldPath: undefined, newPath: "src/added.ts" },
    ]);
    expect(result.counts).toMatchObject({ suggestions: 0, skipped: 1, parserSkipped: 1 });
  });
});

describe("runFormatterCommand", () => {
  test("caps process stream reads before buffering the entire formatter output", async () => {
    let cancelCalled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("abcdef"));
        controller.enqueue(encoder.encode("ghijkl"));
      },
      cancel() {
        cancelCalled = true;
      },
    });

    const text = await readProcessStreamForFormatter(stream, 5);

    expect(text).toBe("abcde");
    expect(cancelCalled).toBe(true);
  });

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
      command: "prettier --base {baseRef} --head {headRef} --range {diffRange}",
      baseRef: "main",
      headRef: "feature",
      diffRange: "origin/main...HEAD",
      timeoutMs: 1234,
      runProcess: async (request) => {
        calls.push(request);
        return { exitCode: 0, stdout: "diff --git a/a.ts b/a.ts\n", stderr: "", timedOut: false, durationMs: 7 };
      },
    });

    expect(calls).toEqual([{ command: "prettier --base main --head feature --range origin/main...HEAD", cwd: workspaceDir, timeoutMs: 1234 }]);
    expect(result.status).toBe("success");
    expect(result.resolvedCommand).toBe("prettier --base main --head feature --range origin/main...HEAD");
    expect(result.stdout).toBe("diff --git a/a.ts b/a.ts\n");
    expect(result.durationMs).toBe(7);
  });

  test("returns no-op for exit 0 with whitespace-only stdout", async () => {
    const result = await runFormatterCommand({
      workspaceDir,
      command: "prettier",
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
      command: "prettier",
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

  test("returns success for nonzero exit with formatter diff stdout", async () => {
    const stdout = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const result = await runFormatterCommand({
      workspaceDir,
      command: "prettier --diff",
      baseRef: "main",
      headRef: "feature",
      diffRange: "origin/main...HEAD",
      timeoutMs: 1000,
      runProcess: createRunner({ exitCode: 1, stdout, stderr: "", timedOut: false, durationMs: 10 }),
    });

    expect(result.status).toBe("success");
    expect(result.stdout).toBe(stdout);
    expect(result.exitCode).toBe(1);
  });

  test("returns failed with bounded and redacted stderr summary for nonzero exit", async () => {
    const token = `ghp_${"a".repeat(36)}`;
    const longStderr = `${token}\n${"x".repeat(FORMATTER_STDERR_SUMMARY_MAX_CHARS + 50)}`;
    const result = await runFormatterCommand({
      workspaceDir,
      command: "prettier",
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
      command: "prettier",
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

  test("returns command-rejected for shell pipelines without invoking a process", async () => {
    let calls = 0;
    const result = await runFormatterCommand({
      workspaceDir,
      command: "git clang-format --diff origin/main HEAD | head",
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
    expect(result.status).toBe("command-rejected");
    expect(result.stderrSummary).toBe("shell-metacharacters");
    expect(result.exitCode).toBe(126);
  });
});
