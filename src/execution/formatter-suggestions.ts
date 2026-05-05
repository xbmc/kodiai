import { redactGitHubTokens } from "../lib/sanitizer.ts";

export const FORMATTER_STDERR_SUMMARY_MAX_CHARS = 500;
export const FORMATTER_PROCESS_STREAM_MAX_CHARS = 1_000_000;

export type FormatterCommandStatus =
  | "success"
  | "no-command"
  | "no-op"
  | "failed"
  | "timed-out";

export interface ResolveFormatterCommandOptions {
  command: string | undefined;
  baseRef: string;
  headRef: string;
  diffRange: string;
}

export interface FormatterProcessRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
}

export interface FormatterProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export type FormatterProcessRunner = (
  request: FormatterProcessRequest,
) => Promise<FormatterProcessResult>;

export interface RunFormatterCommandOptions extends ResolveFormatterCommandOptions {
  workspaceDir: string;
  timeoutMs: number;
  runProcess?: FormatterProcessRunner;
}

export interface FormatterCommandResult {
  status: FormatterCommandStatus;
  stdout: string;
  stderrSummary: string;
  timedOut: boolean;
  durationMs: number;
  resolvedCommand?: string;
  exitCode?: number;
}

function substituteFormatterPlaceholder(value: string, options: ResolveFormatterCommandOptions): string {
  switch (value) {
    case "baseRef":
      return options.baseRef;
    case "headRef":
      return options.headRef;
    case "diffRange":
      return options.diffRange;
    default:
      return `{${value}}`;
  }
}

export function resolveFormatterCommand(
  options: ResolveFormatterCommandOptions,
): string | undefined {
  const command = options.command?.trim();
  if (!command) {
    return undefined;
  }

  return command.replace(/\{([^{}]+)\}/g, (_match, placeholder: string) =>
    substituteFormatterPlaceholder(placeholder, options)
  );
}

function normalizeProcessText(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function summarizeFormatterStderr(stderr: unknown): string {
  const redacted = redactGitHubTokens(normalizeProcessText(stderr));
  if (redacted.length <= FORMATTER_STDERR_SUMMARY_MAX_CHARS) {
    return redacted;
  }
  return redacted.slice(0, FORMATTER_STDERR_SUMMARY_MAX_CHARS);
}

async function readProcessStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }

  const text = await new Response(stream).text();
  if (text.length <= FORMATTER_PROCESS_STREAM_MAX_CHARS) {
    return text;
  }
  return text.slice(0, FORMATTER_PROCESS_STREAM_MAX_CHARS);
}

export const defaultFormatterProcessRunner: FormatterProcessRunner = async ({
  command,
  cwd,
  timeoutMs,
}) => {
  const startedAt = performance.now();
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = readProcessStream(proc.stdout);
  const stderrPromise = readProcessStream(proc.stderr);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  try {
    const exitCode = timeoutMs > 0 && Number.isFinite(timeoutMs)
      ? await Promise.race([
          proc.exited,
          new Promise<number>((resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              try {
                proc.kill();
              } catch {
                // The process may have exited between timeout and kill.
              }
              resolve(124);
            }, timeoutMs);
          }),
        ])
      : await proc.exited;

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return {
      exitCode,
      stdout,
      stderr,
      timedOut,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

export async function runFormatterCommand(
  options: RunFormatterCommandOptions,
): Promise<FormatterCommandResult> {
  const resolvedCommand = resolveFormatterCommand(options);
  if (!resolvedCommand) {
    return {
      status: "no-command",
      stdout: "",
      stderrSummary: "",
      timedOut: false,
      durationMs: 0,
    };
  }

  const runProcess = options.runProcess ?? defaultFormatterProcessRunner;
  const processResult = await runProcess({
    command: resolvedCommand,
    cwd: options.workspaceDir,
    timeoutMs: options.timeoutMs,
  });

  const stdout = normalizeProcessText(processResult.stdout);
  const stderrSummary = summarizeFormatterStderr(processResult.stderr);
  const timedOut = Boolean(processResult.timedOut);
  const exitCode = Number.isFinite(processResult.exitCode)
    ? processResult.exitCode
    : 1;
  const durationMs = Number.isFinite(processResult.durationMs)
    ? Math.max(0, Math.round(processResult.durationMs))
    : 0;

  if (timedOut) {
    return {
      status: "timed-out",
      stdout,
      stderrSummary,
      timedOut: true,
      durationMs,
      resolvedCommand,
      exitCode,
    };
  }

  if (exitCode !== 0) {
    return {
      status: "failed",
      stdout,
      stderrSummary,
      timedOut: false,
      durationMs,
      resolvedCommand,
      exitCode,
    };
  }

  return {
    status: stdout.trim().length === 0 ? "no-op" : "success",
    stdout,
    stderrSummary,
    timedOut: false,
    durationMs,
    resolvedCommand,
    exitCode,
  };
}
