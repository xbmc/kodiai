import { describe, expect, test } from "bun:test";
import {
  isAllowlistedFormatterExecutable,
  planFormatterCommandExecution,
  spawnArgsForFormatterCommand,
  tokenizeFormatterCommand,
} from "./formatter-command-sandbox.ts";

describe("tokenizeFormatterCommand", () => {
  test("splits whitespace and preserves quoted segments", () => {
    expect(tokenizeFormatterCommand(`git clang-format --diff origin/main HEAD`)).toEqual([
      "git",
      "clang-format",
      "--diff",
      "origin/main",
      "HEAD",
    ]);
    expect(tokenizeFormatterCommand(`bun run "format --check" feature`)).toEqual([
      "bun",
      "run",
      "format --check",
      "feature",
    ]);
  });
});

describe("planFormatterCommandExecution", () => {
  test("uses argv mode for allowlisted default git clang-format command", () => {
    expect(planFormatterCommandExecution("git clang-format --diff origin/main HEAD")).toEqual({
      mode: "argv",
      argv: ["git", "clang-format", "--diff", "origin/main", "HEAD"],
    });
  });

  test("rejects pipelines and substitutions instead of shell fallback", () => {
    expect(planFormatterCommandExecution("git clang-format --diff origin/main HEAD | head")).toMatchObject({
      mode: "rejected",
      reason: "shell-metacharacters",
    });
    expect(planFormatterCommandExecution("echo $(whoami)")).toMatchObject({
      mode: "rejected",
      reason: "shell-metacharacters",
    });
  });

  test("rejects non-allowlisted executables", () => {
    expect(planFormatterCommandExecution("./scripts/custom-formatter.sh")).toMatchObject({
      mode: "rejected",
      reason: "executable-not-allowlisted",
    });
  });

  test("allowlists common formatter tooling", () => {
    expect(isAllowlistedFormatterExecutable("prettier")).toBeTrue();
    expect(isAllowlistedFormatterExecutable("python3")).toBeTrue();
    expect(isAllowlistedFormatterExecutable("unknown-tool")).toBeFalse();
  });
});

describe("spawnArgsForFormatterCommand", () => {
  test("returns argv spawn args for safe commands", () => {
    expect(spawnArgsForFormatterCommand("bun run format")).toEqual({
      spawnArgs: ["bun", "run", "format"],
      executionMode: "argv",
    });
  });

  test("returns rejected execution mode for shell pipelines", () => {
    expect(spawnArgsForFormatterCommand("prettier --write . && git diff")).toEqual({
      executionMode: "rejected",
      rejectionReason: "shell-metacharacters",
    });
  });
});
