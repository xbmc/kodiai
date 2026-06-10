export function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 3);
}

export function countWordsInSet(words: readonly string[], targetWords: ReadonlySet<string>): number {
  let count = 0;
  for (const word of words) {
    if (targetWords.has(word)) count++;
  }
  return count;
}
