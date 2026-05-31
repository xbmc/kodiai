import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { ReviewCandidatePublicationRuntimeResult } from "./review-candidate-publication-runtime.ts";
import { logReviewCandidatePublicationRuntime } from "./review-candidate-publication-log.ts";

function createCaptureLogger() {
  const entries: Array<{ level: "info" | "warn"; bindings: Record<string, unknown>; message: string }> = [];
  const logger = {
    info: (bindings: Record<string, unknown>, message: string) => {
      entries.push({ level: "info", bindings, message });
    },
    warn: (bindings: Record<string, unknown>, message: string) => {
      entries.push({ level: "warn", bindings, message });
    },
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };
  return { logger: logger as unknown as Logger, entries };
}

const baseRuntime: ReviewCandidatePublicationRuntimeResult = {
  mode: "approved",
  counts: {
    candidateInput: 1,
    candidateRecorded: 1,
    candidateRejected: 0,
    candidatePublishable: 1,
    candidatePublished: 1,
    candidateBlocked: 0,
    candidateFailed: 0,
    candidateMalformed: 0,
    fixEligibilityBlocked: 0,
    directPublished: 0,
    malformed: 0,
  },
  reasons: [],
  outcomeBuckets: {},
  publisherResultSample: [],
  movedToDetails: [],
};

describe("logReviewCandidatePublicationRuntime", () => {
  test("logs approved publication at info with projected counts", () => {
    const { logger, entries } = createCaptureLogger();

    logReviewCandidatePublicationRuntime({
      logger,
      baseLog: { repo: "xbmc/xbmc", prNumber: 1 },
      runtime: baseRuntime,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe("info");
    expect(entries[0]!.message).toBe("Review candidate publication completed");
    expect(entries[0]!.bindings).toMatchObject({
      gate: "review-candidate-publication",
      gateResult: "approved",
      counts: expect.objectContaining({ candidatePublished: 1 }),
    });
    expect(entries[0]!.bindings.classification).toBeUndefined();
  });

  test("logs expected policy blocks at info instead of warn", () => {
    const { logger, entries } = createCaptureLogger();

    logReviewCandidatePublicationRuntime({
      logger,
      baseLog: { repo: "xbmc/xbmc", prNumber: 1 },
      runtime: {
        ...baseRuntime,
        mode: "blocked",
        counts: {
          ...baseRuntime.counts,
          candidatePublishable: 0,
          candidatePublished: 0,
          candidateBlocked: 1,
          fixEligibilityBlocked: 1,
        },
        reasons: ["fix-eligibility-blocked"],
        outcomeBuckets: {
          blocked: { mode: "blocked", count: 1, reasons: ["fix-eligibility-blocked"] },
        },
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe("info");
    expect(entries[0]!.message).toBe("Review candidate publication completed with expected policy block");
  });

  test("logs degraded mode at warn", () => {
    const { logger, entries } = createCaptureLogger();

    logReviewCandidatePublicationRuntime({
      logger,
      baseLog: { repo: "xbmc/xbmc", prNumber: 1 },
      runtime: { ...baseRuntime, mode: "degraded", reasons: ["publisher-unavailable"] },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe("warn");
    expect(entries[0]!.message).toBe("Review candidate publication completed with non-approved mode");
  });
});
