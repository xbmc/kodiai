import { createInMemoryCache } from "../lib/in-memory-cache.ts";
import type { StructuralImpactPayload } from "./types.ts";

export type StructuralImpactCache = {
  get(key: string): StructuralImpactPayload | undefined;
  set(key: string, value: StructuralImpactPayload): void;
};

export type StructuralImpactCacheOptions = {
  maxSize?: number;
  ttlMs?: number;
  now?: () => number;
};

const DEFAULT_MAX_SIZE = 256;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function createStructuralImpactCache(
  options: StructuralImpactCacheOptions = {},
): StructuralImpactCache {
  const cache = createInMemoryCache<string, StructuralImpactPayload>({
    maxSize: options.maxSize ?? DEFAULT_MAX_SIZE,
    ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    now: options.now,
  });

  return {
    get(key: string) {
      return cache.get(key);
    },
    set(key: string, value: StructuralImpactPayload) {
      cache.set(key, value);
    },
  };
}

export function buildStructuralImpactCacheKey(params: {
  repo: string;
  baseSha: string;
  headSha: string;
}): string {
  return `structural-impact:${params.repo.toLowerCase()}:${params.baseSha}:${params.headSha}`;
}
