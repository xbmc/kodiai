export class BoundedFileTooLargeError extends Error {
  constructor(
    readonly path: string,
    readonly actualBytes: number,
    readonly maxBytes: number,
  ) {
    super(`File exceeds ${maxBytes}-byte limit: ${path} (${actualBytes} bytes)`);
    this.name = "BoundedFileTooLargeError";
  }
}

export async function readTextFileBounded(path: string, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
  const file = Bun.file(path);
  if (file.size > maxBytes) throw new BoundedFileTooLargeError(path, file.size, maxBytes);
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      if (value.byteLength > remaining) {
        // Report the true size where the filesystem can tell us (the stream can
        // outgrow the initial stat if the file is being appended to), falling
        // back to the bytes actually observed so far.
        const statSize = Bun.file(path).size;
        const observed = bytesRead + value.byteLength;
        throw new BoundedFileTooLargeError(path, Math.max(statSize, observed), maxBytes);
      }
      chunks.push(value);
      bytesRead += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
