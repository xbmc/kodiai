/**
 * Shared MediaWiki API fetch helper.
 *
 * - Uses /api.php (kodi.wiki's actual path, not /w/api.php)
 * - Sends User-Agent: Kodiai/1.0 to pass Cloudflare WAF rules
 */

const WIKI_USER_AGENT = "Kodiai/1.0 (+https://github.com/xbmc/kodiai)";
const DEFAULT_WIKI_REQUEST_TIMEOUT_MS = 15_000;

/** Portable fetch signature that avoids Bun's extended `typeof fetch` (which adds `preconnect`). */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Build the full MediaWiki API URL for a given base URL and params.
 */
export function buildWikiApiUrl(
  baseUrl: string,
  params: URLSearchParams,
): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = pathname.endsWith("/api.php") ? pathname : `${pathname}/api.php`;

  const mergedParams = new URLSearchParams(url.search);
  for (const [key, value] of params.entries()) {
    mergedParams.set(key, value);
  }
  url.search = mergedParams.toString();

  return url.toString();
}

/**
 * Wrap a fetch function with the shared MediaWiki request policy.
 */
export function withWikiRequestPolicy(fetchFn: FetchFn): FetchFn {
  return (input, init?) =>
    fetchFn(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(DEFAULT_WIKI_REQUEST_TIMEOUT_MS),
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        "User-Agent": WIKI_USER_AGENT,
      },
    });
}
