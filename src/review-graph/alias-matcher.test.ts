import { describe, expect, test } from "bun:test";
import { buildAliasSubstringIndex, findMatchingAlias } from "./alias-matcher.ts";

describe("alias matcher", () => {
  test("matches exact aliases", () => {
    const symbolAliases = new Set(["rendertexture"]);
    const index = buildAliasSubstringIndex(symbolAliases);

    expect(findMatchingAlias(["rendertexture"], symbolAliases, index)).toBe("rendertexture");
  });

  test("matches substring aliases through the trigram index", () => {
    const symbolAliases = new Set(["rendertexturemanager"]);
    const index = buildAliasSubstringIndex(symbolAliases);

    expect(findMatchingAlias(["texturemanager"], symbolAliases, index)).toBe("texturemanager");
  });

  test("handles aliases shorter than the trigram width", () => {
    const symbolAliases = new Set(["gui"]);
    const index = buildAliasSubstringIndex(symbolAliases);

    expect(findMatchingAlias(["ui"], symbolAliases, index)).toBe("ui");
  });

  test("does not match unrelated aliases", () => {
    const symbolAliases = new Set(["database"]);
    const index = buildAliasSubstringIndex(symbolAliases);

    expect(findMatchingAlias(["renderer"], symbolAliases, index)).toBeUndefined();
  });
});
