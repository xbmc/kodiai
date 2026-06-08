import { describe, expect, mock, test } from "bun:test";
import { withTransientDbRetry } from "./transient-retry.ts";

function connectionEndedError(): Error {
  const err = new Error(
    "write CONNECTION_ENDED kodiai-pg.postgres.database.azure.com:5432",
  );
  Object.assign(err, { code: "CONNECTION_ENDED" });
  return err;
}

describe("withTransientDbRetry", () => {
  test("retries a transient connection-ended database operation", async () => {
    const debug = mock(() => undefined);
    let attempts = 0;

    const result = await withTransientDbRetry(
      async () => {
        attempts++;
        if (attempts === 1) {
          throw connectionEndedError();
        }
        return "ok";
      },
      {
        logger: { debug },
        context: { writePath: "test_write" },
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        retryReason: "connection-ended",
        writePath: "test_write",
      }),
      "Retrying transient database operation",
    );
  });

  test("does not retry non-transient database failures", async () => {
    const debug = mock(() => undefined);
    let attempts = 0;
    const err = new Error("duplicate key value violates unique constraint");

    await expect(
      withTransientDbRetry(
        async () => {
          attempts++;
          throw err;
        },
        { logger: { debug } },
      ),
    ).rejects.toBe(err);

    expect(attempts).toBe(1);
    expect(debug).not.toHaveBeenCalled();
  });
});
