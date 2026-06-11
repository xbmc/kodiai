export async function dedupeInflight<K, V>(
  inflight: Map<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
): Promise<V> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = load();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}
