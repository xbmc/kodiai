/** Simple whitespace-based token count approximation. */
export function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
