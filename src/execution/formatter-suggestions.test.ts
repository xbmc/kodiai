import { describe, expect, test } from "bun:test";
import {
  FORMATTER_STDERR_SUMMARY_MAX_CHARS,
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
