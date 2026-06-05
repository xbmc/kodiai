export type RateLimitWindowOptions = {
  max?: number;
  windowMs?: number;
  maxKeys?: number;
};

export type RateLimiter = {
  isLimited(key: string): boolean;
};

export type RateLimitOptions<TWindow extends string> = Partial<Record<TWindow, RateLimitWindowOptions>>;

export type RateLimitDefaults<TWindow extends string> = Record<TWindow, Required<RateLimitWindowOptions>>;

export type RateLimiters<TWindow extends string> = Record<TWindow, RateLimiter>;

export type RateLimitPairOptions = {
  pre?: RateLimitWindowOptions;
  verified?: RateLimitWindowOptions;
};

export type RateLimitPairDefaults = {
  pre: Required<RateLimitWindowOptions>;
  verified: Required<RateLimitWindowOptions>;
};

export function createSlidingWindowRateLimiter(
  options: RateLimitWindowOptions | undefined,
  defaults: Required<RateLimitWindowOptions>,
): RateLimiter {
  const max = options?.max ?? defaults.max;
  const windowMs = options?.windowMs ?? defaults.windowMs;
  const maxKeys = options?.maxKeys ?? defaults.maxKeys;
  const timestampsByKey = new Map<string, number[]>();

  function pruneKeys(cutoff: number): void {
    if (timestampsByKey.size <= maxKeys) return;
    for (const [key, timestamps] of timestampsByKey) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1]! <= cutoff) {
        timestampsByKey.delete(key);
      }
      if (timestampsByKey.size <= maxKeys) return;
    }

    for (const key of timestampsByKey.keys()) {
      timestampsByKey.delete(key);
      if (timestampsByKey.size <= maxKeys) return;
    }
  }

  return {
    isLimited(key: string): boolean {
      const now = Date.now();
      const cutoff = now - windowMs;
      let timestamps = timestampsByKey.get(key);
      if (!timestamps) {
        timestamps = [];
        timestampsByKey.set(key, timestamps);
      }

      const validStart = timestamps.findIndex((timestamp) => timestamp > cutoff);
      if (validStart > 0) {
        timestamps.splice(0, validStart);
      } else if (validStart === -1) {
        timestamps.length = 0;
      }

      if (timestamps.length >= max) {
        pruneKeys(cutoff);
        return true;
      }

      timestamps.push(now);
      pruneKeys(cutoff);
      return false;
    },
  };
}

export function createRateLimitPair(
  options: RateLimitPairOptions | undefined,
  defaults: RateLimitPairDefaults,
): { pre: RateLimiter; verified: RateLimiter } {
  return {
    pre: createSlidingWindowRateLimiter(options?.pre, defaults.pre),
    verified: createSlidingWindowRateLimiter(options?.verified, defaults.verified),
  };
}

export function createNamedRateLimiters<TWindow extends string>(
  options: RateLimitOptions<TWindow> | undefined,
  defaults: RateLimitDefaults<TWindow>,
): RateLimiters<TWindow> {
  const limiters: Partial<Record<TWindow, RateLimiter>> = {};
  for (const key of Object.keys(defaults) as TWindow[]) {
    limiters[key] = createSlidingWindowRateLimiter(options?.[key], defaults[key]);
  }
  return limiters as RateLimiters<TWindow>;
}

export function requestSourceKey(header: (name: string) => string | undefined): string {
  const forwardedFor = header("x-forwarded-for")?.split(",")[0]?.trim();
  return header("cf-connecting-ip") ?? header("x-real-ip") ?? forwardedFor ?? "unknown";
}
