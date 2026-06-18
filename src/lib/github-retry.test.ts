import { describe, expect, test } from "bun:test";
import { isRetryableGitHubError, retryGitHubRateLimitOnly, retryGitHubTransient } from "./github-retry.ts";

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

  test("does not retry semantic conflicts by default", () => {
    expect(isRetryableGitHubError({ status: 409 })).toBe(false);
  });
});

describe("retryGitHubRateLimitOnly", () => {
  test("retries 429 responses but does not retry generic server errors", async () => {
    let rateLimitAttempts = 0;
    const rateLimitResult = await retryGitHubRateLimitOnly(
      async () => {
        rateLimitAttempts++;
        if (rateLimitAttempts === 1) throw { status: 429 };
        return "ok";
      },
      { sleep: async () => {} },
    );

    let serverAttempts = 0;
    await expect(retryGitHubRateLimitOnly(
      async () => {
        serverAttempts++;
        throw { status: 500 };
      },
      { sleep: async () => {} },
    )).rejects.toEqual({ status: 500 });

    expect(rateLimitResult).toBe("ok");
    expect(rateLimitAttempts).toBe(2);
    expect(serverAttempts).toBe(1);
  });

  test("retries GitHub secondary-rate-limit 403 responses but not permission 403s", async () => {
    let secondaryAttempts = 0;
    const secondaryResult = await retryGitHubRateLimitOnly(
      async () => {
        secondaryAttempts++;
        if (secondaryAttempts === 1) {
          throw {
            status: 403,
            response: { headers: { "retry-after": "0" } },
            message: "secondary rate limit",
          };
        }
        return "ok";
      },
      { sleep: async () => {} },
    );

    let permissionAttempts = 0;
    await expect(retryGitHubRateLimitOnly(
      async () => {
        permissionAttempts++;
        throw { status: 403, message: "Resource not accessible by integration" };
      },
      { sleep: async () => {} },
    )).rejects.toEqual({ status: 403, message: "Resource not accessible by integration" });

    expect(secondaryResult).toBe("ok");
    expect(secondaryAttempts).toBe(2);
    expect(permissionAttempts).toBe(1);
  });
});
