/**
 * Shared MediaWiki API fetch helper.
 *
 * - Uses /api.php (kodi.wiki's actual path, not /w/api.php)
 * - Sends User-Agent: Kodiai/1.0 to pass Cloudflare WAF rules
 */

const WIKI_USER_AGENT = "Kodiai/1.0 (+https://github.com/xbmc/kodiai)";
const DEFAULT_WIKI_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_WIKI_RETRY_ATTEMPTS = 3;
const DEFAULT_WIKI_RETRY_DELAY_MS = 1_000;

/** Portable fetch signature that avoids Bun's extended `typeof fetch` (which adds `preconnect`). */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type WikiRetryLogger = {
  warn?: (obj: Record<string, unknown>, msg: string) => void;
  debug?: (obj: Record<string, unknown>, msg: string) => void;
};

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }
  return Math.min(DEFAULT_WIKI_RETRY_DELAY_MS * 2 ** attempt, 10_000);
}

function isRetryableWikiStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchWikiJsonWithRetry<T>(opts: {
  fetchFn: FetchFn;
  url: string;
  logger: WikiRetryLogger;
  context?: Record<string, unknown>;
  attempts?: number;
}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_WIKI_RETRY_ATTEMPTS);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await opts.fetchFn(opts.url);
      if (!response.ok) {
        lastError = new Error(`MediaWiki request failed with status ${response.status}`);
        if (!isRetryableWikiStatus(response.status) || attempt === attempts - 1) {
          throw lastError;
        }
        opts.logger.warn?.(
          { ...(opts.context ?? {}), status: response.status, attempt: attempt + 1 },
          "MediaWiki request failed, retrying",
        );
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      return await response.json() as T;
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1) break;
      opts.logger.warn?.(
        { ...(opts.context ?? {}), err, attempt: attempt + 1 },
        "MediaWiki request threw, retrying",
      );
      await sleep(DEFAULT_WIKI_RETRY_DELAY_MS * 2 ** attempt);
    }
  }

  throw lastError;
}
