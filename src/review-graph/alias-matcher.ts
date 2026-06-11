function trigrams(value: string): Set<string> {
  if (value.length < 3) return new Set([value]);
  const result = new Set<string>();
  for (let index = 0; index <= value.length - 3; index++) {
    result.add(value.slice(index, index + 3));
  }
  return result;
}

export function buildAliasSubstringIndex(aliases: Iterable<string>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const alias of aliases) {
    for (const gram of trigrams(alias)) {
      const bucket = index.get(gram) ?? new Set<string>();
      bucket.add(alias);
      index.set(gram, bucket);
    }
  }
  return index;
}

export type AliasMatcher = {
  aliases: ReadonlySet<string>;
  substringIndex: ReadonlyMap<string, ReadonlySet<string>>;
  shortAliases: readonly string[];
};

export function buildAliasMatcher(aliases: Iterable<string>): AliasMatcher {
  const aliasSet = new Set(aliases);
  return {
    aliases: aliasSet,
    substringIndex: buildAliasSubstringIndex(aliasSet),
    shortAliases: [...aliasSet].filter((alias) => alias.length < 3),
  };
}

export function findMatchingAlias(
  aliases: readonly string[],
  matcher: AliasMatcher,
): string | undefined {
  for (const alias of aliases) {
    if (matcher.aliases.has(alias)) return alias;

    if (alias.length < 3) {
      for (const candidate of matcher.aliases) {
        if (alias.includes(candidate) || candidate.includes(alias)) {
          return alias;
        }
      }
      continue;
    }

    for (const candidate of matcher.shortAliases) {
      if (alias.includes(candidate)) {
        return alias;
      }
    }

    const candidates = new Set<string>();
    for (const gram of trigrams(alias)) {
      const bucket = matcher.substringIndex.get(gram);
      if (bucket) {
        for (const candidate of bucket) candidates.add(candidate);
      }
    }
    for (const candidate of candidates) {
      if (alias.includes(candidate) || candidate.includes(alias)) {
        return alias;
      }
    }
  }
  return undefined;
}
