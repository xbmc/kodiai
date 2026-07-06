import { describe, expect, test } from "bun:test";
import { isSameRepoPrHead } from "./mention-pr-write.ts";

describe("mention PR write helpers", () => {
  test("matches same-repo PR heads case-insensitively after trimming names", () => {
    expect(isSameRepoPrHead({
      owner: "Acme",
      repo: "Widgets",
      headRepoOwner: " acme ",
      headRepoName: "widgets",
      headRef: "feature",
    })).toBe(true);
  });

  test("rejects fork heads and missing head refs", () => {
    expect(isSameRepoPrHead({
      owner: "Acme",
      repo: "Widgets",
      headRepoOwner: "octo",
      headRepoName: "widgets",
      headRef: "feature",
    })).toBe(false);

    expect(isSameRepoPrHead({
      owner: "Acme",
      repo: "Widgets",
      headRepoOwner: "acme",
      headRepoName: "widgets",
      headRef: "",
    })).toBe(false);
  });
});
