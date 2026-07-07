import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { resolveReviewDraftToneContext } from "./review-draft-tone.ts";

function makeLogger() {
  const entries: Array<{ data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      info(data: Record<string, unknown>, message: string) {
        entries.push({ data, message });
      },
    } as unknown as Pick<Logger, "info">,
  };
}

describe("resolveReviewDraftToneContext", () => {
  test("marks draft pull requests for draft tone and logs structured context", () => {
    const { logger, entries } = makeLogger();

    const context = resolveReviewDraftToneContext({
      action: "opened",
      prDraft: true,
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(context).toEqual({ isDraft: true });
    expect(entries).toEqual([
      {
        data: { prNumber: 42, isDraft: true },
        message: "Reviewing draft PR with draft tone",
      },
    ]);
  });

  test("uses normal tone for ready_for_review even when the payload still says draft", () => {
    const { logger, entries } = makeLogger();

    const context = resolveReviewDraftToneContext({
      action: "ready_for_review",
      prDraft: true,
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(context).toEqual({ isDraft: false });
    expect(entries).toEqual([]);
  });

  test("uses normal tone for non-draft pull requests", () => {
    const { logger, entries } = makeLogger();

    const context = resolveReviewDraftToneContext({
      action: "synchronize",
      prDraft: false,
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(context).toEqual({ isDraft: false });
    expect(entries).toEqual([]);
  });
});
