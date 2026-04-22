import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";

const SECRET = "test-webhook-secret";
const BODY = JSON.stringify({ action: "review_requested", pull_request: { number: 42 } });

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

afterEach(() => {
  mock.restore();
});

describe("verifyWebhookSignature", () => {
  test("accepts a signature generated from the exact raw body string", async () => {
    const { verifyWebhookSignature } = await import("./verify.ts");

    await expect(verifyWebhookSignature(SECRET, BODY, sign(BODY))).resolves.toBe(true);
  });

  test("rejects signatures generated from a different body string", async () => {
    const { verifyWebhookSignature } = await import("./verify.ts");
    const signatureForDifferentBody = sign(`${BODY}\n`);

    await expect(
      verifyWebhookSignature(SECRET, BODY, signatureForDifferentBody),
    ).resolves.toBe(false);
  });

  test("fails closed for malformed signature formats", async () => {
    const { verifyWebhookSignature } = await import("./verify.ts");

    await expect(verifyWebhookSignature(SECRET, BODY, "sha1=deadbeef")).resolves.toBe(false);
    await expect(verifyWebhookSignature(SECRET, BODY, "not-even-a-signature")).resolves.toBe(false);
  });

  test("returns false when the underlying verifier throws", async () => {
    const { verifyWebhookSignature } = await import("./verify.ts");
    const verifyThrow = mock(async () => {
      throw new Error("boom");
    }) as unknown as typeof import("@octokit/webhooks-methods").verify;

    await expect(verifyWebhookSignature(SECRET, BODY, sign(BODY), verifyThrow)).resolves.toBe(false);
    expect(verifyThrow).toHaveBeenCalledTimes(1);
  });
});
