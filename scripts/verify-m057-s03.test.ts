import { describe, expect, test } from "bun:test";
import { COMMAND_NAME, runVerifyM057S03 } from "./verify-m057-s03.ts";

describe("runVerifyM057S03", () => {
  test("runs every command and prints pass output", () => {
    const calls: readonly string[][] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    runVerifyM057S03(
      [
        ["bun", "test", "./a.test.ts"],
        ["bun", "test", "./b.test.ts"],
      ],
      (command) => {
        (calls as string[][]).push([...command]);
        return { exitCode: 0 };
      },
      (message) => stdout.push(message),
      (message) => stderr.push(message),
      (code) => {
        throw new Error(`unexpected exit(${code})`);
      },
    );

    expect(calls).toEqual([
      ["bun", "test", "./a.test.ts"],
      ["bun", "test", "./b.test.ts"],
    ]);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([
      "→ bun test ./a.test.ts\n",
      "→ bun test ./b.test.ts\n",
      `${COMMAND_NAME} passed\n`,
    ]);
  });

  test("writes failure output and exits on first failing command", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode: number | undefined;

    expect(() =>
      runVerifyM057S03(
        [
          ["bun", "test", "./a.test.ts"],
          ["bun", "test", "./b.test.ts"],
        ],
        (command) => ({ exitCode: command[2] === "./a.test.ts" ? 0 : 1 }),
        (message) => stdout.push(message),
        (message) => stderr.push(message),
        (code) => {
          exitCode = code;
          throw new Error(`exit(${code})`);
        },
      ),
    ).toThrow("exit(1)");

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([
      "→ bun test ./a.test.ts\n",
      "→ bun test ./b.test.ts\n",
    ]);
    expect(stderr).toEqual([`${COMMAND_NAME} failed: bun test ./b.test.ts\n`]);
  });
});
