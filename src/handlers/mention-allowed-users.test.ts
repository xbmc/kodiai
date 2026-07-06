import { describe, expect, test } from "bun:test";
import { isMentionAuthorAllowed } from "./mention-allowed-users.ts";

describe("mention allowed users", () => {
  test("allows every author when the allowlist is empty", () => {
    expect(isMentionAuthorAllowed("alice", [])).toBe(true);
  });

  test("matches configured users case-insensitively", () => {
    expect(isMentionAuthorAllowed("Alice", ["bob", "ALICE"])).toBe(true);
  });

  test("rejects authors outside the configured allowlist", () => {
    expect(isMentionAuthorAllowed("mallory", ["alice", "bob"])).toBe(false);
  });
});
