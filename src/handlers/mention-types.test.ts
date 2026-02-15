import { describe, expect, test } from "bun:test";
import {
  containsMention,
  normalizeIssueComment,
  normalizeReviewBody,
  normalizeReviewComment,
  stripMention,
} from "./mention-types.ts";

describe("mention-types", () => {
  describe("containsMention", () => {
    test("detects @appSlug mentions case-insensitively", () => {
      expect(containsMention("hi @kodiai", ["kodiai"])).toBe(true);
      expect(containsMention("hi @KoDiAi", ["kodiai"])).toBe(true);
    });

    test("does not trigger on partial handle matches", () => {
      expect(containsMention("hi @kodiai123", ["kodiai"])).toBe(false);
      expect(containsMention("hi @claude123", ["claude"])).toBe(false);
    });

    test("detects @claude only when included in accepted handles", () => {
      expect(containsMention("hi @claude", ["kodiai"])).toBe(false);
      expect(containsMention("hi @claude", ["kodiai", "claude"])).toBe(true);
    });
  });

  describe("stripMention", () => {
    test("removes @appSlug and trims", () => {
      expect(stripMention("@kodiai please help", ["kodiai"])).toBe("please help");
    });

    test("removes @claude when it is accepted", () => {
      expect(stripMention("@claude please help", ["claude"])).toBe("please help");
    });

    test("removes multiple accepted handles", () => {
      expect(stripMention("@kodiai @claude please help", ["kodiai", "claude"])).toBe(
        "please help",
      );
    });

    test("does not remove partial handle matches", () => {
      expect(stripMention("@claude123 please help", ["claude"])).toBe(
        "@claude123 please help",
      );
    });

    test("returns empty string when body contains only mentions", () => {
      expect(stripMention("@kodiai", ["kodiai"])).toBe("");
      expect(stripMention("@kodiai @claude", ["kodiai", "claude"])).toBe("");
    });
  });

  describe("normalize mention surfaces", () => {
    test("normalizeReviewComment reads in_reply_to_id", () => {
      const event = normalizeReviewComment({
        repository: { owner: { login: "octo" }, name: "repo" },
        pull_request: {
          number: 42,
          head: { ref: "feature", repo: { owner: { login: "octo" }, name: "repo" } },
          base: { ref: "main" },
        },
        comment: {
          id: 1001,
          body: "@kodiai can you clarify?",
          user: { login: "alice" },
          created_at: "2026-02-14T00:00:00Z",
          diff_hunk: "@@ -1,1 +1,1 @@",
          path: "src/app.ts",
          line: 10,
          original_line: 9,
          in_reply_to_id: 999,
        },
      } as any);

      expect(event.inReplyToId).toBe(999);
    });

    test("normalizeReviewComment returns undefined when in_reply_to_id absent", () => {
      const event = normalizeReviewComment({
        repository: { owner: { login: "octo" }, name: "repo" },
        pull_request: {
          number: 42,
          head: { ref: "feature", repo: { owner: { login: "octo" }, name: "repo" } },
          base: { ref: "main" },
        },
        comment: {
          id: 1002,
          body: "@kodiai follow-up",
          user: { login: "alice" },
          created_at: "2026-02-14T00:00:00Z",
          diff_hunk: "@@ -1,1 +1,1 @@",
          path: "src/app.ts",
          line: 11,
        },
      } as any);

      expect(event.inReplyToId).toBeUndefined();
    });

    test("normalizeIssueComment always sets inReplyToId undefined", () => {
      const event = normalizeIssueComment({
        repository: { owner: { login: "octo" }, name: "repo" },
        issue: { number: 7, pull_request: null },
        comment: {
          id: 3001,
          body: "@kodiai help",
          user: { login: "bob" },
          created_at: "2026-02-14T00:00:00Z",
        },
      } as any);

      expect(event.inReplyToId).toBeUndefined();
    });

    test("normalizeReviewBody always sets inReplyToId undefined", () => {
      const event = normalizeReviewBody({
        repository: { owner: { login: "octo" }, name: "repo" },
        pull_request: {
          number: 12,
          updated_at: "2026-02-14T00:00:00Z",
          head: { ref: "feature", repo: { owner: { login: "octo" }, name: "repo" } },
          base: { ref: "main" },
        },
        review: {
          id: 4001,
          body: "@kodiai please re-check",
          user: { login: "carol" },
          submitted_at: "2026-02-14T00:00:00Z",
        },
      } as any);

      expect(event.inReplyToId).toBeUndefined();
    });
  });
});
