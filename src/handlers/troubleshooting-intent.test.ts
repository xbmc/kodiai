import { describe, expect, it } from "bun:test";
import {
  classifyTroubleshootingIntent,
  buildTroubleshootMarker,
  hasTroubleshootMarker,
  TROUBLESHOOT_MARKER_PREFIX,
} from "./troubleshooting-intent.ts";

describe("classifyTroubleshootingIntent", () => {
  it("returns true when issue title has 'error' and mention has 'help'", () => {
    expect(
      classifyTroubleshootingIntent({
        mentionText: "Can you help with this?",
        issueTitle: "Build error on startup",
        issueBody: null,
      }),
    ).toBe(true);
  });

  it("returns true when issue body has 'not working' and mention has 'how to fix'", () => {
    expect(
      classifyTroubleshootingIntent({
        mentionText: "how to fix this issue?",
        issueTitle: "Feature request",
        issueBody: "The feature is not working after the last update",
      }),
    ).toBe(true);
  });

  it("returns false when mention has help keyword but issue context has no problem keyword", () => {
    expect(
      classifyTroubleshootingIntent({
        mentionText: "Can you help me?",
        issueTitle: "Add dark mode support",
        issueBody: "It would be nice to have dark mode",
      }),
    ).toBe(false);
  });

  it("returns false when issue has problem keyword but mention has no help keyword", () => {
    expect(
      classifyTroubleshootingIntent({
        mentionText: "I noticed this today",
        issueTitle: "App crash on startup",
        issueBody: "The app crashes every time I open it",
      }),
    ).toBe(false);
  });

  it("returns false for general question without problem context", () => {
    expect(
      classifyTroubleshootingIntent({
        mentionText: "help me understand this code",
        issueTitle: "Add dark mode",
        issueBody: "We should add a dark mode toggle to the settings page",
      }),
    ).toBe(false);
  });

  it("returns true for crash issue with 'any ideas' mention", () => {
    expect(
      classifyTroubleshootingIntent({
        mentionText: "any ideas what could cause this?",
        issueTitle: "App crash on startup",
        issueBody: "Segfault when launching the application",
      }),
    ).toBe(true);
  });

  it("is case insensitive", () => {
    expect(
      classifyTroubleshootingIntent({
        mentionText: "Help debug this",
        issueTitle: "ERROR in build",
        issueBody: null,
      }),
    ).toBe(true);
  });

  it("handles null issue body with problem keyword in title", () => {
    expect(
      classifyTroubleshootingIntent({
        mentionText: "any suggestions?",
        issueTitle: "Timeout when connecting to server",
        issueBody: null,
      }),
    ).toBe(true);
  });
});

describe("buildTroubleshootMarker", () => {
  it("produces correct format with comment ID", () => {
    const marker = buildTroubleshootMarker("xbmc", 42, 12345);
    expect(marker).toBe(
      `<!-- ${TROUBLESHOOT_MARKER_PREFIX}:xbmc:42:comment-12345 -->`,
    );
  });
});

describe("hasTroubleshootMarker", () => {
  const makeComment = (body: string | null) => ({ body });

  it("returns true when matching marker exists", () => {
    const marker = buildTroubleshootMarker("xbmc", 42, 100);
    const comments = [makeComment("some text"), makeComment(`response\n${marker}`)];
    expect(hasTroubleshootMarker(comments, 100)).toBe(true);
  });

  it("returns false when no marker exists", () => {
    const comments = [makeComment("just a regular comment")];
    expect(hasTroubleshootMarker(comments, 100)).toBe(false);
  });

  it("returns false when marker exists for different comment ID", () => {
    const marker = buildTroubleshootMarker("xbmc", 42, 200);
    const comments = [makeComment(`response\n${marker}`)];
    expect(hasTroubleshootMarker(comments, 100)).toBe(false);
  });

  it("handles null/undefined body in comments", () => {
    const comments = [
      makeComment(null),
      { body: undefined },
      makeComment("normal comment"),
    ];
    expect(hasTroubleshootMarker(comments, 100)).toBe(false);
  });
});
