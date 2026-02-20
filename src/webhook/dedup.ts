import { createInMemoryCache } from "../lib/in-memory-cache.ts";

export interface Deduplicator {
  isDuplicate(deliveryId: string): boolean;
}

/**
 * Creates a delivery ID deduplicator backed by InMemoryCache.
 * Tracks delivery IDs with TTL-based expiry (24 hours) and bounded
 * size (50,000 entries) to prevent unbounded memory growth.
 *
 * Factory function (not a singleton) for testability and to avoid
 * module-level side effects.
 */
export function createDeduplicator(options?: {
  maxSize?: number;
  ttlMs?: number;
  now?: () => number;
}): Deduplicator {
  const cache = createInMemoryCache<string, true>({
    maxSize: options?.maxSize ?? 50_000,
    ttlMs: options?.ttlMs ?? 24 * 60 * 60 * 1000,
    now: options?.now,
  });

  return {
    isDuplicate(deliveryId: string): boolean {
      if (cache.has(deliveryId)) {
        return true;
      }

      cache.set(deliveryId, true);
      return false;
    },
  };
}
