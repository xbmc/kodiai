import { createHmac, timingSafeEqual } from "node:crypto";
import { err, ok, type Result } from "../lib/result.ts";

const SLACK_SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

export type SlackVerifyFailureReason =
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_signature"
  | "malformed_timestamp"
  | "timestamp_out_of_window"
  | "signature_mismatch";

export class SlackVerifyError extends Error {
  constructor(readonly reason: SlackVerifyFailureReason) {
    super(reason);
    this.name = "SlackVerifyError";
  }
}

export type SlackVerifyResult = Result<void, SlackVerifyError>;

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
    return err(new SlackVerifyError("missing_signature"));
  }

  if (!timestampHeader) {
    return err(new SlackVerifyError("missing_timestamp"));
  }

  if (!signatureHeader.startsWith(`${SLACK_SIGNATURE_VERSION}=`)) {
    return err(new SlackVerifyError("malformed_signature"));
  }

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isInteger(timestampSeconds)) {
    return err(new SlackVerifyError("malformed_timestamp"));
  }

  if (isOutOfWindow(timestampSeconds, nowMs)) {
    return err(new SlackVerifyError("timestamp_out_of_window"));
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`;
  const expectedSignature = `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", signingSecret).update(baseString).digest("hex")}`;

  if (!timingSafeCompare(signatureHeader, expectedSignature)) {
    return err(new SlackVerifyError("signature_mismatch"));
  }

  return ok(undefined);
}
