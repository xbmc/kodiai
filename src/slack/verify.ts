import { createHmac, timingSafeEqual } from "node:crypto";

const SLACK_SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

export type SlackVerifyFailureReason =
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_signature"
  | "malformed_timestamp"
  | "timestamp_out_of_window"
  | "signature_mismatch";

export type SlackVerifyResult =
  | { valid: true; reason: null }
  | { valid: false; reason: SlackVerifyFailureReason };

interface VerifySlackRequestInput {
  signingSecret: string;
  rawBody: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  nowMs?: number;
}

function isOutOfWindow(timestampSeconds: number, nowMs: number): boolean {
  const nowSeconds = Math.floor(nowMs / 1000);
  return Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS;
}

function timingSafeCompare(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function verifySlackRequest(input: VerifySlackRequestInput): SlackVerifyResult {
  const { signingSecret, rawBody, timestampHeader, signatureHeader, nowMs = Date.now() } = input;

  if (!signatureHeader) {
    return { valid: false, reason: "missing_signature" };
  }

  if (!timestampHeader) {
    return { valid: false, reason: "missing_timestamp" };
  }

  if (!signatureHeader.startsWith(`${SLACK_SIGNATURE_VERSION}=`)) {
    return { valid: false, reason: "malformed_signature" };
  }

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isInteger(timestampSeconds)) {
    return { valid: false, reason: "malformed_timestamp" };
  }

  if (isOutOfWindow(timestampSeconds, nowMs)) {
    return { valid: false, reason: "timestamp_out_of_window" };
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`;
  const expectedSignature = `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", signingSecret).update(baseString).digest("hex")}`;

  if (!timingSafeCompare(signatureHeader, expectedSignature)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true, reason: null };
}
