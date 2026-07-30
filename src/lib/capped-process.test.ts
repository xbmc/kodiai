import { expect, test } from "bun:test";
import { runCommandWithCappedLines } from "./capped-process.ts";

test("streams complete stdout lines without retaining stdout", async () => {
  const lines: string[] = [];
  const result = await runCommandWithCappedLines({
    command: process.execPath,
    args: ["-e", "process.stdout.write('alpha\\nbeta')"],
    maxStdoutBytes: 64,
    onStdoutLine: (line) => lines.push(line),
  });
  expect(lines).toEqual(["alpha", "beta"]);
  expect(result.stdout).toBe("");
  expect(result.stdoutTruncated).toBe(false);
});

test("stops line delivery and reports truncation at the byte limit", async () => {
  const lines: string[] = [];
  const result = await runCommandWithCappedLines({
    command: process.execPath,
    args: ["-e", "process.stdout.write('1234\\n5678\\n')"],
    maxStdoutBytes: 6,
    onStdoutLine: (line) => lines.push(line),
  });
  expect(lines).toEqual(["1234"]);
  expect(result.stdout).toBe("");
  expect(result.stdoutTruncated).toBe(true);
});

test("propagates stdout callback errors without an unhandled rejection", async () => {
  await expect(runCommandWithCappedLines({
    command: process.execPath,
    args: ["-e", "process.stdout.write('line\\n'); setTimeout(() => {}, 1_000)"],
    maxStdoutBytes: 64,
    onStdoutLine: () => {
      throw new Error("callback boom");
    },
  })).rejects.toThrow("callback boom");
});

test("does not emit an unterminated line when the process times out", async () => {
  const lines: string[] = [];
  const result = await runCommandWithCappedLines({
    command: process.execPath,
    args: ["-e", "process.stdout.write('partial'); setTimeout(() => {}, 1_000)"],
    timeoutMs: 20,
    maxStdoutBytes: 64,
    onStdoutLine: (line) => lines.push(line),
  });

  expect(lines).toEqual([]);
  expect(result.timedOut).toBe(true);
});

test("does not emit an unterminated line when the stderr cap kills the process", async () => {
  const lines: string[] = [];
  const result = await runCommandWithCappedLines({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('partial'); setTimeout(() => process.stderr.write('overflow'), 10); setTimeout(() => {}, 1_000)",
    ],
    maxStdoutBytes: 64,
    maxStderrBytes: 3,
    onStdoutLine: (line) => lines.push(line),
  });

  expect(lines).toEqual([]);
  expect(result.stderrTruncated).toBe(true);
});

test("strips CRLF terminators split across stdout chunks", async () => {
  const lines: string[] = [];
  await runCommandWithCappedLines({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('a\\r'); setTimeout(() => process.stdout.write('\\nb\\r'), 10); setTimeout(() => process.stdout.write('\\n'), 20)",
    ],
    maxStdoutBytes: 64,
    onStdoutLine: (line) => lines.push(line),
  });

  expect(lines).toEqual(["a", "b"]);
});
