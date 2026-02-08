const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface Deduplicator {
  isDuplicate(deliveryId: string): boolean;
}

/**
 * Creates a delivery ID deduplicator backed by a Map.
 * Tracks delivery IDs with timestamps, evicts entries older than 24 hours
 * every 1000 inserts to bound memory usage.
 *
 * Factory function (not a singleton) for testability and to avoid
 * module-level side effects.
 */
export function createDeduplicator(): Deduplicator {
  const seen = new Map<string, number>();
  let insertCount = 0;

  return {
    isDuplicate(deliveryId: string): boolean {
      if (seen.has(deliveryId)) {
        return true;
      }

      seen.set(deliveryId, Date.now());
      insertCount++;

      // Periodic cleanup every 1000 inserts
      if (insertCount % 1000 === 0) {
        const cutoff = Date.now() - MAX_AGE_MS;
        for (const [id, ts] of seen) {
          if (ts < cutoff) {
            seen.delete(id);
          }
        }
      }

      return false;
    },
  };
}
