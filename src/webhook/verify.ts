import { verify } from "@octokit/webhooks-methods";

/**
 * Verify a GitHub webhook signature using HMAC-SHA256.
 * Wraps @octokit/webhooks-methods which handles timing-safe comparison
 * and the sha256= prefix format.
 */
export type WebhookVerifyFn = typeof verify;

export async function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
  verifyFn: WebhookVerifyFn = verify,
): Promise<boolean> {
  try {
    return await verifyFn(secret, payload, signature);
  } catch {
    return false;
  }
}
