import {
  createRateLimitPair,
  createSlidingWindowRateLimiter,
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

export type RouteRateLimitOptionsWith<TWindow extends string> = RouteRateLimitOptions
  & Partial<Record<TWindow, RateLimitWindowOptions>>;

export type RouteRateLimiters<TWindow extends string = never> = {
  preBody: RateLimiter;
  verified: RateLimiter;
} & Record<TWindow, RateLimiter>;

export function createRouteRateLimiters<TWindow extends string = never>(
  options: RouteRateLimitOptionsWith<TWindow> | undefined,
  defaults: {
    preBody: Required<RateLimitWindowOptions>;
    verified: Required<RateLimitWindowOptions>;
  } & Record<TWindow, Required<RateLimitWindowOptions>>,
): RouteRateLimiters<TWindow> {
  const pair = createRateLimitPair({
    pre: options?.preBody,
    verified: options?.verified,
  }, {
    pre: defaults.preBody,
    verified: defaults.verified,
  } satisfies RateLimitPairDefaults);

  const namedLimiters: Partial<Record<TWindow, RateLimiter>> = {};

  for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
    if (key === "preBody" || key === "verified") continue;
    const windowKey = key as TWindow;
    namedLimiters[windowKey] = createSlidingWindowRateLimiter(
      options?.[windowKey],
      defaults[windowKey],
    );
  }

  return {
    preBody: pair.pre,
    verified: pair.verified,
    ...namedLimiters,
  } as RouteRateLimiters<TWindow>;
}
