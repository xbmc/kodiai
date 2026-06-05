import {
  createRateLimitPair,
  requestSourceKey,
  type RateLimitPairDefaults,
  type RateLimiter,
  type RateLimitWindowOptions,
} from "../lib/sliding-window-rate-limiter.ts";

export { requestSourceKey };

export type RouteRateLimitOptions = {
  preBody?: RateLimitWindowOptions;
  verified?: RateLimitWindowOptions;
};

export type RouteRateLimiters = {
  preBody: RateLimiter;
  verified: RateLimiter;
};

export function createRouteRateLimiters(
  options: RouteRateLimitOptions | undefined,
  defaults: {
    preBody: Required<RateLimitWindowOptions>;
    verified: Required<RateLimitWindowOptions>;
  },
): RouteRateLimiters {
  const pair = createRateLimitPair({
    pre: options?.preBody,
    verified: options?.verified,
  }, {
    pre: defaults.preBody,
    verified: defaults.verified,
  } satisfies RateLimitPairDefaults);

  return {
    preBody: pair.pre,
    verified: pair.verified,
  };
}
