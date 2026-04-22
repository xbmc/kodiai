import { describe, expect, test } from "bun:test";
import { buildWikiApiUrl, withWikiHeaders, type FetchFn } from "./wiki-fetch.ts";

describe("buildWikiApiUrl", () => {
  test("uses the /api.php path with serialized params", () => {
    const params = new URLSearchParams({ action: "query", format: "json" });

    expect(buildWikiApiUrl("https://kodi.wiki", params)).toBe(
      "https://kodi.wiki/api.php?action=query&format=json",
    );
  });

  test("appends /api.php to the pathname and preserves existing query params", () => {
    const params = new URLSearchParams({ action: "parse", page: "Foo Bar" });

    expect(buildWikiApiUrl("https://kodi.wiki?foo=bar", params)).toBe(
      "https://kodi.wiki/api.php?foo=bar&action=parse&page=Foo+Bar",
    );
  });
});

describe("withWikiHeaders", () => {
  test("adds the Kodiai user agent when headers are omitted", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetchFn: FetchFn = async (input, init) => {
      calls.push({ input, init });
      return new Response(null, { status: 204 });
    };

    const wrapped = withWikiHeaders(fetchFn);
    await wrapped("https://kodi.wiki/api.php?action=query");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.headers).toEqual({
      "User-Agent": "Kodiai/1.0 (+https://github.com/xbmc/kodiai)",
    });
  });

  test("preserves existing headers and overrides any preexisting user agent", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetchFn: FetchFn = async (input, init) => {
      calls.push({ input, init });
      return new Response("ok");
    };

    const wrapped = withWikiHeaders(fetchFn);
    await wrapped("https://kodi.wiki/api.php", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "User-Agent": "OldAgent/0.1",
      },
    });

    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({
      Accept: "application/json",
      "User-Agent": "Kodiai/1.0 (+https://github.com/xbmc/kodiai)",
    });
  });
});
