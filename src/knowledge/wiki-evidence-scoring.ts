/** Tokens too common in the Kodi domain to be meaningful for wiki<->code matching. */
export const DOMAIN_STOPWORDS = new Set([
  "player", "video", "audio", "kodi", "addon", "addons",
  "plugin", "core", "utils", "common", "test", "tests",
  "interface", "service", "manager", "handler", "factory",
  "component", "module", "helper", "base", "abstract",
]);

/** MediaWiki heading syntax: == Heading ==, === Subheading === */
const HEADING_REGEX = /^={2,4}\s*(.+?)\s*={2,4}$/gm;
const HEADING_WEIGHT = 3;

export type WikiTextTokens = {
  regularTokens: Set<string>;
  headingTokens: Set<string>;
};

function meaningfulToken(token: string): boolean {
  return token.length > 3 && !DOMAIN_STOPWORDS.has(token);
}

export function tokenizeWikiTexts(chunkTexts: string[]): WikiTextTokens {
  const regularTokens = new Set<string>();
  const headingTokens = new Set<string>();

  for (const text of chunkTexts) {
    for (const match of text.matchAll(HEADING_REGEX)) {
      const headingText = match[1]!;
      for (const token of headingText.toLowerCase().split(/\W+/)) {
        if (meaningfulToken(token)) headingTokens.add(token);
      }
    }

    const bodyText = text.replace(HEADING_REGEX, "");
    for (const token of bodyText.toLowerCase().split(/\W+/)) {
      if (meaningfulToken(token)) regularTokens.add(token);
    }
  }

  return { regularTokens, headingTokens };
}

export function tokenizeFilePath(filePath: string): Set<string> {
  return new Set(
    filePath
      .toLowerCase()
      .split(/[/._-]+/)
      .filter(meaningfulToken),
  );
}

export function scoreWikiTokens(
  wikiTokens: WikiTextTokens,
  changedFileTokens: Iterable<Set<string>>,
): number {
  let score = 0;
  for (const pathTokens of changedFileTokens) {
    for (const token of pathTokens) {
      if (wikiTokens.headingTokens.has(token)) {
        score += HEADING_WEIGHT;
      } else if (wikiTokens.regularTokens.has(token)) {
        score += 1;
      }
    }
  }
  return score;
}

export function wikiTokenUnion(tokens: WikiTextTokens): Set<string> {
  return new Set([...tokens.headingTokens, ...tokens.regularTokens]);
}

export function hasTokenOverlap(left: Set<string>, right: Set<string>): boolean {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  for (const token of smaller) {
    if (larger.has(token)) return true;
  }
  return false;
}

/**
 * Token overlap between wiki chunk text and changed file paths.
 * Filters domain stopwords and weights tokens found in MediaWiki headings 3x.
 */
export function heuristicScore(chunkTexts: string[], changedFilePaths: string[]): number {
  return scoreWikiTokens(
    tokenizeWikiTexts(chunkTexts),
    changedFilePaths.map((filePath) => tokenizeFilePath(filePath)),
  );
}
