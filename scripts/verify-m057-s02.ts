const COMMAND_NAME = "verify:m057:s02" as const;
const TEST_COMMANDS = [
  ["bun", "test", "./src/handlers/ci-failure.test.ts"],
  ["bun", "test", "./src/lib/ci-failure-classifier.test.ts"],
] as const;

type TestCommand = (typeof TEST_COMMANDS)[number];
type SpawnSyncFn = (command: TestCommand) => { exitCode: number };
type WriteFn = (message: string) => void;
type ExitFn = (code: number) => never;

function formatCommand(command: TestCommand): string {
  return command.join(" ");
}

export function runVerifyM057S02(
  commands: readonly TestCommand[] = TEST_COMMANDS,
  spawnSyncFn: SpawnSyncFn = (command) => {
    const [cmd, ...args] = command;
    return Bun.spawnSync({
      cmd: [cmd, ...args],
      stdout: "inherit",
      stderr: "inherit",
    });
  },
  writeStdout: WriteFn = (message) => process.stdout.write(message),
  writeStderr: WriteFn = (message) => process.stderr.write(message),
  exitFn: ExitFn = (code) => process.exit(code),
): void {
  for (const command of commands) {
    const formatted = formatCommand(command);
    writeStdout(`→ ${formatted}\n`);

    const result = spawnSyncFn(command);
    if (result.exitCode !== 0) {
      writeStderr(`${COMMAND_NAME} failed: ${formatted}\n`);
      exitFn(result.exitCode);
      return;
    }
  }

  writeStdout(`${COMMAND_NAME} passed\n`);
}

export { COMMAND_NAME, TEST_COMMANDS };

if (import.meta.main) {
  runVerifyM057S02();
}
