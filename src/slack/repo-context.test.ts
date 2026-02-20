import { describe, expect, test } from "bun:test";
import { resolveSlackRepoContext } from "./repo-context.ts";

const DEFAULT_REPO = "xbmc/xbmc";

describe("resolveSlackRepoContext", () => {
  test("returns default xbmc/xbmc context when no repo is named", () => {
    const result = resolveSlackRepoContext("Can you summarize this thread?", DEFAULT_REPO);

    expect(result).toEqual({
      outcome: "default",
      repo: "xbmc/xbmc",
      acknowledgementText: undefined,
      clarifyingQuestion: undefined,
    });
  });

  test("returns override with acknowledgement when exactly one explicit repo is named", () => {
    const result = resolveSlackRepoContext("Please use Kodiai/xbmc-test for this answer.", DEFAULT_REPO);

    expect(result).toEqual({
      outcome: "override",
      repo: "kodiai/xbmc-test",
      acknowledgementText: "Using repo context kodiai/xbmc-test.",
      clarifyingQuestion: undefined,
    });
  });

  test("returns ambiguity when multiple distinct repos are referenced", () => {
    const result = resolveSlackRepoContext("Compare xbmc/xbmc with kodiai/xbmc-test.", DEFAULT_REPO);

    expect(result).toEqual({
      outcome: "ambiguous",
      repo: undefined,
      acknowledgementText: undefined,
      clarifyingQuestion:
        "I could not determine a single repo context. Which repo should I use? Please reply with owner/repo.",
    });
  });

  test("returns ambiguity when repo references are malformed or incomplete", () => {
    const trailingOwner = resolveSlackRepoContext("Use xbmc/ for this question.", DEFAULT_REPO);
    const leadingRepo = resolveSlackRepoContext("Could this run against /xbmc?", DEFAULT_REPO);

    expect(trailingOwner).toEqual({
      outcome: "ambiguous",
      repo: undefined,
      acknowledgementText: undefined,
      clarifyingQuestion:
        "I could not determine a single repo context. Which repo should I use? Please reply with owner/repo.",
    });

    expect(leadingRepo).toEqual({
      outcome: "ambiguous",
      repo: undefined,
      acknowledgementText: undefined,
      clarifyingQuestion:
        "I could not determine a single repo context. Which repo should I use? Please reply with owner/repo.",
    });
  });

  test("does not treat file paths as owner/repo overrides", () => {
    const result = resolveSlackRepoContext("Can you update src/slack/assistant-handler.ts and summarize the change?", DEFAULT_REPO);

    expect(result).toEqual({
      outcome: "default",
      repo: "xbmc/xbmc",
      acknowledgementText: undefined,
      clarifyingQuestion: undefined,
    });
  });

  test("uses custom default repo when provided", () => {
    const result = resolveSlackRepoContext("Can you summarize this thread?", "myorg/myrepo");

    expect(result).toEqual({
      outcome: "default",
      repo: "myorg/myrepo",
      acknowledgementText: undefined,
      clarifyingQuestion: undefined,
    });
  });

  test("treats mention of custom default repo as default, not override", () => {
    const result = resolveSlackRepoContext("Check myorg/myrepo for issues.", "myorg/myrepo");

    expect(result).toEqual({
      outcome: "default",
      repo: "myorg/myrepo",
      acknowledgementText: undefined,
      clarifyingQuestion: undefined,
    });
  });
});
