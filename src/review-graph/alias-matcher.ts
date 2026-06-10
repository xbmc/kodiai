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

export function findMatchingAlias(
  aliases: readonly string[],
  symbolAliases: Set<string>,
  substringIndex: Map<string, Set<string>>,
): string | undefined {
  for (const alias of aliases) {
    if (symbolAliases.has(alias)) return alias;

    if (alias.length < 3) {
      for (const candidate of symbolAliases) {
        if (alias.includes(candidate) || candidate.includes(alias)) {
          return alias;
        }
      }
      continue;
    }

    const candidates = new Set<string>();
    for (const gram of trigrams(alias)) {
      const bucket = substringIndex.get(gram);
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
