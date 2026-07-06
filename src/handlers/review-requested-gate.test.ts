import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { evaluateReviewRequestedGate } from "./review-requested-gate.ts";

function makeLogger() {
  const entries: Array<{ level: string; data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      info(data: Record<string, unknown>, message: string) {
        entries.push({ level: "info", data, message });
      },
      warn(data: Record<string, unknown>, message: string) {
        entries.push({ level: "warn", data, message });
      },
    } as unknown as Pick<Logger, "info" | "warn">,
  };
}

describe("evaluateReviewRequestedGate", () => {
  test("continues when the requested reviewer matches the app slug after bot normalization", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewRequestedGate({
      payload: { requested_reviewer: { login: "KoDiAi[BoT]" } },
      appSlug: "kodiai",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(decision).toEqual({ action: "continue" });
    expect(entries).toEqual([
      {
        level: "info",
        data: {
          prNumber: 42,
          gate: "review_requested_reviewer",
          gateResult: "accepted",
          requestedReviewer: "KoDiAi[BoT]",
          normalizedRequestedReviewer: "kodiai",
          normalizedAppSlug: "kodiai",
        },
        message: "Accepted review_requested event for kodiai reviewer",
      },
    ]);
  });

  test("skips non-kodiai reviewers with structured reviewer context", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewRequestedGate({
      payload: { requested_reviewer: { login: "alice" } },
      appSlug: "kodiai",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(decision).toEqual({ action: "skip" });
    expect(entries[0]).toEqual({
      level: "info",
      data: {
        prNumber: 42,
        gate: "review_requested_reviewer",
        gateResult: "skipped",
        skipReason: "non-kodiai-reviewer",
        requestedReviewer: "alice",
        normalizedRequestedReviewer: "alice",
        normalizedAppSlug: "kodiai",
        requestedTeam: null,
      },
      message: "Skipping review_requested event for non-kodiai reviewer",
    });
  });

  test("skips team-only and malformed review requests", () => {
    const { logger, entries } = makeLogger();

    const teamDecision = evaluateReviewRequestedGate({
      payload: { requested_team: { name: "ai-review", slug: "ai-review" } },
      appSlug: "kodiai",
      baseLog: { prNumber: 42 },
      logger,
    });
    const malformedDecision = evaluateReviewRequestedGate({
      payload: { requested_reviewer: "not-an-object" },
      appSlug: "kodiai",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(teamDecision).toEqual({ action: "skip" });
    expect(malformedDecision).toEqual({ action: "skip" });
    expect(entries.map((entry) => ({
      level: entry.level,
      message: entry.message,
      gateResult: entry.data.gateResult,
      skipReason: entry.data.skipReason,
      requestedTeam: entry.data.requestedTeam,
      requestedTeamSlug: entry.data.requestedTeamSlug,
      hasRequestedReviewerField: entry.data.hasRequestedReviewerField,
      hasRequestedTeamField: entry.data.hasRequestedTeamField,
    }))).toEqual([
      {
        level: "info",
        message: "Skipping review_requested event because only a team was requested",
        gateResult: "skipped",
        skipReason: "team-only-request",
        requestedTeam: "ai-review",
        requestedTeamSlug: "ai-review",
        hasRequestedReviewerField: undefined,
        hasRequestedTeamField: undefined,
      },
      {
        level: "warn",
        message: "Skipping review_requested event due to missing reviewer payload",
        gateResult: "skipped",
        skipReason: "missing-or-malformed-reviewer-payload",
        requestedTeam: undefined,
        requestedTeamSlug: undefined,
        hasRequestedReviewerField: true,
        hasRequestedTeamField: false,
      },
    ]);
  });
});
