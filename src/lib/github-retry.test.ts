import { describe, expect, test } from "bun:test";
import { isRetryableGitHubError, retryGitHubTransient } from "./github-retry.ts";

describe("retryGitHubTransient", () => {
  test("retries GitHub rate limits and honors retry-after delay caps", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await retryGitHubTransient(
      async () => {
        attempts++;
        if (attempts === 1) {
          throw {
            status: 429,
            headers: { "retry-after": "2" },
            message: "rate limited",
          };
        }
        return "ok";
      },
      {
        maxAttempts: 2,
        maxDelayMs: 1_000,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(delays).toEqual([1_000]);
  });

  test("does not retry permanent client errors", () => {
    expect(isRetryableGitHubError({ status: 404 })).toBe(false);
  });
});
