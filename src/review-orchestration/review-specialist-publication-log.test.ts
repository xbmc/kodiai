import { describe, expect, test } from "bun:test";
import { buildShadowSpecialistCorrelationKey } from "./review-specialist-publication-log.ts";

describe("buildShadowSpecialistCorrelationKey", () => {
  test("returns stable bounded correlation keys", () => {
    const first = buildShadowSpecialistCorrelationKey({
      deliveryId: "delivery-1",
      reviewOutputKey: "output-1",
      prNumber: 42,
    });
    const second = buildShadowSpecialistCorrelationKey({
      deliveryId: "delivery-1",
      reviewOutputKey: "output-1",
      prNumber: 42,
    });
    const different = buildShadowSpecialistCorrelationKey({
      deliveryId: "delivery-2",
      reviewOutputKey: "output-1",
      prNumber: 42,
    });

    expect(first).toBe(second);
    expect(first.length).toBe(16);
    expect(different).not.toBe(first);
  });
});
