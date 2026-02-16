const DEFAULT_TTL_MS = 10 * 60 * 1000;

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
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? new Map<string, CacheEntry<T>>();
  const inFlightStore = options.inFlightStore ?? new Map<string, Promise<T>>();

  const reportCacheError = (error: unknown): void => {
    if (options.onError) {
      try {
        options.onError(error);
      } catch {
        // Ignore callback errors to preserve fail-open behavior.
      }
    }
  };

  const get = (key: string): T | undefined => {
    try {
      const entry = store.get(key);
      if (!entry) {
        return undefined;
      }

      if (entry.expiresAt <= now()) {
        try {
          store.delete(key);
        } catch (error) {
          reportCacheError(error);
        }
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
      store.set(key, {
        value,
        expiresAt: now() + (entryTtlMs ?? ttlMs),
      });
    } catch (error) {
      reportCacheError(error);
    }
  };

  const getOrLoad = async (
    key: string,
    loader: () => Promise<T>,
    entryTtlMs?: number,
  ): Promise<T> => {
    const cachedValue = get(key);
    if (cachedValue !== undefined) {
      return cachedValue;
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
        try {
          store.delete(key);
          purged += 1;
        } catch (error) {
          reportCacheError(error);
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
