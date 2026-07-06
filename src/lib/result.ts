export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; err: E };

export function ok<T, E = Error>(value: T): Result<T, E> {
  return { ok: true, value };
}

export function err<E extends Error>(error: E): Result<never, E> {
  return { ok: false, err: error };
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
