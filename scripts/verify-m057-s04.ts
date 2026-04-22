export const COMMAND_NAME = "verify:m057:s04" as const;
export const VERIFY_COMMANDS = [
  ["bun", "test", "./scripts/check-orphaned-tests.test.ts"],
  ["bun", "test", "./src/execution/executor.test.ts"],
  ["bun", "run", "./scripts/check-orphaned-tests.ts", "--json"],
] as const;

type VerifyCommand = readonly string[];
type SpawnSyncFn = (command: VerifyCommand) => { exitCode: number | null | undefined };
type WriteFn = (message: string) => void;
type ExitFn = (code: number) => never;

function formatCommand(command: readonly string[]): string {
  return command.join(" ");
}

export function runVerifyM057S04(
  commands: readonly VerifyCommand[] = VERIFY_COMMANDS,
  spawnSyncFn: SpawnSyncFn = (command) =>
    Bun.spawnSync({
      cmd: [...command],
      stdout: "inherit",
      stderr: "inherit",
    }),
  writeStdout: WriteFn = (message) => process.stdout.write(message),
  writeStderr: WriteFn = (message) => process.stderr.write(message),
  exitFn: ExitFn = (code) => process.exit(code),
): void {
  for (const command of commands) {
    const formatted = formatCommand(command);
    writeStdout(`→ ${formatted}\n`);

    const result = spawnSyncFn(command);
    if ((result.exitCode ?? 1) !== 0) {
      writeStderr(`${COMMAND_NAME} failed: ${formatted}\n`);
      exitFn(result.exitCode ?? 1);
      return;
    }
  }

  writeStdout(`${COMMAND_NAME} passed\n`);
}

if (import.meta.main) {
  runVerifyM057S04();
}
