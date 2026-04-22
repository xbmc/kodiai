export const COMMAND_NAME = "verify:m057:s03" as const;
export const TEST_COMMANDS = [
  ["bun", "test", "./src/jobs/fork-manager.test.ts"],
  ["bun", "test", "./src/jobs/gist-publisher.test.ts"],
  ["bun", "test", "./src/slack/write-runner.test.ts"],
  ["bun", "test", "./src/handlers/mention.test.ts"],
] as const;

type TestCommand = readonly string[];

type SpawnSyncResult = {
  exitCode: number | null;
};

type SpawnSyncFn = (command: readonly string[]) => SpawnSyncResult;
type WriteFn = (message: string) => void;
type ExitFn = (code: number) => never;

function formatCommand(command: readonly string[]): string {
  return command.join(" ");
}

function defaultSpawnSync(command: readonly string[]): SpawnSyncResult {
  return Bun.spawnSync({
    cmd: [...command],
    stdout: "inherit",
    stderr: "inherit",
  });
}

export function runVerifyM057S03(
  commands: readonly TestCommand[] = TEST_COMMANDS,
  spawnSyncFn: SpawnSyncFn = defaultSpawnSync,
  stdoutWrite: WriteFn = (message) => process.stdout.write(message),
  stderrWrite: WriteFn = (message) => process.stderr.write(message),
  exitFn: ExitFn = (code) => process.exit(code),
): void {
  for (const command of commands) {
    const formatted = formatCommand(command);
    stdoutWrite(`→ ${formatted}\n`);

    const result = spawnSyncFn(command);

    if (result.exitCode !== 0) {
      stderrWrite(`${COMMAND_NAME} failed: ${formatted}\n`);
      exitFn(result.exitCode ?? 1);
    }
  }

  stdoutWrite(`${COMMAND_NAME} passed\n`);
}

if (import.meta.main) {
  runVerifyM057S03();
}
