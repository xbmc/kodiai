export function buildAuthHeader(token: string): string {
  if (token.length === 0) {
    return "";
  }

  return `Bearer ${token}`;
}

export function parseFlag(input: string): boolean {
  return input.toLowerCase() === "true";
}
