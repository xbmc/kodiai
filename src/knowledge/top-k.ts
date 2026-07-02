export function takeTopByScore<T>(
  items: Iterable<T>,
  topK: number | undefined,
  getScore: (item: T) => number,
): T[] {
  if (topK === undefined) {
    return Array.from(items).sort((a, b) => getScore(b) - getScore(a));
  }
  if (topK <= 0) return [];

  const top: T[] = [];
  for (const item of items) {
    const score = getScore(item);
    let index = top.length;
    while (index > 0 && getScore(top[index - 1]!) < score) {
      index--;
    }
    if (index >= topK) continue;
    top.splice(index, 0, item);
    if (top.length > topK) {
      top.pop();
    }
  }
  return top;
}
