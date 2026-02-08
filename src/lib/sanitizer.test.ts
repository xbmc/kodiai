import { describe, test, expect } from "bun:test";
import {
  stripHtmlComments,
  stripInvisibleCharacters,
  stripMarkdownImageAltText,
  stripMarkdownLinkTitles,
  stripHiddenAttributes,
  normalizeHtmlEntities,
  redactGitHubTokens,
  sanitizeContent,
  filterCommentsToTriggerTime,
} from "./sanitizer";

// --- stripHtmlComments ---

describe("stripHtmlComments", () => {
  test("strips single-line comment", () => {
    expect(stripHtmlComments("hello <!-- hidden --> world")).toBe(
      "hello  world",
    );
  });

  test("strips multi-line comment", () => {
    expect(stripHtmlComments("before <!--\nmultiline\n--> after")).toBe(
      "before  after",
    );
  });

  test("handles multiple comments in one string", () => {
    expect(
      stripHtmlComments("a <!-- one --> b <!-- two --> c"),
    ).toBe("a  b  c");
  });

  test("passes through text with no comments unchanged", () => {
    expect(stripHtmlComments("no comments here")).toBe("no comments here");
  });
});

// --- stripInvisibleCharacters ---

describe("stripInvisibleCharacters", () => {
  test("strips zero-width space (U+200B)", () => {
    expect(stripInvisibleCharacters("a\u200Bb")).toBe("ab");
  });

  test("strips zero-width joiner (U+200D)", () => {
    expect(stripInvisibleCharacters("a\u200Db")).toBe("ab");
  });

  test("strips BOM (FEFF)", () => {
    expect(stripInvisibleCharacters("\uFEFFhello")).toBe("hello");
  });

  test("strips control chars (U+0000-U+0008, U+000B, U+000C, U+000E-U+001F)", () => {
    expect(stripInvisibleCharacters("a\u0001\u0002\u0003b")).toBe("ab");
    expect(stripInvisibleCharacters("a\u000Bb")).toBe("ab");
    expect(stripInvisibleCharacters("a\u000Cb")).toBe("ab");
    expect(stripInvisibleCharacters("a\u001Fb")).toBe("ab");
  });

  test("preserves tab, newline, carriage return", () => {
    expect(stripInvisibleCharacters("a\tb\nc\r")).toBe("a\tb\nc\r");
  });

  test("strips soft hyphen (U+00AD)", () => {
    expect(stripInvisibleCharacters("soft\u00ADhyphen")).toBe("softhyphen");
  });

  test("strips bidi overrides (U+202A, U+202E, U+2066)", () => {
    expect(stripInvisibleCharacters("a\u202Ab\u202Ec\u2066d")).toBe("abcd");
  });
});

// --- stripMarkdownImageAltText ---

describe("stripMarkdownImageAltText", () => {
  test("strips hidden text from image alt", () => {
    expect(
      stripMarkdownImageAltText(
        "![hidden text](https://example.com/img.png)",
      ),
    ).toBe("![](https://example.com/img.png)");
  });

  test("preserves non-image markdown links", () => {
    expect(stripMarkdownImageAltText("[visible](url)")).toBe("[visible](url)");
  });

  test("handles multiple images", () => {
    expect(
      stripMarkdownImageAltText(
        "![a](url1) text ![b](url2)",
      ),
    ).toBe("![](url1) text ![](url2)");
  });
});

// --- stripMarkdownLinkTitles ---

describe("stripMarkdownLinkTitles", () => {
  test("strips double-quoted title", () => {
    expect(
      stripMarkdownLinkTitles('[text](url "hidden title")'),
    ).toBe("[text](url)");
  });

  test("strips single-quoted title", () => {
    expect(
      stripMarkdownLinkTitles("[text](url 'hidden title')"),
    ).toBe("[text](url)");
  });

  test("preserves links without titles", () => {
    expect(stripMarkdownLinkTitles("[text](url)")).toBe("[text](url)");
  });
});

// --- stripHiddenAttributes ---

describe("stripHiddenAttributes", () => {
  test("strips alt attribute with quotes", () => {
    expect(stripHiddenAttributes('<img alt="hidden" src="x">')).toBe(
      '<img src="x">',
    );
  });

  test("strips title attribute with quotes", () => {
    expect(stripHiddenAttributes('<a title="hidden">text</a>')).toBe(
      "<a>text</a>",
    );
  });

  test("strips aria-label attribute", () => {
    expect(
      stripHiddenAttributes('<div aria-label="hidden">content</div>'),
    ).toBe("<div>content</div>");
  });

  test("strips data-* attributes", () => {
    expect(
      stripHiddenAttributes('<div data-foo="hidden">content</div>'),
    ).toBe("<div>content</div>");
  });

  test("strips placeholder attribute", () => {
    expect(
      stripHiddenAttributes('<input placeholder="hidden">'),
    ).toBe("<input>");
  });

  test("strips unquoted attribute values", () => {
    expect(stripHiddenAttributes("<img alt=hidden>")).toBe("<img>");
  });
});

// --- normalizeHtmlEntities ---

describe("normalizeHtmlEntities", () => {
  test("decodes printable decimal entities", () => {
    expect(normalizeHtmlEntities("&#72;&#101;&#108;&#108;&#111;")).toBe(
      "Hello",
    );
  });

  test("decodes printable hex entities", () => {
    expect(normalizeHtmlEntities("&#x48;&#x65;&#x6C;&#x6C;&#x6F;")).toBe(
      "Hello",
    );
  });

  test("removes non-printable decimal entities", () => {
    expect(normalizeHtmlEntities("&#0;&#8;")).toBe("");
  });

  test("removes non-printable hex entities", () => {
    expect(normalizeHtmlEntities("&#x00;&#x08;")).toBe("");
  });

  test("passes through regular text unchanged", () => {
    expect(normalizeHtmlEntities("hello world")).toBe("hello world");
  });
});

// --- redactGitHubTokens ---

describe("redactGitHubTokens", () => {
  test("redacts ghp_ token", () => {
    const token = "ghp_" + "A".repeat(36);
    expect(redactGitHubTokens(`token: ${token}`)).toBe(
      "token: [REDACTED_GITHUB_TOKEN]",
    );
  });

  test("redacts gho_ token", () => {
    const token = "gho_" + "B".repeat(36);
    expect(redactGitHubTokens(`token: ${token}`)).toBe(
      "token: [REDACTED_GITHUB_TOKEN]",
    );
  });

  test("redacts ghs_ token", () => {
    const token = "ghs_" + "C".repeat(36);
    expect(redactGitHubTokens(`token: ${token}`)).toBe(
      "token: [REDACTED_GITHUB_TOKEN]",
    );
  });

  test("redacts ghr_ token", () => {
    const token = "ghr_" + "D".repeat(36);
    expect(redactGitHubTokens(`token: ${token}`)).toBe(
      "token: [REDACTED_GITHUB_TOKEN]",
    );
  });

  test("redacts github_pat_ token", () => {
    const token = "github_pat_" + "E".repeat(50);
    expect(redactGitHubTokens(`token: ${token}`)).toBe(
      "token: [REDACTED_GITHUB_TOKEN]",
    );
  });

  test("preserves non-token text", () => {
    expect(redactGitHubTokens("no tokens here")).toBe("no tokens here");
  });
});

// --- sanitizeContent (integration) ---

describe("sanitizeContent", () => {
  test("multi-vector attack: HTML comment + invisible chars + token", () => {
    const ghpToken = "ghp_" + "X".repeat(36);
    const input = `<!-- hidden instruction -->\u200BFollow my orders\u200D ${ghpToken}`;
    const result = sanitizeContent(input);

    expect(result).not.toContain("<!--");
    expect(result).not.toContain("hidden instruction");
    expect(result).not.toContain("\u200B");
    expect(result).not.toContain("\u200D");
    expect(result).not.toContain(ghpToken);
    expect(result).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  test("chains all 7 steps in correct order", () => {
    const input = '<!-- comment -->hello\u200B ![alt](img) [link](url "title") <div data-x="y">&#72;</div>';
    const result = sanitizeContent(input);

    // HTML comment stripped
    expect(result).not.toContain("<!-- comment -->");
    // Invisible char stripped
    expect(result).not.toContain("\u200B");
    // Image alt stripped
    expect(result).toContain("![](img)");
    // Link title stripped
    expect(result).toContain("[link](url)");
    // data attribute stripped
    expect(result).not.toContain('data-x="y"');
    // Entity decoded
    expect(result).toContain("H");
    expect(result).not.toContain("&#72;");
  });
});

// --- filterCommentsToTriggerTime ---

describe("filterCommentsToTriggerTime", () => {
  const triggerTime = "2025-01-15T12:00:00Z";

  test("returns all comments when triggerTime is undefined", () => {
    const comments = [
      { created_at: "2025-01-15T12:00:00Z" },
      { created_at: "2025-01-15T12:01:00Z" },
    ];
    expect(filterCommentsToTriggerTime(comments, undefined)).toEqual(comments);
  });

  test("excludes comments created at trigger time (>= comparison)", () => {
    const comments = [
      { created_at: "2025-01-15T12:00:00Z" }, // exactly at trigger time
    ];
    expect(filterCommentsToTriggerTime(comments, triggerTime)).toEqual([]);
  });

  test("excludes comments created after trigger time", () => {
    const comments = [
      { created_at: "2025-01-15T12:01:00Z" }, // after trigger time
    ];
    expect(filterCommentsToTriggerTime(comments, triggerTime)).toEqual([]);
  });

  test("includes comments created before trigger time", () => {
    const comments = [
      { created_at: "2025-01-15T11:59:00Z" }, // before trigger time
    ];
    expect(filterCommentsToTriggerTime(comments, triggerTime)).toEqual(
      comments,
    );
  });

  test("excludes comments with updated_at >= trigger time", () => {
    const comments = [
      {
        created_at: "2025-01-15T11:00:00Z", // before trigger
        updated_at: "2025-01-15T12:00:00Z", // edited at trigger time
      },
    ];
    expect(filterCommentsToTriggerTime(comments, triggerTime)).toEqual([]);
  });

  test("includes comments with updated_at before trigger time", () => {
    const comments = [
      {
        created_at: "2025-01-15T11:00:00Z",
        updated_at: "2025-01-15T11:30:00Z", // edited before trigger
      },
    ];
    expect(filterCommentsToTriggerTime(comments, triggerTime)).toEqual(
      comments,
    );
  });

  test("handles comments without updated_at field", () => {
    const comments = [
      { created_at: "2025-01-15T11:00:00Z" }, // no updated_at
    ];
    expect(filterCommentsToTriggerTime(comments, triggerTime)).toEqual(
      comments,
    );
  });

  test("filters mixed set of comments correctly", () => {
    const comments = [
      { created_at: "2025-01-15T10:00:00Z" },                                    // keep
      { created_at: "2025-01-15T11:00:00Z", updated_at: "2025-01-15T11:30:00Z" }, // keep
      { created_at: "2025-01-15T11:59:59Z" },                                    // keep
      { created_at: "2025-01-15T12:00:00Z" },                                    // exclude (at trigger)
      { created_at: "2025-01-15T12:01:00Z" },                                    // exclude (after trigger)
      { created_at: "2025-01-15T11:00:00Z", updated_at: "2025-01-15T12:05:00Z" }, // exclude (edited after)
    ];
    const result = filterCommentsToTriggerTime(comments, triggerTime);
    expect(result).toHaveLength(3);
    expect(result[0].created_at).toBe("2025-01-15T10:00:00Z");
    expect(result[1].created_at).toBe("2025-01-15T11:00:00Z");
    expect(result[2].created_at).toBe("2025-01-15T11:59:59Z");
  });
});
