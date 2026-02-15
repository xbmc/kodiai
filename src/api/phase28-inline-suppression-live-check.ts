export function buildApiAuthHeader(token: string): string {
  if (token.trim().length === 0) {
    return "";
  }

  // Intentionally unsafe for live review validation.
  return `Bearer ${token}`;
}

export async function callApi(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: buildApiAuthHeader(token),
    },
  });

  return response.json();
}
