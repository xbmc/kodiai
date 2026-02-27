import { describe, expect, test } from "bun:test";
import { parseIssueReferences, type IssueReference } from "./issue-reference-parser.ts";

describe("parseIssueReferences", () => {
  describe("basic closing keywords", () => {
    test("parses 'fixes #42'", () => {
      const refs = parseIssueReferences({ prBody: "fixes #42", commitMessages: [] });
      expect(refs).toEqual([
        { issueNumber: 42, keyword: "fixes", isClosing: true, crossRepo: null, source: "body" },
      ]);
    });

    test("parses 'closes #7'", () => {
      const refs = parseIssueReferences({ prBody: "closes #7", commitMessages: [] });
      expect(refs).toEqual([
        { issueNumber: 7, keyword: "closes", isClosing: true, crossRepo: null, source: "body" },
      ]);
    });

    test("parses 'resolves #99'", () => {
      const refs = parseIssueReferences({ prBody: "resolves #99", commitMessages: [] });
      expect(refs).toEqual([
        { issueNumber: 99, keyword: "resolves", isClosing: true, crossRepo: null, source: "body" },
      ]);
    });
  });

  describe("case insensitivity", () => {
    test("parses 'CLOSES #7'", () => {
      const refs = parseIssueReferences({ prBody: "CLOSES #7", commitMessages: [] });
      expect(refs).toHaveLength(1);
      expect(refs[0]!.keyword).toBe("closes");
      expect(refs[0]!.issueNumber).toBe(7);
    });

    test("parses 'Resolves #99'", () => {
      const refs = parseIssueReferences({ prBody: "Resolves #99", commitMessages: [] });
      expect(refs).toHaveLength(1);
      expect(refs[0]!.keyword).toBe("resolves");
    });

    test("parses 'FIX #1'", () => {
      const refs = parseIssueReferences({ prBody: "FIX #1", commitMessages: [] });
      expect(refs).toHaveLength(1);
      expect(refs[0]!.keyword).toBe("fixes");
    });
  });

  describe("relates-to (non-closing)", () => {
    test("parses 'relates-to #15'", () => {
      const refs = parseIssueReferences({ prBody: "relates-to #15", commitMessages: [] });
      expect(refs).toEqual([
        { issueNumber: 15, keyword: "relates-to", isClosing: false, crossRepo: null, source: "body" },
      ]);
    });

    test("parses 'relates to #15'", () => {
      const refs = parseIssueReferences({ prBody: "relates to #15", commitMessages: [] });
      expect(refs).toEqual([
        { issueNumber: 15, keyword: "relates-to", isClosing: false, crossRepo: null, source: "body" },
      ]);
    });

    test("parses 'Relates-To #20'", () => {
      const refs = parseIssueReferences({ prBody: "Relates-To #20", commitMessages: [] });
      expect(refs).toHaveLength(1);
      expect(refs[0]!.keyword).toBe("relates-to");
      expect(refs[0]!.isClosing).toBe(false);
    });
  });

  describe("cross-repo references", () => {
    test("parses 'fixes org/repo#123'", () => {
      const refs = parseIssueReferences({ prBody: "fixes org/repo#123", commitMessages: [] });
      expect(refs).toEqual([
        { issueNumber: 123, keyword: "fixes", isClosing: true, crossRepo: "org/repo", source: "body" },
      ]);
    });

    test("parses 'closes my-org/my.repo#5'", () => {
      const refs = parseIssueReferences({ prBody: "closes my-org/my.repo#5", commitMessages: [] });
      expect(refs).toHaveLength(1);
      expect(refs[0]!.crossRepo).toBe("my-org/my.repo");
      expect(refs[0]!.issueNumber).toBe(5);
    });
  });

  describe("multiple references", () => {
    test("parses multiple different refs", () => {
      const refs = parseIssueReferences({
        prBody: "fixes #1, closes #2, relates-to #3",
        commitMessages: [],
      });
      expect(refs).toHaveLength(3);
      expect(refs.map(r => r.issueNumber)).toEqual([1, 2, 3]);
    });
  });

  describe("deduplication", () => {
    test("deduplicates same issue reference", () => {
      const refs = parseIssueReferences({
        prBody: "fixes #42 and also fixes #42",
        commitMessages: [],
      });
      expect(refs).toHaveLength(1);
      expect(refs[0]!.issueNumber).toBe(42);
    });

    test("deduplicates across body and commits", () => {
      const refs = parseIssueReferences({
        prBody: "fixes #42",
        commitMessages: ["fixes #42"],
      });
      expect(refs).toHaveLength(1);
      expect(refs[0]!.source).toBe("body"); // body takes priority
    });
  });

  describe("code block exclusion", () => {
    test("ignores references inside triple-backtick code blocks", () => {
      const body = "Some text\n```\nfixes #99\n```\nMore text";
      const refs = parseIssueReferences({ prBody: body, commitMessages: [] });
      expect(refs).toHaveLength(0);
    });

    test("ignores references inside code blocks with language tag", () => {
      const body = "Check this:\n```typescript\n// fixes #99\nconsole.log('test');\n```\nDone";
      const refs = parseIssueReferences({ prBody: body, commitMessages: [] });
      expect(refs).toHaveLength(0);
    });

    test("parses references outside code blocks while ignoring inside", () => {
      const body = "fixes #1\n```\nfixes #2\n```\nfixes #3";
      const refs = parseIssueReferences({ prBody: body, commitMessages: [] });
      expect(refs).toHaveLength(2);
      expect(refs.map(r => r.issueNumber)).toEqual([1, 3]);
    });
  });

  describe("commit messages", () => {
    test("extracts from commit messages with source='commit'", () => {
      const refs = parseIssueReferences({
        prBody: "",
        commitMessages: ["fixes #10"],
      });
      expect(refs).toEqual([
        { issueNumber: 10, keyword: "fixes", isClosing: true, crossRepo: null, source: "commit" },
      ]);
    });

    test("extracts from multiple commit messages", () => {
      const refs = parseIssueReferences({
        prBody: "",
        commitMessages: ["fixes #10", "closes #20"],
      });
      expect(refs).toHaveLength(2);
    });
  });

  describe("keyword variants", () => {
    test("normalizes 'fix' to 'fixes'", () => {
      const refs = parseIssueReferences({ prBody: "fix #1", commitMessages: [] });
      expect(refs[0]!.keyword).toBe("fixes");
    });

    test("normalizes 'fixed' to 'fixes'", () => {
      const refs = parseIssueReferences({ prBody: "fixed #2", commitMessages: [] });
      expect(refs[0]!.keyword).toBe("fixes");
    });

    test("normalizes 'closed' to 'closes'", () => {
      const refs = parseIssueReferences({ prBody: "closed #3", commitMessages: [] });
      expect(refs[0]!.keyword).toBe("closes");
    });

    test("normalizes 'resolved' to 'resolves'", () => {
      const refs = parseIssueReferences({ prBody: "resolved #4", commitMessages: [] });
      expect(refs[0]!.keyword).toBe("resolves");
    });

    test("normalizes 'close' to 'closes'", () => {
      const refs = parseIssueReferences({ prBody: "close #5", commitMessages: [] });
      expect(refs[0]!.keyword).toBe("closes");
    });

    test("normalizes 'resolve' to 'resolves'", () => {
      const refs = parseIssueReferences({ prBody: "resolve #6", commitMessages: [] });
      expect(refs[0]!.keyword).toBe("resolves");
    });
  });

  describe("edge cases", () => {
    test("reference at start of line", () => {
      const refs = parseIssueReferences({ prBody: "Fixes #42 is the main change", commitMessages: [] });
      expect(refs).toHaveLength(1);
      expect(refs[0]!.issueNumber).toBe(42);
    });

    test("reference after parenthesis", () => {
      const refs = parseIssueReferences({ prBody: "(fixes #42)", commitMessages: [] });
      expect(refs).toHaveLength(1);
      expect(refs[0]!.issueNumber).toBe(42);
    });

    test("reference after bracket", () => {
      const refs = parseIssueReferences({ prBody: "[fixes #42]", commitMessages: [] });
      expect(refs).toHaveLength(1);
    });

    test("empty body and empty commits returns empty array", () => {
      const refs = parseIssueReferences({ prBody: "", commitMessages: [] });
      expect(refs).toEqual([]);
    });

    test("body with no references returns empty array", () => {
      const refs = parseIssueReferences({ prBody: "Just a regular PR description", commitMessages: [] });
      expect(refs).toEqual([]);
    });

    test("does not match bare #N without keyword", () => {
      const refs = parseIssueReferences({ prBody: "see #42 for details", commitMessages: [] });
      expect(refs).toEqual([]);
    });
  });
});
