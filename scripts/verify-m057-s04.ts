export const COMMAND_NAME = "verify:m057:s04" as const;
export const VERIFY_COMMANDS = [
  ["bun", "test", "./scripts/check-orphaned-tests.test.ts"],
  ["bun", "test", "./src/execution/executor.test.ts"],
  ["bun", "run", "./scripts/check-orphaned-tests.ts", "--json"],
] as const;

type VerifyCommand = (typeof VERIFY_COMMANDS)[number];

function formatCommand(command: readonly string[]): string {
  return command.join(" ");
}

export function runVerifyM057S04(commands: readonly VerifyCommand[] = VERIFY_COMMANDS): void {
  for (const command of commands) {
    const formatted = formatCommand(command);
    process.stdout.write(`→ ${formatted}\n`);

    const result = Bun.spawnSync({
      cmd: [...command],
      stdout: "inherit",
      stderr: "inherit",
    });

    if (result.exitCode !== 0) {
      process.stderr.write(`${COMMAND_NAME} failed: ${formatted}\n`);
      process.exit(result.exitCode);
    }
  }

  process.stdout.write(`${COMMAND_NAME} passed\n`);
}

if (import.meta.main) {
  runVerifyM057S04();
}
