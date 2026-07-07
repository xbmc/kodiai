import { describe, expect, test } from "bun:test";
import { settleRetryWithNoAdditionalResults } from "./review-retry-settlement.ts";

describe("settleRetryWithNoAdditionalResults", () => {
  test("returns Result describing quiet settlement side effects", async () => {
    const infoLogs: Array<{ data: Record<string, unknown>; message: string }> = [];
    const persistedStates: unknown[] = [];
    let discardCalls = 0;

    const result = await settleRetryWithNoAdditionalResults({
      logger: {
        info: (data: Record<string, unknown>, message: string) => {
          infoLogs.push({ data, message });
        },
      } as never,
      deliveryId: "delivery-1",
      prNumber: 195,
      retryConclusion: "success",
      settlementReason: "no-new-results",
      quietSettlement: {
        attemptId: "attempt-1",
        reviewOutputKey: "retry-key",
        persistContinuationFamilyState: async (state) => {
          persistedStates.push(state);
        },
      },
      discardCheckpoints: () => {
        discardCalls += 1;
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        status: "quiet-settled",
        persistedContinuationState: true,
        discardedCheckpoints: true,
        reason: "no-new-results",
      },
    });
    expect(persistedStates).toEqual([
      {
        authoritativeAttemptId: "attempt-1",
        authoritativeOutcome: "quiet-settled",
        finalStopReason: "settled-without-update",
        projectionStatus: "canonical",
        reviewOutputKey: "retry-key",
      },
    ]);
    expect(discardCalls).toBe(1);
    expect(infoLogs).toHaveLength(1);
  });
});
