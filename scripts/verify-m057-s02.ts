const COMMAND_NAME = "verify:m057:s02" as const;
const TEST_COMMANDS = [
  ["bun", "test", "./src/handlers/ci-failure.test.ts"],
  ["bun", "test", "./src/lib/ci-failure-classifier.test.ts"],
] as const;

type TestCommand = (typeof TEST_COMMANDS)[number];

function formatCommand(command: TestCommand): string {
  return command.join(" ");
}

for (const command of TEST_COMMANDS) {
  const [cmd, ...args] = command;
  const formatted = formatCommand(command);
  process.stdout.write(`→ ${formatted}\n`);

  const result = Bun.spawnSync({
    cmd: [cmd, ...args],
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    process.stderr.write(`${COMMAND_NAME} failed: ${formatted}\n`);
    process.exit(result.exitCode);
  }
}

process.stdout.write(`${COMMAND_NAME} passed\n`);
