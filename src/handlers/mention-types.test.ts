import { describe, expect, test } from "bun:test";
import { containsMention, stripMention } from "./mention-types.ts";

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
});
