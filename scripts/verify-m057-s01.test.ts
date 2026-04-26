import { describe, expect, test } from "bun:test";
import { COMMAND_NAME, runVerifyM057S01 } from "./verify-m057-s01.ts";

describe("runVerifyM057S01", () => {
  test("runs every command and prints pass output", () => {
    const calls: readonly string[][] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    runVerifyM057S01(
      [
        ["bun", "test", "./src/webhook/verify.test.ts"],
        ["bun", "test", "./src/webhook/filters.test.ts"],
        ["bun", "test", "./src/handlers/review.test.ts", "--test-name-pattern", "skips team-only review requests"],
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
      ["bun", "test", "./src/webhook/verify.test.ts"],
      ["bun", "test", "./src/webhook/filters.test.ts"],
      ["bun", "test", "./src/handlers/review.test.ts", "--test-name-pattern", "skips team-only review requests"],
    ]);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([
      "→ bun test ./src/webhook/verify.test.ts\n",
      "→ bun test ./src/webhook/filters.test.ts\n",
      "→ bun test ./src/handlers/review.test.ts --test-name-pattern skips team-only review requests\n",
      `${COMMAND_NAME} passed\n`,
    ]);
  });

  test("writes failure output and exits on first failing command", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode: number | undefined;

    expect(() =>
      runVerifyM057S01(
        [
          ["bun", "test", "./src/webhook/verify.test.ts"],
          ["bun", "test", "./src/webhook/router.test.ts"],
          ["bun", "test", "./src/handlers/review.test.ts", "--test-name-pattern", "skips team-only review requests"],
        ],
        (command) => ({ exitCode: command[2] === "./src/webhook/router.test.ts" ? 1 : 0 }),
        (message) => stdout.push(message),
        (message) => stderr.push(message),
        (code) => {
          exitCode = code;
          throw new Error(`exit(${code})`);
        },
      )
    ).toThrow("exit(1)");

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([
      "→ bun test ./src/webhook/verify.test.ts\n",
      "→ bun test ./src/webhook/router.test.ts\n",
    ]);
    expect(stderr).toEqual([
      `${COMMAND_NAME} failed: bun test ./src/webhook/router.test.ts\n`,
    ]);
  });
});
