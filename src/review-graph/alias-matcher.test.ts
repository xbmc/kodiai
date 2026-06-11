import { describe, expect, test } from "bun:test";
import { buildAliasMatcher, findMatchingAlias } from "./alias-matcher.ts";

describe("alias matcher", () => {
  test("matches exact aliases", () => {
    const matcher = buildAliasMatcher(new Set(["rendertexture"]));

    expect(findMatchingAlias(["rendertexture"], matcher)).toBe("rendertexture");
  });

  test("matches substring aliases through the trigram index", () => {
    const matcher = buildAliasMatcher(new Set(["rendertexturemanager"]));

    expect(findMatchingAlias(["texturemanager"], matcher)).toBe("texturemanager");
  });

  test("handles aliases shorter than the trigram width", () => {
    const matcher = buildAliasMatcher(new Set(["gui"]));

    expect(findMatchingAlias(["ui"], matcher)).toBe("ui");
  });

  test("matches short symbol aliases from the matcher side bucket", () => {
    const matcher = buildAliasMatcher(new Set(["ui"]));

    expect(matcher.shortAliases).toEqual(["ui"]);
    expect(findMatchingAlias(["guimanager"], matcher)).toBe("guimanager");
  });

  test("does not match unrelated aliases", () => {
    const matcher = buildAliasMatcher(new Set(["database"]));

    expect(findMatchingAlias(["renderer"], matcher)).toBeUndefined();
  });
});
