import { raceWithTimeout } from "./with-timeout.ts";

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
  } = {},
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const captureText = options.captureText ?? true;
  const chunks: string[] = [];
  let lineCarry = "";
  let bytesRead = 0;
  let truncated = false;

  const acceptDecodedText = (text: string): void => {
    if (captureText) chunks.push(text);
    if (!options.onLine || text.length === 0) return;

    lineCarry += text;
    let newlineIndex = lineCarry.indexOf("\n");
    while (newlineIndex >= 0) {
      options.onLine(lineCarry.slice(0, newlineIndex));
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
    onLimit();
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    acceptDecodedText(decoder.decode());
    reader.releaseLock();
  }

  if (!truncated && options.onLine && lineCarry.length > 0) {
    options.onLine(lineCarry);
  }

  return { text: chunks.join(""), truncated };
}

type CappedProcessParams = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxStdoutBytes: number;
  maxStderrBytes?: number;
};

async function runCommandWithCappedStreams(
  params: CappedProcessParams,
  stdoutOptions: {
    captureText?: boolean;
    onLine?: (line: string) => void;
  } = {},
): Promise<CappedProcessResult> {
  const proc = Bun.spawn([params.command, ...params.args], {
    cwd: params.cwd,
    env: params.env ? { ...process.env, ...params.env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  let killed = false;
  let timedOut = false;
  const kill = (): void => {
    if (killed) return;
    killed = true;
    try {
      proc.kill();
    } catch {
      // Ignore kill races; the process may have already exited.
    }
  };

  const stdoutPromise = readTextWithByteLimit(
    proc.stdout,
    params.maxStdoutBytes,
    kill,
    stdoutOptions,
  );
  const stderrPromise = readTextWithByteLimit(
    proc.stderr,
    params.maxStderrBytes ?? 64 * 1024,
    kill,
  );

  const exitCode = params.timeoutMs && params.timeoutMs > 0 && Number.isFinite(params.timeoutMs)
    ? await raceWithTimeout(proc.exited, {
        timeoutMs: params.timeoutMs,
        timeoutValue: 124,
        onTimeout: () => {
          timedOut = true;
          kill();
        },
      })
    : await proc.exited;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return {
    exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    timedOut,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  };
}

export async function runCommandWithCappedOutput(
  params: CappedProcessParams,
): Promise<CappedProcessResult> {
  return await runCommandWithCappedStreams(params);
}

export async function runCommandWithCappedLines(params: {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxStdoutBytes: number;
  maxStderrBytes?: number;
  onStdoutLine(line: string): void;
}): Promise<CappedProcessResult> {
  return await runCommandWithCappedStreams(params, {
    captureText: false,
    onLine: params.onStdoutLine,
  });
}
