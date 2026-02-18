import { describe, expect, test } from "bun:test";
import { createSlackThreadSessionStore } from "./thread-session-store.ts";

describe("createSlackThreadSessionStore", () => {
  test("marks a thread started and reports active session", () => {
    const store = createSlackThreadSessionStore();

    expect(store.markThreadStarted({ channel: "C123KODIAI", threadTs: "1700000000.000111" })).toBe(true);
    expect(store.isThreadStarted({ channel: "C123KODIAI", threadTs: "1700000000.000111" })).toBe(true);
  });

  test("start is idempotent for the same normalized channel and thread", () => {
    const store = createSlackThreadSessionStore();

    expect(store.markThreadStarted({ channel: " C123KODIAI ", threadTs: "1700000000.000111" })).toBe(true);
    expect(store.markThreadStarted({ channel: "c123kodiai", threadTs: "1700000000.000111" })).toBe(false);
    expect(store.isThreadStarted({ channel: "C123KODIAI", threadTs: "1700000000.000111" })).toBe(true);
  });

  test("thread sessions are scoped by channel", () => {
    const store = createSlackThreadSessionStore();

    store.markThreadStarted({ channel: "C123KODIAI", threadTs: "1700000000.000111" });

    expect(store.isThreadStarted({ channel: "C999OTHER", threadTs: "1700000000.000111" })).toBe(false);
  });

  test("returns false for non-starter lookups", () => {
    const store = createSlackThreadSessionStore();

    expect(store.isThreadStarted({ channel: "C123KODIAI", threadTs: "1700000000.000999" })).toBe(false);
  });
});
