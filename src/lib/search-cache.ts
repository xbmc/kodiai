import { positiveIntegerBound } from "./bounds.ts";
import { createInMemoryCache } from "./in-memory-cache.ts";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SIZE = 500;

export type SearchCacheKeyParams = {
  repo: string;
  searchType: string;
  query: string;
  extra?: Record<string, unknown>;
};

export type SearchCacheOptions<T> = {
  ttlMs?: number;
  maxSize?: number;
  now?: () => number;
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
  const maxSize = positiveIntegerBound(options.maxSize, DEFAULT_MAX_SIZE);
  const store = createInMemoryCache<string, T>({
    maxSize,
    ttlMs,
    now: options.now,
  });
  const inFlightStore = new Map<string, Promise<T>>();

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
      return store.get(key);
    } catch (error) {
      reportCacheError(error);
      return undefined;
    }
  };

  const set = (key: string, value: T, entryTtlMs?: number): void => {
    try {
      store.set(key, value, entryTtlMs);
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
    try {
      return store.purgeExpired();
    } catch (error) {
      reportCacheError(error);
      return 0;
    }
  };

  return {
    get,
    set,
    getOrLoad,
    purgeExpired,
  };
}
