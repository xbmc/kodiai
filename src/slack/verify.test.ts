import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifySlackRequest } from "./verify.ts";

const SECRET = "super-secret-signing-key";
const BODY = JSON.stringify({ type: "event_callback", event: { type: "app_mention" } });
const NOW_MS = 1_700_000_000_000;

function makeSignature(timestamp: string, body: string = BODY): string {
  const baseString = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", SECRET).update(baseString).digest("hex")}`;
}

describe("verifySlackRequest", () => {
  test("accepts a valid Slack signature within replay window", () => {
    const timestamp = String(Math.floor(NOW_MS / 1000));
    const result = verifySlackRequest({
      signingSecret: SECRET,
      rawBody: BODY,
      timestampHeader: timestamp,
      signatureHeader: makeSignature(timestamp),
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ valid: true, reason: null });
  });

  test("rejects invalid signature", () => {
    const timestamp = String(Math.floor(NOW_MS / 1000));
    const result = verifySlackRequest({
      signingSecret: SECRET,
      rawBody: BODY,
      timestampHeader: timestamp,
      signatureHeader: "v0=deadbeef",
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  test("rejects missing signature header", () => {
    const timestamp = String(Math.floor(NOW_MS / 1000));
    const result = verifySlackRequest({
      signingSecret: SECRET,
      rawBody: BODY,
      timestampHeader: timestamp,
      signatureHeader: undefined,
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ valid: false, reason: "missing_signature" });
  });

  test("rejects missing timestamp header", () => {
    const result = verifySlackRequest({
      signingSecret: SECRET,
      rawBody: BODY,
      timestampHeader: undefined,
      signatureHeader: makeSignature("1700000000"),
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ valid: false, reason: "missing_timestamp" });
  });

  test("rejects stale timestamp beyond tolerance", () => {
    const staleTimestamp = String(Math.floor(NOW_MS / 1000) - 301);
    const result = verifySlackRequest({
      signingSecret: SECRET,
      rawBody: BODY,
      timestampHeader: staleTimestamp,
      signatureHeader: makeSignature(staleTimestamp),
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ valid: false, reason: "timestamp_out_of_window" });
  });

  test("rejects future timestamp beyond tolerance", () => {
    const futureTimestamp = String(Math.floor(NOW_MS / 1000) + 301);
    const result = verifySlackRequest({
      signingSecret: SECRET,
      rawBody: BODY,
      timestampHeader: futureTimestamp,
      signatureHeader: makeSignature(futureTimestamp),
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ valid: false, reason: "timestamp_out_of_window" });
  });

  test("rejects malformed timestamp header", () => {
    const result = verifySlackRequest({
      signingSecret: SECRET,
      rawBody: BODY,
      timestampHeader: "not-a-timestamp",
      signatureHeader: makeSignature("1700000000"),
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ valid: false, reason: "malformed_timestamp" });
  });
});
