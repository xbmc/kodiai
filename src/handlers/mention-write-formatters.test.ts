import { describe, expect, test } from "bun:test";
import {
  buildMentionWriteCommitMessage,
  generateCommitSubject,
  generatePrBody,
  generatePrTitle,
  parseWriteIntent,
  resolveMentionWriteIntent,
} from "./mention-write-formatters.ts";
import { summarizeWriteRequest } from "../lib/write-request-formatting.ts";

describe("parseWriteIntent", () => {
  test("detects explicit write prefixes", () => {
    expect(parseWriteIntent("apply: fix the handler")).toEqual({
      writeIntent: true,
      keyword: "apply",
      request: "fix the handler",
    });
    expect(parseWriteIntent("please review")).toEqual({
      writeIntent: false,
      keyword: undefined,
      request: "please review",
    });
  });
});

describe("resolveMentionWriteIntent", () => {
  test("keeps explicit write prefixes unchanged", () => {
    expect(resolveMentionWriteIntent({
      userQuestion: "apply: fix the typo",
      isIssueThreadComment: true,
      isPrSurface: false,
      formatterSuggestionRequestMode: undefined,
      detectImplicitIssueIntent: () => "apply",
      detectImplicitPrPatchIntent: () => "change",
      isReviewRequest: () => false,
    })).toEqual({
      writeIntent: true,
      keyword: "apply",
      request: "fix the typo",
    });
  });

  test("infers write intent on issue comments when no explicit prefix is present", () => {
    expect(resolveMentionWriteIntent({
      userQuestion: "please update the docs",
      isIssueThreadComment: true,
      isPrSurface: false,
      formatterSuggestionRequestMode: undefined,
      detectImplicitIssueIntent: () => "change",
      detectImplicitPrPatchIntent: () => undefined,
      isReviewRequest: () => false,
    })).toEqual({
      writeIntent: true,
      keyword: "change",
      request: "please update the docs",
    });
  });

  test("infers write intent on PR comments unless the request is an explicit review", () => {
    expect(resolveMentionWriteIntent({
      userQuestion: "apply this patch",
      isIssueThreadComment: false,
      isPrSurface: true,
      formatterSuggestionRequestMode: undefined,
      detectImplicitIssueIntent: () => undefined,
      detectImplicitPrPatchIntent: () => "apply",
      isReviewRequest: () => false,
    }).writeIntent).toBe(true);

    expect(resolveMentionWriteIntent({
      userQuestion: "review this patch",
      isIssueThreadComment: false,
      isPrSurface: true,
      formatterSuggestionRequestMode: undefined,
      detectImplicitIssueIntent: () => undefined,
      detectImplicitPrPatchIntent: () => "apply",
      isReviewRequest: () => true,
    })).toEqual({
      writeIntent: false,
      keyword: undefined,
      request: "review this patch",
    });
  });

  test("does not infer PR write intent for formatter review-and-format requests", () => {
    expect(resolveMentionWriteIntent({
      userQuestion: "format and review",
      isIssueThreadComment: false,
      isPrSurface: true,
      formatterSuggestionRequestMode: "review-and-format",
      detectImplicitIssueIntent: () => undefined,
      detectImplicitPrPatchIntent: () => "apply",
      isReviewRequest: () => false,
    })).toEqual({
      writeIntent: false,
      keyword: undefined,
      request: "format and review",
    });
  });
});

describe("summarizeWriteRequest", () => {
  test("condenses polite write requests", () => {
    expect(summarizeWriteRequest("Can you please fix the handler?")).toBe("fix the handler");
  });
});

describe("generatePrTitle", () => {
  test("derives conventional commit prefixes from issue titles", () => {
    expect(generatePrTitle("Fix crash in handler", "fallback", false)).toBe("fix: Fix crash in handler");
    expect(generatePrTitle(null, "requested update", true)).toBe("fix: requested update");
  });
});

describe("generateCommitSubject", () => {
  test("appends issue refs when they fit", () => {
    expect(generateCommitSubject({
      issueTitle: "Add docs",
      requestSummary: "requested update",
      isFromPr: false,
      ref: "#42",
    })).toBe("feat: Add docs (#42)");
  });
});

describe("buildMentionWriteCommitMessage", () => {
  test("builds a canonical commit message for issue write output", () => {
    expect(buildMentionWriteCommitMessage({
      issueTitle: "Add docs",
      request: "Can you please update the README?",
      isFromPr: false,
      sourceRef: "#42",
      marker: "kodiai-write-output-key: install:owner/repo:42:abc",
      deliveryId: "delivery-1",
    })).toBe([
      "feat: Add docs (#42)",
      "",
      "kodiai-write-output-key: install:owner/repo:42:abc",
      "deliveryId: delivery-1",
    ].join("\n"));
  });

  test("builds a canonical commit message for same-PR write output", () => {
    expect(buildMentionWriteCommitMessage({
      issueTitle: undefined,
      request: "fix the failing test",
      isFromPr: true,
      sourceRef: "PR #7",
      marker: "kodiai-write-output-key: install:owner/repo:7:def",
      deliveryId: "delivery-2",
    })).toBe([
      "fix: fix the failing test (PR #7)",
      "",
      "kodiai-write-output-key: install:owner/repo:7:def",
      "deliveryId: delivery-2",
    ].join("\n"));
  });
});

describe("generatePrBody", () => {
  test("includes metadata and resolve footer for issue writes", () => {
    const body = generatePrBody({
      summary: "requested update",
      issueTitle: "Add docs",
      sourceUrl: "https://example.com/issue/1",
      triggerCommentUrl: "https://example.com/issue/1#issuecomment-2",
      deliveryId: "delivery-1",
      headSha: "abc1234",
      isFromPr: false,
      issueNumber: 1,
      prNumber: undefined,
      diffStat: "1 file changed",
    });

    expect(body).toContain("Resolves #1");
    expect(body).toContain("Delivery: delivery-1");
    expect(body).toContain("1 file changed");
  });
});
