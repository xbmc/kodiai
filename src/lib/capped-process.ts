type CappedTextDecoderOptions = {
  fatal?: boolean;
  ignoreBOM?: boolean;
};

/**
 * Platform-specific forced-teardown plan.
 *
 * Production runs on Linux, where a detached child owns a process group and
 * negative-PID signaling covers its descendants even after the root exits.
 * Windows has no equivalent guarantee here: taskkill and direct-child kill are
 * best-effort because this helper does not own the tree through a Job Object.
 */
export type ProcessTreeKillPlan =
  | { kind: "posix-group"; processGroupId: number }
  | { kind: "windows-tree"; command: [string, ...string[]] };

/**
 * Builds the platform teardown plan without claiming Windows tree ownership.
 * POSIX returns a process-group target; Windows returns a best-effort taskkill
 * command because Job Object ownership is not implemented.
 */
export function buildProcessTreeKillPlan(
  platform: NodeJS.Platform,
  pid: number,
): ProcessTreeKillPlan {
  return platform === "win32"
    ? {
        kind: "windows-tree",
        command: ["taskkill.exe", "/PID", String(pid), "/T", "/F"],
      }
    : { kind: "posix-group", processGroupId: -pid };
}

const WINDOWS_TREE_KILL_TIMEOUT_MS = 100;

/**
 * Result from a bounded subprocess helper.
 *
 * Timeout/cap teardown bounds caller completion on every platform by canceling
 * both readers. Cleanup of descendants that remain in the spawned process group
 * is guaranteed only on POSIX. Windows taskkill/direct-kill cleanup is
 * best-effort; descendants may survive after the root exits because this helper
 * does not use a Job Object.
 */
export type CappedProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

async function readTextWithByteLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  onLimit: () => void,
  options: {
    captureText?: boolean;
    onLine?: (line: string) => void;
    decoderOptions?: CappedTextDecoderOptions;
    teardownSignal?: AbortSignal;
  } = {},
): Promise<{ text: string; truncated: boolean; finalLine?: string }> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", options.decoderOptions);
  const captureText = options.captureText ?? true;
  const chunks: string[] = [];
  let lineCarry = "";
  let bytesRead = 0;
  let truncated = false;
  const cancelReader = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  options.teardownSignal?.addEventListener("abort", cancelReader, { once: true });

  const acceptDecodedText = (text: string): void => {
    if (captureText) chunks.push(text);
    if (!options.onLine || text.length === 0) return;

    lineCarry += text;
    let newlineIndex = lineCarry.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = lineCarry.slice(0, newlineIndex);
      options.onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
      lineCarry = lineCarry.slice(newlineIndex + 1);
      newlineIndex = lineCarry.indexOf("\n");
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      if (remaining <= 0) {
        truncated = true;
        onLimit();
        await reader.cancel().catch(() => undefined);
        break;
      }
      if (value.byteLength > remaining) {
        acceptDecodedText(decoder.decode(value.slice(0, remaining), { stream: true }));
        bytesRead += remaining;
        truncated = true;
        onLimit();
        await reader.cancel().catch(() => undefined);
        break;
      }
      bytesRead += value.byteLength;
      acceptDecodedText(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    const teardownAlreadyForced = options.teardownSignal?.aborted ?? false;
    if (!teardownAlreadyForced) onLimit();
    await reader.cancel().catch(() => undefined);
    if (!teardownAlreadyForced) throw error;
  } finally {
    let finalDecodeError: unknown;
    let finalDecodeFailed = false;
    try {
      try {
        acceptDecodedText(decoder.decode());
      } catch (error) {
        if (!options.teardownSignal?.aborted) {
          finalDecodeError = error;
          finalDecodeFailed = true;
          onLimit();
        }
      }
    } finally {
      options.teardownSignal?.removeEventListener("abort", cancelReader);
      reader.releaseLock();
    }
    if (finalDecodeFailed) throw finalDecodeError;
  }

  return {
    text: chunks.join(""),
    truncated,
    finalLine: !truncated && options.onLine && lineCarry.length > 0
      ? lineCarry
      : undefined,
  };
}

/**
 * Shared capped-process parameters.
 *
 * The helper's return is bounded on Windows, but production Linux/POSIX is the
 * only supported path with process-group ownership for descendant cleanup.
 */
export type CappedProcessParams = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxStdoutBytes: number;
  maxStderrBytes?: number;
  stdoutDecoderOptions?: CappedTextDecoderOptions;
};

async function runCommandWithCappedStreams(
  params: CappedProcessParams,
  stdoutOptions: {
    captureText?: boolean;
    onLine?: (line: string) => void;
    decoderOptions?: CappedTextDecoderOptions;
  } = {},
): Promise<CappedProcessResult> {
  const supportsProcessGroups = process.platform !== "win32";
  const proc = Bun.spawn([params.command, ...params.args], {
    cwd: params.cwd,
    env: params.env ? { ...process.env, ...params.env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
    detached: supportsProcessGroups,
  });
  const processTreeKillPlan = buildProcessTreeKillPlan(process.platform, proc.pid);
  const teardownController = new AbortController();
  let forcedTeardown = false;
  let timedOut = false;

  let resolveForcedExit: (exitCode: number) => void = () => undefined;
  const forcedExit = new Promise<number>((resolve) => {
    resolveForcedExit = resolve;
  });

  const killDirectChild = (signal: NodeJS.Signals): void => {
    try {
      proc.kill(signal);
    } catch {
      // Ignore kill races; the process may have already exited.
    }
  };

  const signalPosixProcessGroup = (signal: NodeJS.Signals): void => {
    if (processTreeKillPlan.kind === "posix-group") {
      try {
        process.kill(processTreeKillPlan.processGroupId, signal);
        return;
      } catch {
        // Fall back to signaling the direct child if the group no longer exists.
      }
    }
    killDirectChild(signal);
  };

  const terminateWindowsProcessTree = (): void => {
    if (processTreeKillPlan.kind !== "windows-tree") return;
    let taskkill: ReturnType<typeof Bun.spawn>;
    try {
      taskkill = Bun.spawn(processTreeKillPlan.command, {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {
      killDirectChild("SIGKILL");
      return;
    }

    taskkill.unref();
    let completed = false;
    const finish = (): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      killDirectChild("SIGKILL");
    };
    const timeout = setTimeout(() => {
      try {
        taskkill.kill("SIGKILL");
      } catch {
        // Ignore kill races; taskkill may have already exited.
      }
      finish();
    }, WINDOWS_TREE_KILL_TIMEOUT_MS);
    void taskkill.exited.then(finish, finish);
  };

  const forceTeardown = (): void => {
    if (forcedTeardown) return;
    forcedTeardown = true;
    teardownController.abort();
    if (processTreeKillPlan.kind === "windows-tree") {
      terminateWindowsProcessTree();
    } else {
      signalPosixProcessGroup("SIGTERM");
      signalPosixProcessGroup("SIGKILL");
    }
    resolveForcedExit(137);
  };

  const stdoutPromise = readTextWithByteLimit(
    proc.stdout,
    params.maxStdoutBytes,
    forceTeardown,
    {
      ...stdoutOptions,
      decoderOptions: params.stdoutDecoderOptions,
      teardownSignal: teardownController.signal,
    },
  );
  const stderrPromise = readTextWithByteLimit(
    proc.stderr,
    params.maxStderrBytes ?? 64 * 1024,
    forceTeardown,
    { teardownSignal: teardownController.signal },
  );
  // Readers can reject before proc.exited settles. Mark both promises handled
  // immediately, while still awaiting the originals below to propagate errors.
  void stdoutPromise.catch(() => undefined);
  void stderrPromise.catch(() => undefined);

  const timeout = params.timeoutMs && params.timeoutMs > 0 && Number.isFinite(params.timeoutMs)
    ? setTimeout(() => {
        timedOut = true;
        forceTeardown();
      }, params.timeoutMs)
    : undefined;

  try {
    const processExitCode = await Promise.race([proc.exited, forcedExit]);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    if (!forcedTeardown && stdoutOptions.onLine && stdout.finalLine !== undefined) {
      stdoutOptions.onLine(stdout.finalLine);
    }
    return {
      exitCode: timedOut ? 124 : processExitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      timedOut,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Runs a command with bounded captured output.
 *
 * POSIX forced teardown covers the detached process group. Windows bounds this
 * call via reader cancellation while taskkill/direct kill remain best-effort;
 * Windows descendant cleanup is not guaranteed without Job Object ownership.
 */
export async function runCommandWithCappedOutput(
  params: CappedProcessParams,
): Promise<CappedProcessResult> {
  return await runCommandWithCappedStreams(params);
}

/** Parameters for capped line streaming; platform cleanup limits match the base parameters. */
export type CappedLinesProcessParams = CappedProcessParams & {
  onStdoutLine(line: string): void;
};

/**
 * Runs a command with bounded line-streamed stdout and no retained stdout text.
 *
 * POSIX forced teardown covers the detached process group. On Windows, reader
 * cancellation bounds this call, but taskkill/direct kill are best-effort and
 * full descendant cleanup is not guaranteed because no Job Object is owned.
 */
export async function runCommandWithCappedLines(
  params: CappedLinesProcessParams,
): Promise<CappedProcessResult> {
  return await runCommandWithCappedStreams(params, {
    captureText: false,
    onLine: params.onStdoutLine,
  });
}
