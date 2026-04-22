import { describe, expect, test } from "bun:test";
import { COMMAND_NAME, runVerifyM057S04 } from "./verify-m057-s04.ts";

describe("runVerifyM057S04", () => {
  test("runs every command and prints pass output", () => {
    const calls: readonly string[][] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    runVerifyM057S04(
      [
        ["bun", "test", "./a.test.ts"],
        ["bun", "run", "./b.ts", "--json"],
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
      ["bun", "run", "./b.ts", "--json"],
    ]);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([
      "→ bun test ./a.test.ts\n",
      "→ bun run ./b.ts --json\n",
      `${COMMAND_NAME} passed\n`,
    ]);
  });

  test("writes failure output and defaults null exit codes to 1", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode: number | undefined;

    expect(() =>
      runVerifyM057S04(
        [
          ["bun", "test", "./a.test.ts"],
          ["bun", "run", "./b.ts", "--json"],
        ],
        (command) => ({ exitCode: command[2] === "./a.test.ts" ? 0 : null as unknown as number }),
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
      "→ bun run ./b.ts --json\n",
    ]);
    expect(stderr).toEqual([`${COMMAND_NAME} failed: bun run ./b.ts --json\n`]);
  });
});
