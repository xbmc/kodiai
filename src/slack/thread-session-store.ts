import { createInMemoryCache } from "../lib/in-memory-cache.ts";

export interface SlackThreadSessionKeyInput {
  channel: string;
  threadTs: string;
}

export interface SlackThreadSessionStore {
  markThreadStarted(input: SlackThreadSessionKeyInput): boolean;
  isThreadStarted(input: SlackThreadSessionKeyInput): boolean;
}

function normalizeThreadSessionKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

function buildThreadSessionKey(input: SlackThreadSessionKeyInput): string {
  const channel = normalizeThreadSessionKeyPart(input.channel);
  const threadTs = normalizeThreadSessionKeyPart(input.threadTs);
  return `${channel}::${threadTs}`;
}

export function createSlackThreadSessionStore(options?: {
  maxSize?: number;
  ttlMs?: number;
}): SlackThreadSessionStore {
  const cache = createInMemoryCache<string, true>({
    maxSize: options?.maxSize ?? 10_000,
    ttlMs: options?.ttlMs ?? 24 * 60 * 60 * 1000,
  });

  return {
    markThreadStarted(input) {
      const sessionKey = buildThreadSessionKey(input);
      const existed = cache.has(sessionKey);
      cache.set(sessionKey, true);
      return !existed;
    },
    isThreadStarted(input) {
      return cache.has(buildThreadSessionKey(input));
    },
  };
}
