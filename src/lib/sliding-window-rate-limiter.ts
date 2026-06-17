import { positiveIntegerBound } from "./bounds.ts";

export type RateLimitWindowOptions = {
  max?: number;
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
};

export type RateLimiter = {
  isLimited(key: string): boolean;
};

export type RateLimitOptions<TWindow extends string> = Partial<Record<TWindow, RateLimitWindowOptions>>;

export type RateLimitWindowDefaults = Required<Omit<RateLimitWindowOptions, "now">>;

export type RateLimitDefaults<TWindow extends string> = Record<TWindow, RateLimitWindowDefaults>;

export type RateLimiters<TWindow extends string> = Record<TWindow, RateLimiter>;

export type RateLimitPairOptions = {
  pre?: RateLimitWindowOptions;
  verified?: RateLimitWindowOptions;
};

export type RateLimitPairDefaults = {
  pre: RateLimitWindowDefaults;
  verified: RateLimitWindowDefaults;
};

type WindowState = {
  timestamps: number[];
  head: number;
};

const OVERFLOW_KEY = "__overflow__";
const COMPACT_AFTER = 64;

function pruneState(state: WindowState, cutoff: number): number {
  while (state.head < state.timestamps.length && state.timestamps[state.head]! <= cutoff) {
    state.head++;
  }
  if (state.head > COMPACT_AFTER && state.head * 2 > state.timestamps.length) {
    state.timestamps = state.timestamps.slice(state.head);
    state.head = 0;
  }
  return state.timestamps.length - state.head;
}

export function createSlidingWindowRateLimiter(
  options: RateLimitWindowOptions | undefined,
  defaults: RateLimitWindowDefaults,
): RateLimiter {
  const max = positiveIntegerBound(options?.max, defaults.max);
  const windowMs = positiveIntegerBound(options?.windowMs, defaults.windowMs);
  const maxKeys = positiveIntegerBound(options?.maxKeys, defaults.maxKeys);
  const nowFn = options?.now ?? Date.now;
  const timestampsByKey = new Map<string, WindowState>();

  function pruneKeys(cutoff: number): void {
    for (const [key, timestamps] of timestampsByKey) {
      if (pruneState(timestamps, cutoff) === 0) {
        timestampsByKey.delete(key);
      }
    }
  }

  return {
    isLimited(key: string): boolean {
      const now = nowFn();
      const cutoff = now - windowMs;
      pruneKeys(cutoff);
      const effectiveKey = timestampsByKey.has(key) || timestampsByKey.size < maxKeys
        ? key
        : OVERFLOW_KEY;
      let timestamps = timestampsByKey.get(effectiveKey);
      if (!timestamps) {
        timestamps = { timestamps: [], head: 0 };
        timestampsByKey.set(effectiveKey, timestamps);
      }

      const count = pruneState(timestamps, cutoff);

      if (count >= max) {
        return true;
      }

      timestamps.timestamps.push(now);
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

export function requestSourceKey(
  header: (name: string) => string | undefined,
  options: { trustProxyHeaders?: boolean } = {},
): string {
  if (!options.trustProxyHeaders && process.env["KODIAI_TRUST_PROXY_HEADERS"] !== "true") {
    return "unknown";
  }
  const forwardedFor = header("x-forwarded-for")?.split(",")[0]?.trim();
  return header("cf-connecting-ip") ?? header("x-real-ip") ?? forwardedFor ?? "unknown";
}
