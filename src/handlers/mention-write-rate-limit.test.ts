import { describe, expect, test } from "bun:test";
import type { WriteRateLimitStore } from "../lib/mention-state-stores.ts";
import { createMentionWriteRateLimitRuntime } from "./mention-write-rate-limit.ts";

function createMemoryStore(now: () => number): WriteRateLimitStore {
  const writes = new Map<string, number>();
  return {
    getLastWriteAt: (key) => writes.get(key),
    recordWrite: (key) => {
      writes.set(key, now());
    },
  };
}

describe("createMentionWriteRateLimitRuntime", () => {
  test("allows writes when disabled without recording cooldown timestamps", () => {
    let now = 1000;
    const store = createMemoryStore(() => now);
    const runtime = createMentionWriteRateLimitRuntime({
      store,
      installationId: 123,
      minIntervalSeconds: 0,
      now: () => now,
    });

    expect(runtime.check("xbmc", "kodiai")).toEqual({ allowed: true });

    runtime.recordSuccess("xbmc", "kodiai");
    now = 1500;

    expect(store.getLastWriteAt("123:xbmc/kodiai")).toBeUndefined();
    expect(runtime.check("xbmc", "kodiai")).toEqual({ allowed: true });
  });

  test("returns bounded retry seconds while the repo write cooldown is active", () => {
    let now = 1000;
    const store = createMemoryStore(() => now);
    const runtime = createMentionWriteRateLimitRuntime({
      store,
      installationId: 123,
      minIntervalSeconds: 60,
      now: () => now,
    });

    runtime.recordSuccess("xbmc", "kodiai");
    now = 30_001;

    expect(runtime.check("xbmc", "kodiai")).toEqual({
      allowed: false,
      retryInSeconds: 31,
    });

    now = 61_000;

    expect(runtime.check("xbmc", "kodiai")).toEqual({ allowed: true });
  });
});
