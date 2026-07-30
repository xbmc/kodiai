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
