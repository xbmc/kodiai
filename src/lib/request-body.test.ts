import { describe, expect, test } from "bun:test";
import { readBoundedRequestBody, tryReadBoundedRequestBody } from "./request-body.ts";

describe("readBoundedRequestBody", () => {
  test("tryReadBoundedRequestBody uses the shared Result shape", async () => {
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      body: "abc",
    });

    const result = await tryReadBoundedRequestBody(request, { maxBytes: 5 });

    expect(result).toEqual({ ok: true, value: "abc" });

    const source = await Bun.file(new URL("./request-body.ts", import.meta.url)).text();
    expect(source).toContain("ok, err, type Result");
    expect(source).toContain("Result<string, RequestBodyTooLargeError>");
    expect(source).toContain("return ok(await readBoundedRequestBody(request, options))");
    expect(source).not.toContain("| { ok: true; body: string }");
    expect(source).not.toContain("| { ok: false; error: RequestBodyTooLargeError }");
    expect(source).not.toContain("return { ok: true, value:");
    expect(source).not.toContain("return { ok: true, body:");
    expect(source).not.toContain("return { ok: false, error");
  });

  test("rejects bodies whose content-length exceeds the configured byte cap", async () => {
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "content-length": "6" },
      body: "abcdef",
    });

    await expect(readBoundedRequestBody(request, { maxBytes: 5 })).rejects.toThrow(
      "request body exceeds 5 bytes",
    );
  });

  test("stops streaming once the byte cap is exceeded", async () => {
    let cancelCalled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("abc"));
        controller.enqueue(encoder.encode("def"));
      },
      cancel() {
        cancelCalled = true;
      },
    });
    const request = new Request("http://localhost/webhook", { method: "POST", body });

    await expect(readBoundedRequestBody(request, { maxBytes: 5 })).rejects.toThrow(
      "request body exceeds 5 bytes",
    );
    expect(cancelCalled).toBe(true);
  });

  test("tryReadBoundedRequestBody returns a typed too-large result", async () => {
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "content-length": "6" },
      body: "abcdef",
    });

    const result = await tryReadBoundedRequestBody(request, { maxBytes: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err.maxBytes).toBe(5);
    }
  });
});
