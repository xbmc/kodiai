import { describe, expect, test } from "bun:test";
import {
  buildSlackWriteIntentQuickAction,
  resolveSlackWriteIntent,
  SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
} from "./write-intent.ts";

describe("resolveSlackWriteIntent", () => {
  test("routes explicit apply: prefix directly to write intent", () => {
    const result = resolveSlackWriteIntent("apply: update README wording");

    expect(result).toEqual({
      outcome: "write",
      request: "update README wording",
      keyword: "apply",
      source: "explicit_prefix",
      highImpact: false,
      confirmationRequired: false,
      confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
    });
  });

  test("routes explicit plan: prefix directly to write-intent handling", () => {
    const result = resolveSlackWriteIntent("plan: draft migration steps for retry queue");

    expect(result).toEqual({
      outcome: "write",
      request: "draft migration steps for retry queue",
      keyword: "plan",
      source: "explicit_prefix",
      highImpact: true,
      confirmationRequired: true,
      confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
    });
  });

  test("routes medium-confidence conversational write ask to apply intent", () => {
    const result = resolveSlackWriteIntent(
      "Can you update src/slack/assistant-handler.ts and open a PR with the changes?",
    );

    expect(result).toEqual({
      outcome: "write",
      request: "Can you update src/slack/assistant-handler.ts and open a PR with the changes?",
      keyword: "apply",
      source: "medium_confidence_conversational",
      highImpact: false,
      confirmationRequired: false,
      confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
    });
  });

  test("keeps ambiguous conversational write asks read-only with exact rerun commands", () => {
    const result = resolveSlackWriteIntent("Can you maybe change this when you can?");

    expect(result).toEqual({
      outcome: "clarification_required",
      request: "Can you maybe change this when you can?",
      quickActionText:
        "I kept this run read-only because your request may involve repository changes, but write intent is ambiguous.\n" +
        "If you want write mode, rerun with exactly one of:\n" +
        "- apply: Can you maybe change this when you can?\n" +
        "- change: Can you maybe change this when you can?",
      rerunCommands: [
        "apply: Can you maybe change this when you can?",
        "change: Can you maybe change this when you can?",
      ],
    });
  });

  test("marks high-impact write asks for confirmation", () => {
    const result = resolveSlackWriteIntent("Please delete old auth files across the entire repo and migrate secrets");

    expect(result).toEqual({
      outcome: "write",
      request: "Please delete old auth files across the entire repo and migrate secrets",
      keyword: "apply",
      source: "medium_confidence_conversational",
      highImpact: true,
      confirmationRequired: true,
      confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
    });
  });

  test("keeps non-write conversational asks in read-only mode", () => {
    const result = resolveSlackWriteIntent("What changed in the retry logic and why?");

    expect(result).toEqual({
      outcome: "read_only",
      request: "What changed in the retry logic and why?",
    });
  });

  test("quick-action builder preserves exact request in commands", () => {
    expect(buildSlackWriteIntentQuickAction("fix the lint error")).toBe(
      "I kept this run read-only because your request may involve repository changes, but write intent is ambiguous.\n" +
        "If you want write mode, rerun with exactly one of:\n" +
        "- apply: fix the lint error\n" +
        "- change: fix the lint error",
    );
  });
});
