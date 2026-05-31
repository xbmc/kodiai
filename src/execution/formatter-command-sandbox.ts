export type FormatterCommandExecutionMode = "argv" | "shell-fallback";

export type FormatterCommandSpawnPlan =
  | { mode: "argv"; argv: string[] }
  | { mode: "shell-fallback"; reason: string; command: string };

const FORMATTER_SHELL_METACHAR_RE = /[|&;<>$`\\]|\$\(|\r|\n/;

const FORMATTER_ALLOWLISTED_EXECUTABLES = new Set([
  "black",
  "bun",
  "clang-format",
  "git",
  "gofmt",
  "node",
  "npm",
  "npx",
  "prettier",
  "python",
  "python3",
  "ruff",
  "rustfmt",
]);

export function tokenizeFormatterCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function normalizeFormatterExecutable(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const basename = trimmed.includes("/") ? trimmed.split("/").pop() ?? trimmed : trimmed;
  return basename.toLowerCase();
}

export function isAllowlistedFormatterExecutable(token: string): boolean {
  const normalized = normalizeFormatterExecutable(token);
  return normalized !== null && FORMATTER_ALLOWLISTED_EXECUTABLES.has(normalized);
}

export function planFormatterCommandExecution(command: string): FormatterCommandSpawnPlan {
  const trimmed = command.trim();
  if (!trimmed) {
    return { mode: "shell-fallback", reason: "empty-command", command: trimmed };
  }

  if (FORMATTER_SHELL_METACHAR_RE.test(trimmed)) {
    return { mode: "shell-fallback", reason: "shell-metacharacters", command: trimmed };
  }

  const argv = tokenizeFormatterCommand(trimmed);
  if (argv.length === 0) {
    return { mode: "shell-fallback", reason: "empty-argv", command: trimmed };
  }

  const executable = argv[0]!;
  if (!isAllowlistedFormatterExecutable(executable)) {
    return { mode: "shell-fallback", reason: "executable-not-allowlisted", command: trimmed };
  }

  if (executable.includes("..")) {
    return { mode: "shell-fallback", reason: "path-traversal", command: trimmed };
  }

  return { mode: "argv", argv };
}

export function spawnArgsForFormatterCommand(command: string): {
  spawnArgs: string[];
  executionMode: FormatterCommandExecutionMode;
  fallbackReason?: string;
} {
  const plan = planFormatterCommandExecution(command);
  if (plan.mode === "argv") {
    return { spawnArgs: plan.argv, executionMode: "argv" };
  }

  return {
    spawnArgs: ["bash", "-lc", plan.command],
    executionMode: "shell-fallback",
    fallbackReason: plan.reason,
  };
}
