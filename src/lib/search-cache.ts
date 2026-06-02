const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SIZE = 500;
const DEFAULT_EXPIRED_CLEANUP_SCAN_LIMIT = 16;

export type SearchCacheKeyParams = {
  repo: string;
  searchType: string;
  query: string;
  extra?: Record<string, unknown>;
};

export type KeyValueStore<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  entries(): IterableIterator<[string, T]>;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export type SearchCacheOptions<T> = {
  ttlMs?: number;
  maxSize?: number;
  expiredCleanupScanLimit?: number;
  now?: () => number;
  store?: KeyValueStore<CacheEntry<T>>;
  inFlightStore?: KeyValueStore<Promise<T>>;
  onError?: (error: unknown) => void;
};

export type SearchCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T, ttlMs?: number): void;
  getOrLoad(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T>;
  purgeExpired(): number;
};

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item));
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b));
    const normalized: Record<string, unknown> = {};

    for (const key of keys) {
      normalized[key] = stableNormalize(objectValue[key]);
    }

    return normalized;
  }

  return value;
}

export function buildSearchCacheKey(params: SearchCacheKeyParams): string {
  const normalized = {
    repo: params.repo.trim().toLowerCase(),
    searchType: params.searchType.trim().toLowerCase(),
    query: normalizeQuery(params.query),
    extra: stableNormalize(params.extra ?? {}),
  };

  return JSON.stringify(normalized);
}

export function createSearchCache<T>(options: SearchCacheOptions<T> = {}): SearchCache<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxSize = Math.max(0, Math.floor(options.maxSize ?? DEFAULT_MAX_SIZE));
  const expiredCleanupScanLimit = Math.max(
    0,
    Math.floor(options.expiredCleanupScanLimit ?? DEFAULT_EXPIRED_CLEANUP_SCAN_LIMIT),
  );
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? new Map<string, CacheEntry<T>>();
  const inFlightStore = options.inFlightStore ?? new Map<string, Promise<T>>();
  let estimatedSize = 0;
  let expiredCleanupIterator: IterableIterator<[string, CacheEntry<T>]> | undefined;

  const reportCacheError = (error: unknown): void => {
    if (options.onError) {
      try {
        options.onError(error);
      } catch {
        // Ignore callback errors to preserve fail-open behavior.
      }
    }
  };

  const resetExpiredCleanupIterator = (): void => {
    expiredCleanupIterator = undefined;
  };

  const deleteStoreKey = (key: string): boolean => {
    try {
      store.delete(key);
      estimatedSize = Math.max(0, estimatedSize - 1);
      resetExpiredCleanupIterator();
      return true;
    } catch (error) {
      reportCacheError(error);
      return false;
    }
  };

  const entryIsExpired = (entry: CacheEntry<T>, currentTime: number): boolean => {
    return entry.expiresAt <= currentTime;
  };

  const estimateInitialSize = (): void => {
    try {
      let count = 0;
      for (const _entry of store.entries()) {
        count += 1;
      }
      estimatedSize = count;
    } catch (error) {
      reportCacheError(error);
      estimatedSize = 0;
    }
  };

  const cleanupExpiredAmortized = (): void => {
    if (expiredCleanupScanLimit <= 0) {
      return;
    }

    const currentTime = now();

    try {
      for (let scanned = 0; scanned < expiredCleanupScanLimit; scanned++) {
        expiredCleanupIterator ??= store.entries();
        const next = expiredCleanupIterator.next();

        if (next.done) {
          resetExpiredCleanupIterator();
          return;
        }

        const [key, entry] = next.value;
        if (entryIsExpired(entry, currentTime)) {
          deleteStoreKey(key);
        }
      }
    } catch (error) {
      reportCacheError(error);
      resetExpiredCleanupIterator();
    }
  };

  const enforceMaxSize = (): void => {
    if (estimatedSize <= maxSize) {
      return;
    }

    const currentTime = now();

    try {
      for (const [key, entry] of store.entries()) {
        if (entryIsExpired(entry, currentTime) || estimatedSize > maxSize) {
          deleteStoreKey(key);
        }

        if (estimatedSize <= maxSize) {
          return;
        }
      }
    } catch (error) {
      reportCacheError(error);
      resetExpiredCleanupIterator();
    }
  };

  estimateInitialSize();

  const get = (key: string): T | undefined => {
    try {
      const entry = store.get(key);
      if (!entry) {
        return undefined;
      }

      if (entry.expiresAt <= now()) {
        deleteStoreKey(key);
        return undefined;
      }

      return entry.value;
    } catch (error) {
      reportCacheError(error);
      return undefined;
    }
  };

  const set = (key: string, value: T, entryTtlMs?: number): void => {
    try {
      const existingEntry = store.get(key);
      store.set(key, {
        value,
        expiresAt: now() + (entryTtlMs ?? ttlMs),
      });
      if (!existingEntry) {
        estimatedSize += 1;
      }
      resetExpiredCleanupIterator();
      cleanupExpiredAmortized();
      enforceMaxSize();
    } catch (error) {
      reportCacheError(error);
    }
  };

  const getOrLoad = (
    key: string,
    loader: () => Promise<T>,
    entryTtlMs?: number,
  ): Promise<T> => {
    const cachedValue = get(key);
    if (cachedValue !== undefined) {
      return Promise.resolve(cachedValue);
    }

    try {
      const activeLoad = inFlightStore.get(key);
      if (activeLoad) {
        return activeLoad;
      }
    } catch (error) {
      reportCacheError(error);
    }

    const loadPromise = loader()
      .then((result) => {
        set(key, result, entryTtlMs);
        return result;
      })
      .finally(() => {
        try {
          inFlightStore.delete(key);
        } catch (error) {
          reportCacheError(error);
        }
      });

    try {
      inFlightStore.set(key, loadPromise);
    } catch (error) {
      reportCacheError(error);
    }

    return loadPromise;
  };

  const purgeExpired = (): number => {
    let purged = 0;
    let entries: IterableIterator<[string, CacheEntry<T>]>;

    try {
      entries = store.entries();
    } catch (error) {
      reportCacheError(error);
      return 0;
    }

    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now()) {
        if (deleteStoreKey(key)) {
          purged += 1;
        }
      }
    }

    return purged;
  };

  return {
    get,
    set,
    getOrLoad,
    purgeExpired,
  };
}
