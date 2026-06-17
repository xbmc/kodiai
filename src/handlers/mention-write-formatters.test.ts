import { describe, expect, test } from "bun:test";
import {
  generateCommitSubject,
  generatePrBody,
  generatePrTitle,
  parseWriteIntent,
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
