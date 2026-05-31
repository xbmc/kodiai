import { describe, expect, test } from "bun:test";
import { resolveAuthorTierFromSources } from "./review-author-tier.ts";

describe("resolveAuthorTierFromSources", () => {
  test("prefers contributor profile over cache and fallback", () => {
    expect(resolveAuthorTierFromSources({
      contributorTier: "senior",
      cachedTier: "core",
      fallbackTier: "newcomer",
    })).toEqual({ tier: "senior", source: "contributor-profile" });

    expect(resolveAuthorTierFromSources({
      cachedTier: "regular",
      fallbackTier: "newcomer",
    })).toEqual({ tier: "regular", source: "author-cache" });

    expect(resolveAuthorTierFromSources({
      fallbackTier: "developing",
    })).toEqual({ tier: "developing", source: "fallback" });
  });
});
