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
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  let truncated = false;

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
        chunks.push(decoder.decode(value.slice(0, remaining), { stream: true }));
        bytesRead += remaining;
        truncated = true;
        onLimit();
        await reader.cancel().catch(() => undefined);
        break;
      }
      bytesRead += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    chunks.push(decoder.decode());
    reader.releaseLock();
  }

  return { text: chunks.join(""), truncated };
}

export async function runCommandWithCappedOutput(params: {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxStdoutBytes: number;
  maxStderrBytes?: number;
}): Promise<CappedProcessResult> {
  const proc = Bun.spawn([params.command, ...params.args], {
    cwd: params.cwd,
    env: params.env ? { ...process.env, ...params.env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  let killed = false;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
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
  );
  const stderrPromise = readTextWithByteLimit(
    proc.stderr,
    params.maxStderrBytes ?? 64 * 1024,
    kill,
  );

  try {
    const exitCode = params.timeoutMs && params.timeoutMs > 0 && Number.isFinite(params.timeoutMs)
      ? await Promise.race([
          proc.exited,
          new Promise<number>((resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              kill();
              resolve(124);
            }, params.timeoutMs);
          }),
        ])
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
  } finally {
    if (timer) clearTimeout(timer);
  }
}
