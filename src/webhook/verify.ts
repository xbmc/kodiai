import { verify } from "@octokit/webhooks-methods";

/**
 * Verify a GitHub webhook signature using HMAC-SHA256.
 * Wraps @octokit/webhooks-methods which handles timing-safe comparison
 * and the sha256= prefix format.
 */
export async function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  try {
    return await verify(secret, payload, signature);
  } catch {
    return false;
  }
}
