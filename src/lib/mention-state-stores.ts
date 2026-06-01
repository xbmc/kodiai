import { createInMemoryCache } from "./in-memory-cache.ts";

type MentionStateStoreOptions = {
  maxSize?: number;
  ttlMs?: number;
  now?: () => number;
};

const MENTION_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WRITE_RATE_LIMIT_MAX_SIZE = 10_000;
const DEFAULT_CONVERSATION_TURN_MAX_SIZE = 10_000;
const DEFAULT_TRIAGE_COOLDOWN_MAX_SIZE = 1_000;

export type TriageCooldownEntry = {
  lastTriagedAt: number;
  bodyHash: string;
};

export type WriteRateLimitStore = {
  getLastWriteAt(key: string): number | undefined;
  recordWrite(key: string): void;
};

export type ConversationTurnStore = {
  getTurns(key: string): number;
  recordSuccessfulTurn(key: string): number;
};

export type TriageCooldownStore = {
  get(key: string): TriageCooldownEntry | undefined;
  set(key: string, entry: TriageCooldownEntry): void;
};

export function createWriteRateLimitStore(options: MentionStateStoreOptions = {}): WriteRateLimitStore {
  const cache = createInMemoryCache<string, number>({
    maxSize: options.maxSize ?? DEFAULT_WRITE_RATE_LIMIT_MAX_SIZE,
    ttlMs: options.ttlMs ?? MENTION_STATE_TTL_MS,
    now: options.now,
  });
  const now = options.now ?? Date.now;

  return {
    getLastWriteAt(key) {
      return cache.get(key);
    },
    recordWrite(key) {
      cache.set(key, now());
    },
  };
}

export function createConversationTurnStore(options: MentionStateStoreOptions = {}): ConversationTurnStore {
  const cache = createInMemoryCache<string, number>({
    maxSize: options.maxSize ?? DEFAULT_CONVERSATION_TURN_MAX_SIZE,
    ttlMs: options.ttlMs ?? MENTION_STATE_TTL_MS,
    now: options.now,
  });

  return {
    getTurns(key) {
      return cache.get(key) ?? 0;
    },
    recordSuccessfulTurn(key) {
      const nextTurns = (cache.get(key) ?? 0) + 1;
      cache.set(key, nextTurns);
      return nextTurns;
    },
  };
}

export function createTriageCooldownStore(options: MentionStateStoreOptions = {}): TriageCooldownStore {
  const cache = createInMemoryCache<string, TriageCooldownEntry>({
    maxSize: options.maxSize ?? DEFAULT_TRIAGE_COOLDOWN_MAX_SIZE,
    ttlMs: options.ttlMs ?? MENTION_STATE_TTL_MS,
    now: options.now,
  });

  return {
    get(key) {
      return cache.get(key);
    },
    set(key, entry) {
      cache.set(key, entry);
    },
  };
}
