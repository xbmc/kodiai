import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { isRetryableGitHubError, isGitHubRateLimitRejection, retryGitHubTransient } from "../lib/github-retry.ts";

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);

/**
 * Install transparent transient-error retry on every request an Octokit
 * client makes, so individual call sites do not need per-call wrapping.
 *
 * Policy: idempotent requests (GET/HEAD) retry the full transient set
 * (408/429/5xx/secondary-rate). Mutations retry only rate-limit rejections
 * (403 secondary-rate / 429), where GitHub definitively did not apply the
 * request — retrying a POST on a 5xx could double-apply it.
 */
export function installOctokitRetry(octokit: Octokit, logger: Logger): Octokit {
  octokit.hook.wrap("request", (request, options) => {
    const method = String(options.method ?? "GET").toUpperCase();
    const shouldRetry = IDEMPOTENT_METHODS.has(method) ? isRetryableGitHubError : isGitHubRateLimitRejection;
    return retryGitHubTransient(() => Promise.resolve(request(options)), {
      shouldRetry,
      onRetry: ({ error, attempt, delayMs }) => {
        logger.warn(
          {
            attempt,
            delayMs,
            method,
            route: `${method} ${String(options.url ?? "")}`,
            status: (error as { status?: unknown })?.status,
          },
          "Retrying GitHub request after transient error",
        );
      },
    });
  });
  return octokit;
}
