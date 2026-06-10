export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`request body exceeds ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readBoundedRequestBody(
  request: Request,
  options: { maxBytes: number },
): Promise<string> {
  const maxBytes = Math.max(0, Math.floor(options.maxBytes));
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }

  return chunks.join("");
}

export type BoundedRequestBodyResult =
  | { ok: true; body: string }
  | { ok: false; error: RequestBodyTooLargeError };

export async function tryReadBoundedRequestBody(
  request: Request,
  options: { maxBytes: number },
): Promise<BoundedRequestBodyResult> {
  try {
    return { ok: true, body: await readBoundedRequestBody(request, options) };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { ok: false, error };
    }
    throw error;
  }
}
