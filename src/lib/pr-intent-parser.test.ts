import { describe, expect, test } from "bun:test";
import {
  buildKeywordParsingSection,
  DEFAULT_EMPTY_INTENT,
  parsePRIntent,
} from "./pr-intent-parser.ts";

describe("extractBracketTags / bracket tag parsing", () => {
  test("parses [WIP] in title", () => {
    const intent = parsePRIntent("[WIP] Fix login bug", null);
    expect(intent.isWIP).toBe(true);
    expect(intent.bracketTags).toEqual([
      { tag: "wip", recognized: true, source: "title" },
    ]);
  });

  test("parses [security-review] into focusAreas", () => {
    const intent = parsePRIntent("Fix bug [security-review]", null);
    expect(intent.focusAreas).toEqual(["security"]);
  });

  test("parses [no-review]", () => {
    const intent = parsePRIntent("[no-review] Docs update", null);
    expect(intent.noReview).toBe(true);
  });

  test("parses [style-ok]", () => {
    const intent = parsePRIntent("[style-ok] Refactor utils", null);
    expect(intent.styleOk).toBe(true);
  });

  test("parses [strict-review]", () => {
    const intent = parsePRIntent("[strict-review] Critical fix", null);
    expect(intent.profileOverride).toBe("strict");
  });

  test("captures unrecognized tags", () => {
    const intent = parsePRIntent("[foobar] Random PR", null);
    expect(intent.unrecognized).toEqual(["foobar"]);
    expect(intent.recognized).toEqual([]);
  });

  test("supports multiple tags in title", () => {
    const intent = parsePRIntent("[WIP] [security-review] Fix", null);
    expect(intent.isWIP).toBe(true);
    expect(intent.focusAreas).toEqual(["security"]);
    expect(intent.recognized).toEqual(["wip", "security-review"]);
  });

  test("resolves profile conflicts to strict", () => {
    const intent = parsePRIntent("[STRICT-REVIEW] [minimal-review]", null);
    expect(intent.profileOverride).toBe("strict");
  });

  test("deduplicates repeated bracket tags", () => {
    const intent = parsePRIntent("[wip] [Wip] [WIP]", null);
    expect(intent.bracketTags).toEqual([
      { tag: "wip", recognized: true, source: "title" },
    ]);
    expect(intent.isWIP).toBe(true);
  });

  test("returns empty signals when no tags", () => {
    const intent = parsePRIntent("No tags here", null);
    expect(intent.recognized).toEqual([]);
    expect(intent.unrecognized).toEqual([]);
    expect(intent.noReview).toBe(false);
    expect(intent.isWIP).toBe(false);
    expect(intent.profileOverride).toBeNull();
  });
});

describe("conventional commit parsing", () => {
  test("parses feat prefix", () => {
    const intent = parsePRIntent("feat: add user login", null);
    expect(intent.conventionalType).toEqual({
      type: "feat",
      isBreaking: false,
      source: "title",
    });
  });

  test("parses breaking fix prefix", () => {
    const intent = parsePRIntent("fix!: resolve crash", null);
    expect(intent.conventionalType).toEqual({ type: "fix", isBreaking: true, source: "title" });
    expect(intent.breakingChangeDetected).toBe(true);
  });

  test("parses scoped docs prefix", () => {
    const intent = parsePRIntent("docs(readme): update", null);
    expect(intent.conventionalType).toEqual({ type: "docs", isBreaking: false, source: "title" });
  });

  test("parses type case-insensitively", () => {
    const intent = parsePRIntent("Fix: a bug", null);
    expect(intent.conventionalType).toEqual({ type: "fix", isBreaking: false, source: "title" });
  });

  test("returns null for non-conventional title", () => {
    const intent = parsePRIntent("Not a conventional: commit", null);
    expect(intent.conventionalType).toBeNull();
  });
});

describe("breaking change detection", () => {
  test("detects from conventional breaking title", () => {
    const intent = parsePRIntent("feat!: new API", null);
    expect(intent.breakingChangeDetected).toBe(true);
  });

  test("detects 'breaking change' in body", () => {
    const intent = parsePRIntent("Update API", "This is a breaking change to the REST API");
    expect(intent.breakingChangeDetected).toBe(true);
    expect(intent.breakingChangeSources.some((s) => s.source === "body")).toBe(true);
  });

  test("detects 'this breaks' in body", () => {
    const intent = parsePRIntent("Update API", "This breaks backward compatibility");
    expect(intent.breakingChangeDetected).toBe(true);
  });

  test("detects 'breaking api' in body", () => {
    const intent = parsePRIntent("Update API", "Breaking API response format");
    expect(intent.breakingChangeDetected).toBe(true);
  });

  test("ignores fenced code blocks in body", () => {
    const intent = parsePRIntent("Update API", "```\nbreaking change\n```");
    expect(intent.breakingChangeDetected).toBe(false);
  });

  test("ignores inline code in body", () => {
    const intent = parsePRIntent("Update API", "`breaking change`");
    expect(intent.breakingChangeDetected).toBe(false);
  });

  test("detects breaking phrase in commit messages", () => {
    const intent = parsePRIntent("Update API", null, [
      { sha: "abc1234", message: "breaking change: remove old API" },
    ]);
    expect(intent.breakingChangeDetected).toBe(true);
    expect(intent.breakingChangeSources).toContainEqual({
      source: "commit",
      excerpt: "breaking change: remove old API",
      commitSha: "abc1234",
    });
  });

  test("ignores unchecked PR template checkbox mentioning breaking change", () => {
    // The xbmc/xbmc PR template includes "- [ ] **Breaking change**" as a checkbox option.
    // An unselected checkbox means the author did NOT indicate a breaking change.
    const templateBody = [
      "## Types of change",
      "- [ ] **Bug fix** (non-breaking change which fixes an issue)",
      "- [ ] **Breaking change** (fix or feature that will cause existing functionality to change)",
      "- [ ] **New feature** (non-breaking change which adds functionality)",
    ].join("\n");
    const intent = parsePRIntent("Fix login button alignment", templateBody);
    expect(intent.breakingChangeDetected).toBe(false);
  });

  test("does not detect breaking change from body checkbox template (any checked state)", () => {
    // The entire Types-of-change block is stripped regardless of checked/unchecked state —
    // use the PR title or commit messages to signal breaking changes, not template checkboxes.
    const templateBody = [
      "## Types of change",
      "- [ ] **Bug fix** (non-breaking change which fixes an issue)",
      "- [x] **Breaking change** (fix or feature that will cause existing functionality to change)",
      "- [ ] **New feature** (non-breaking change which adds functionality)",
    ].join("\n");
    const intent = parsePRIntent("Remove deprecated auth endpoint", templateBody);
    expect(intent.breakingChangeDetected).toBe(false);
  });

  test("still detects 'breaking change' in plain body prose", () => {
    const intent = parsePRIntent("Update API", "This is a breaking change to the REST API");
    expect(intent.breakingChangeDetected).toBe(true);
  });

  test("ignores HTML comments containing breaking change (template instructions)", () => {
    const body = "<!-- This breaking change section is for documentation only -->\nFix null pointer";
    const intent = parsePRIntent("Fix null pointer", body);
    expect(intent.breakingChangeDetected).toBe(false);
  });

  test("xbmc PR template body with Breaking change checkbox does not trigger detection", () => {
    // Real xbmc PR template structure: ## Types of change section contains a
    // "Breaking change" checkbox option that must not be read as author intent.
    // Previously the heading-only stripping left the checkbox lines in place,
    // and the 3-consecutive-run backstop still fired on 3+ boxes.
    // This fixture covers the regression: the full section body must be stripped.
    const xbmcFixtureBody = [
      "## Description",
      "Fix player crash on malformed stream input.",
      "",
      "## Types of change",
      "- [ ] Bug fix (non-breaking change which fixes an issue)",
      "- [ ] Breaking change (fix or feature that will cause existing functionality to change)",
      "- [ ] New feature (non-breaking change which adds functionality)",
      "",
      "## Checklist",
      "- [x] My code follows the code style of this project.",
      "- [x] I have read the CONTRIBUTING document.",
      "- [x] I have added tests that prove my fix is effective.",
    ].join("\n");
    const intent = parsePRIntent("Fix player crash", xbmcFixtureBody);
    expect(intent.breakingChangeDetected).toBe(false);
    expect(intent.breakingChangeSources.filter((s) => s.source === "body")).toHaveLength(0);
  });

  test("plain body prose breaking change is still detected after template stripping", () => {
    const body = "This is a breaking change to the player API.\n\nUpdated the stream decoder interface.";
    const intent = parsePRIntent("Update player API", body);
    expect(intent.breakingChangeDetected).toBe(true);
    expect(intent.breakingChangeSources.some((s) => s.source === "body")).toBe(true);
  });
});

describe("commit message scanning", () => {
  test("unions [WIP] from commits", () => {
    const intent = parsePRIntent("Normal title", null, [{ sha: "abc1234", message: "[WIP] checkpoint" }]);
    expect(intent.isWIP).toBe(true);
  });

  test("unions [security-review] from commits", () => {
    const intent = parsePRIntent("Normal title", null, [{ sha: "abc1234", message: "[security-review] tighten auth" }]);
    expect(intent.focusAreas).toEqual(["security"]);
  });

  test("empty commit array has no effect", () => {
    const intent = parsePRIntent("Normal title", null, []);
    expect(intent.recognized).toEqual([]);
  });

  test("undefined commits has no effect", () => {
    const intent = parsePRIntent("Normal title", null);
    expect(intent.recognized).toEqual([]);
  });
});

describe("sampleCommitMessages", () => {
  test("for 60 commits uses first/last/middle sampling", () => {
    const commits = Array.from({ length: 60 }, (_, i) => ({
      sha: `sha-${i + 1}`,
      message: i === 24 || i === 29 || i === 49 ? "[wip] sampled" : "normal",
    }));
    const intent = parsePRIntent("Regular title", null, commits);
    expect(intent.isWIP).toBe(true);
  });

  test("for 30 commits scans all commits", () => {
    const commits = Array.from({ length: 30 }, (_, i) => ({
      sha: `sha-${i + 1}`,
      message: i === 29 ? "[wip] end" : "normal",
    }));
    const intent = parsePRIntent("Regular title", null, commits);
    expect(intent.isWIP).toBe(true);
  });

  test("for exactly 50 commits scans all commits", () => {
    const commits = Array.from({ length: 50 }, (_, i) => ({
      sha: `sha-${i + 1}`,
      message: i === 49 ? "[wip] end" : "normal",
    }));
    const intent = parsePRIntent("Regular title", null, commits);
    expect(intent.isWIP).toBe(true);
  });
});

describe("buildKeywordParsingSection", () => {
  test("shows no keywords when empty", () => {
    const section = buildKeywordParsingSection(DEFAULT_EMPTY_INTENT);
    expect(section).toContain("- Keyword parsing: No keywords detected");
  });

  test("renders recognized/unrecognized/conventional/breaking sections", () => {
    const intent = parsePRIntent("[WIP] feat!: update auth [foobar]", "", [
      { sha: "abc1234", message: "breaking change: remove old API" },
    ]);

    const section = buildKeywordParsingSection(intent);
    expect(section).toContain("[WIP] in title");
    // Unrecognized tags are not shown in display (they are passed to prompt but not rendered)
    expect(section).toContain("conventional type: feat (breaking)");
    expect(section).toContain("breaking change in commit abc1234");
  });
});
