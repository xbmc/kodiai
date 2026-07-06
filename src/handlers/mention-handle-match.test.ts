import { describe, expect, test } from "bun:test";
import {
  buildAcceptedMentionHandles,
  mentionBodyMatchesAcceptedHandles,
} from "./mention-handle-match.ts";

describe("mention handle matching", () => {
  test("includes the app slug, kodai alias, and claude alias by default", () => {
    expect(buildAcceptedMentionHandles({ appSlug: "kodiai", acceptClaudeAlias: true })).toEqual([
      "@kodiai",
      "@kodai",
      "@claude",
    ]);
  });

  test("omits the claude alias when the repo opts out", () => {
    expect(buildAcceptedMentionHandles({ appSlug: "kodiai", acceptClaudeAlias: false })).toEqual([
      "@kodiai",
      "@kodai",
    ]);
  });

  test("normalizes app slugs that already include @ and matches case-insensitively", () => {
    const handles = buildAcceptedMentionHandles({ appSlug: "@KodiAI", acceptClaudeAlias: false });

    expect(handles).toEqual(["@kodiai", "@kodai"]);
    expect(mentionBodyMatchesAcceptedHandles("Please @KODIAI review this", handles)).toBe(true);
    expect(mentionBodyMatchesAcceptedHandles("Please @claude review this", handles)).toBe(false);
  });
});
