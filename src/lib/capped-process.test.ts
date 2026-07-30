import { expect, test } from "bun:test";
import {
  runCommandWithCappedLines,
  runCommandWithCappedOutput,
} from "./capped-process.ts";

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

test("preserves an initial UTF-8 BOM when requested", async () => {
  const result = await runCommandWithCappedOutput({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write(Buffer.from([0xef, 0xbb, 0xbf, 0x70, 0x61, 0x74, 0x68, 0x00]))",
    ],
    maxStdoutBytes: 64,
    stdoutDecoderOptions: { fatal: true, ignoreBOM: true },
  });

  expect(result.stdout).toBe("\uFEFFpath\0");
});

test("rejects invalid UTF-8 when fatal stdout decoding is requested", async () => {
  await expect(
    runCommandWithCappedOutput({
      command: process.execPath,
      args: ["-e", "process.stdout.write(Buffer.from([0x66, 0x80, 0x00]))"],
      maxStdoutBytes: 64,
      stdoutDecoderOptions: { fatal: true, ignoreBOM: true },
    }),
  ).rejects.toBeInstanceOf(TypeError);
});
