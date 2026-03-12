/**
 * Shared MediaWiki API fetch helper.
 *
 * - Uses /api.php (kodi.wiki's actual path, not /w/api.php)
 * - Sends User-Agent: Kodiai/1.0 to pass Cloudflare WAF rules
 */

const WIKI_USER_AGENT = "Kodiai/1.0 (+https://github.com/xbmc/kodiai)";

/** Portable fetch signature that avoids Bun's extended `typeof fetch` (which adds `preconnect`). */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Build the full MediaWiki API URL for a given base URL and params.
 */
export function buildWikiApiUrl(
  baseUrl: string,
  params: URLSearchParams,
): string {
  return `${baseUrl}/api.php?${params.toString()}`;
}

/**
 * Wrap a fetch function to include the Kodiai User-Agent header.
 */
export function withWikiHeaders(fetchFn: FetchFn): FetchFn {
  return (input, init?) =>
    fetchFn(input, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        "User-Agent": WIKI_USER_AGENT,
      },
    });
}
