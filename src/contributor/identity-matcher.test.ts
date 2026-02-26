import { describe, test, expect } from "bun:test";
import {
  findPotentialMatches,
  levenshteinDistance,
} from "./identity-matcher.ts";

describe("levenshteinDistance", () => {
  test("identical strings return 0", () => {
    expect(levenshteinDistance("test", "test")).toBe(0);
  });

  test("single character difference returns 1", () => {
    expect(levenshteinDistance("test", "tset")).toBe(2); // transposition = 2 edits
    expect(levenshteinDistance("test", "tests")).toBe(1); // insertion
    expect(levenshteinDistance("test", "tes")).toBe(1); // deletion
    expect(levenshteinDistance("test", "tast")).toBe(1); // substitution
  });

  test("completely different strings", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });

  test("empty strings", () => {
    expect(levenshteinDistance("", "test")).toBe(4);
    expect(levenshteinDistance("test", "")).toBe(4);
    expect(levenshteinDistance("", "")).toBe(0);
  });
});

describe("findPotentialMatches", () => {
  const slackMembers = [
    { userId: "U001", displayName: "octocat", realName: "Octo Cat" },
    { userId: "U002", displayName: "devuser", realName: "Dev User" },
    { userId: "U003", displayName: "randomguy", realName: "Random Guy" },
    { userId: "U004", displayName: "octocaat", realName: "Octo Caat" },
  ];

  test("exact username match returns high confidence", () => {
    const matches = findPotentialMatches({
      githubUsername: "octocat",
      githubDisplayName: null,
      slackMembers,
    });

    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.slackUserId).toBe("U001");
    expect(matches[0]!.confidence).toBe("high");
  });

  test("close match (1-2 char difference) returns medium confidence", () => {
    const matches = findPotentialMatches({
      githubUsername: "octocaat",
      githubDisplayName: null,
      slackMembers: [
        { userId: "U001", displayName: "octocat", realName: "Octo Cat" },
      ],
    });

    expect(matches.length).toBe(1);
    expect(matches[0]!.confidence).toBe("medium");
  });

  test("no match returns empty array", () => {
    const matches = findPotentialMatches({
      githubUsername: "completelydifferentuser",
      githubDisplayName: null,
      slackMembers,
    });

    expect(matches.length).toBe(0);
  });

  test("GitHub display name match also works", () => {
    const matches = findPotentialMatches({
      githubUsername: "gh-user-123",
      githubDisplayName: "devuser",
      slackMembers,
    });

    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.slackUserId).toBe("U002");
    expect(matches[0]!.confidence).toBe("high");
  });

  test("max 3 results returned", () => {
    const manyMembers = Array.from({ length: 10 }, (_, i) => ({
      userId: `U${i}`,
      displayName: `octoca${String.fromCharCode(97 + i)}`, // octocaa, octocab, etc.
      realName: `User ${i}`,
    }));

    const matches = findPotentialMatches({
      githubUsername: "octocat",
      githubDisplayName: null,
      slackMembers: manyMembers,
    });

    expect(matches.length).toBeLessThanOrEqual(3);
  });

  test("real name match works for exact match", () => {
    const matches = findPotentialMatches({
      githubUsername: "randomguy",
      githubDisplayName: null,
      slackMembers,
    });

    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.slackUserId).toBe("U003");
  });
});
