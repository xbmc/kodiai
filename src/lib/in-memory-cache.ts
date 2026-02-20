export interface InMemoryCacheOptions {
  maxSize: number;
  ttlMs: number;
  now?: () => number;
}

export interface InMemoryCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  size(): number;
  clear(): void;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export function createInMemoryCache<K, V>(options: InMemoryCacheOptions): InMemoryCache<K, V> {
  const { maxSize, ttlMs } = options;
  const clock = options.now ?? Date.now;
  const store = new Map<K, CacheEntry<V>>();

  function isExpired(entry: CacheEntry<V>): boolean {
    return clock() >= entry.expiresAt;
  }

  function evictExpired(): void {
    for (const [key, entry] of store) {
      if (isExpired(entry)) {
        store.delete(key);
      }
    }
  }

  function evictOldest(count: number): void {
    let removed = 0;
    for (const key of store.keys()) {
      if (removed >= count) break;
      store.delete(key);
      removed++;
    }
  }

  return {
    get(key: K): V | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (isExpired(entry)) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },

    set(key: K, value: V): void {
      // Delete existing entry first so re-insertion moves it to end of Map iteration order
      store.delete(key);

      // Evict expired entries first
      evictExpired();

      // If still at or over maxSize, evict oldest non-expired entries
      if (store.size >= maxSize) {
        const excess = store.size - maxSize + 1;
        evictOldest(excess);
      }

      store.set(key, { value, expiresAt: clock() + ttlMs });
    },

    has(key: K): boolean {
      const entry = store.get(key);
      if (!entry) return false;
      if (isExpired(entry)) {
        store.delete(key);
        return false;
      }
      return true;
    },

    delete(key: K): boolean {
      return store.delete(key);
    },

    size(): number {
      // Only count non-expired entries
      let count = 0;
      for (const [key, entry] of store) {
        if (isExpired(entry)) {
          store.delete(key);
        } else {
          count++;
        }
      }
      return count;
    },

    clear(): void {
      store.clear();
    },
  };
}
