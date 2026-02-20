import { describe, expect, test } from "bun:test";
import { createInMemoryWriteConfirmationStore } from "./write-confirmation-store.ts";

describe("createInMemoryWriteConfirmationStore", () => {
  test("stores pending confirmation with deterministic timeout metadata", () => {
    let now = 1_700_000_000_000;
    const store = createInMemoryWriteConfirmationStore(() => now);

    const pending = store.openPending({
      channel: "C123",
      threadTs: "1700000000.000111",
      owner: "xbmc",
      repo: "xbmc",
      keyword: "apply",
      request: "update src/slack/assistant-handler.ts",
      prompt: "prompt text",
      timeoutMs: 15 * 60 * 1000,
    });

    expect(pending.pending).toBe(true);
    expect(pending.command).toBe("apply: update src/slack/assistant-handler.ts");
    expect(pending.createdAt).toBe(now);
    expect(pending.expiresAt).toBe(now + 15 * 60 * 1000);

    // Entry is still retrievable within TTL
    now += 14 * 60 * 1000;
    expect(store.getPending("C123", "1700000000.000111")).toEqual(pending);

    // After TTL expires, entry is automatically evicted
    now += 2 * 60 * 1000;
    expect(store.getPending("C123", "1700000000.000111")).toBeUndefined();
  });

  test("keeps pending state when confirmation command mismatches", () => {
    const store = createInMemoryWriteConfirmationStore(() => 1000);

    const pending = store.openPending({
      channel: "C123",
      threadTs: "1700000000.000111",
      owner: "xbmc",
      repo: "xbmc",
      keyword: "change",
      request: "update docs",
      prompt: "prompt text",
      timeoutMs: 900000,
    });

    const result = store.confirm("C123", "1700000000.000111", "apply: update docs");
    expect(result).toEqual({ outcome: "mismatch", pending });
    expect(store.getPending("C123", "1700000000.000111")).toEqual(pending);
  });

  test("resumes deterministically on exact confirmation command", () => {
    const store = createInMemoryWriteConfirmationStore(() => 1000);

    const pending = store.openPending({
      channel: "C123",
      threadTs: "1700000000.000111",
      owner: "xbmc",
      repo: "xbmc",
      keyword: "apply",
      request: "fix race condition",
      prompt: "prompt text",
      timeoutMs: 900000,
    });

    const result = store.confirm("C123", "1700000000.000111", "apply: fix race condition");
    expect(result).toEqual({ outcome: "confirmed", pending });
    expect(store.getPending("C123", "1700000000.000111")).toBeUndefined();
  });
});
