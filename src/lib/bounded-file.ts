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
  if (!(await file.exists())) return await file.text();
  if (file.size > maxBytes) throw new BoundedFileTooLargeError(path, file.size, maxBytes);
  return await file.text();
}
