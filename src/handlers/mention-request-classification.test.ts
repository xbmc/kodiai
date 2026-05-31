import { describe, expect, test } from "bun:test";
import {
  buildMentionRetrievalBody,
  deriveMentionAdmissionPolicy,
  detectImplicitIssueIntent,
  detectImplicitPrPatchIntent,
  isCodeSeekingMentionRequest,
  isDiffSeekingMentionRequest,
  isReviewRequest,
  stripIssueIntentWrappers,
} from "./mention-request-classification.ts";

describe("stripIssueIntentWrappers", () => {
  test("strips markdown quote and greeting prefixes", () => {
    expect(stripIssueIntentWrappers("> hey, please review this")).toBe("please review this");
  });
});

describe("isReviewRequest", () => {
  test("detects direct and polite review commands", () => {
    expect(isReviewRequest("review this")).toBe(true);
    expect(isReviewRequest("can you do a full review")).toBe(true);
    expect(isReviewRequest("please fix the handler")).toBe(false);
  });

  test("detects follow-up review shorthand", () => {
    expect(isReviewRequest("better now?")).toBe(true);
    expect(isReviewRequest("can you check again?")).toBe(true);
  });
});

describe("deriveMentionAdmissionPolicy", () => {
  test("includes review thread only for explicit review requests", () => {
    const mentionAdmission = {
      explicitReview: {
        includeConversationHistory: true,
        includePrMetadata: true,
        includeReviewThread: true,
        includeInlineReviewContext: true,
      },
      conversational: {
        includeConversationHistory: false,
        includePrMetadata: true,
        includeReviewThread: false,
        includeInlineReviewContext: false,
      },
    };

    expect(deriveMentionAdmissionPolicy({ explicitReviewRequest: true, mentionAdmission }).includeReviewThread).toBe(true);
    expect(deriveMentionAdmissionPolicy({ explicitReviewRequest: false, mentionAdmission }).includeReviewThread).toBe(false);
  });
});

describe("mention retrieval intent helpers", () => {
  test("classifies code and diff seeking requests", () => {
    expect(isCodeSeekingMentionRequest("where is the handler in src/handlers/review.ts")).toBe(true);
    expect(isDiffSeekingMentionRequest("show me the diff for this PR")).toBe(true);
  });

  test("builds retrieval body for explicit review vs diff inspection", () => {
    expect(buildMentionRetrievalBody({
      userQuestion: "review",
      mentionContext: "full context",
      allowHeavyContext: false,
      allowDiffContext: false,
      explicitReviewRequest: true,
    })).toBe("full context");

    expect(buildMentionRetrievalBody({
      userQuestion: "what changed?",
      mentionContext: "full context",
      allowHeavyContext: false,
      allowDiffContext: true,
      explicitReviewRequest: false,
    })).toBe("what changed?\n\ndiff-inspection request");
  });
});

describe("implicit write intent detection", () => {
  test("detects plan and apply intents on issue threads", () => {
    expect(detectImplicitIssueIntent("please plan this change")).toBe("plan");
    expect(detectImplicitIssueIntent("fix the handler")).toBe("apply");
  });

  test("detects patch intents on PR threads", () => {
    expect(detectImplicitPrPatchIntent("create a patch for this")).toBe("apply");
    expect(detectImplicitPrPatchIntent("please do a full review")).toBe(undefined);
  });
});
