import { describe, expect, test } from "bun:test";
import { retryTransient } from "./transient-retry.ts";

describe("retryTransient", () => {
  test("retries when the caller marks the error retryable and honors delay caps", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await retryTransient(
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
        shouldRetry: (error) => typeof error === "object"
          && error !== null
          && (error as { status?: number }).status === 429,
        retryDelayMs: () => 2_000,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(delays).toEqual([1_000]);
  });

  test("does not retry without an explicit retry decision", async () => {
    let attempts = 0;

    await expect(
      retryTransient(
        async () => {
          attempts++;
          throw { status: 404, message: "not found" };
        },
        { maxAttempts: 3, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ status: 404 });

    expect(attempts).toBe(1);
  });
});
