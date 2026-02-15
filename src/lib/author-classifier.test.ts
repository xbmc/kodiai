import { describe, expect, test } from "bun:test";
import { classifyAuthor } from "./author-classifier.ts";

describe("classifyAuthor", () => {
  test("maps MEMBER to core", () => {
    expect(classifyAuthor({ authorAssociation: "MEMBER" }).tier).toBe("core");
  });

  test("maps OWNER to core", () => {
    expect(classifyAuthor({ authorAssociation: "OWNER" }).tier).toBe("core");
  });

  test("maps FIRST_TIMER to first-time", () => {
    expect(classifyAuthor({ authorAssociation: "FIRST_TIMER" }).tier).toBe("first-time");
  });

  test("maps FIRST_TIME_CONTRIBUTOR to first-time", () => {
    expect(classifyAuthor({ authorAssociation: "FIRST_TIME_CONTRIBUTOR" }).tier).toBe("first-time");
  });

  test("maps COLLABORATOR without PR count to regular", () => {
    expect(classifyAuthor({ authorAssociation: "COLLABORATOR" }).tier).toBe("regular");
  });

  test("maps CONTRIBUTOR without PR count to regular", () => {
    expect(classifyAuthor({ authorAssociation: "CONTRIBUTOR" }).tier).toBe("regular");
  });

  test("maps NONE without PR count to first-time", () => {
    expect(classifyAuthor({ authorAssociation: "NONE" }).tier).toBe("first-time");
  });

  test("maps MANNEQUIN without PR count to first-time", () => {
    expect(classifyAuthor({ authorAssociation: "MANNEQUIN" }).tier).toBe("first-time");
  });

  test("maps NONE with prCount=0 to first-time", () => {
    expect(classifyAuthor({ authorAssociation: "NONE", prCount: 0 }).tier).toBe("first-time");
  });

  test("maps NONE with prCount=1 to first-time", () => {
    expect(classifyAuthor({ authorAssociation: "NONE", prCount: 1 }).tier).toBe("first-time");
  });

  test("maps NONE with prCount=2 to regular", () => {
    expect(classifyAuthor({ authorAssociation: "NONE", prCount: 2 }).tier).toBe("regular");
  });

  test("maps NONE with prCount=9 to regular", () => {
    expect(classifyAuthor({ authorAssociation: "NONE", prCount: 9 }).tier).toBe("regular");
  });

  test("maps NONE with prCount=10 to core", () => {
    expect(classifyAuthor({ authorAssociation: "NONE", prCount: 10 }).tier).toBe("core");
  });

  test("maps NONE with prCount=50 to core", () => {
    expect(classifyAuthor({ authorAssociation: "NONE", prCount: 50 }).tier).toBe("core");
  });

  test("maps COLLABORATOR with prCount=0 to first-time", () => {
    expect(classifyAuthor({ authorAssociation: "COLLABORATOR", prCount: 0 }).tier).toBe("first-time");
  });

  test("maps COLLABORATOR with prCount=5 to regular", () => {
    expect(classifyAuthor({ authorAssociation: "COLLABORATOR", prCount: 5 }).tier).toBe("regular");
  });

  test("maps COLLABORATOR with prCount=15 to core", () => {
    expect(classifyAuthor({ authorAssociation: "COLLABORATOR", prCount: 15 }).tier).toBe("core");
  });

  test("maps CONTRIBUTOR with prCount=1 to first-time", () => {
    expect(classifyAuthor({ authorAssociation: "CONTRIBUTOR", prCount: 1 }).tier).toBe("first-time");
  });

  test("definite MEMBER mapping ignores PR count", () => {
    expect(classifyAuthor({ authorAssociation: "MEMBER", prCount: 0 }).tier).toBe("core");
  });

  test("definite FIRST_TIMER mapping ignores PR count", () => {
    expect(classifyAuthor({ authorAssociation: "FIRST_TIMER", prCount: 50 }).tier).toBe("first-time");
  });

  test("unknown association defaults to first-time", () => {
    expect(classifyAuthor({ authorAssociation: "UNKNOWN_VALUE" }).tier).toBe("first-time");
  });

  test("returns classification metadata shape", () => {
    expect(classifyAuthor({ authorAssociation: "OWNER", prCount: 12 })).toEqual({
      tier: "core",
      authorAssociation: "OWNER",
      prCount: 12,
      cachedAt: null,
    });
  });
});
