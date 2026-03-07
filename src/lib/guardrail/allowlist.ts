// ---------------------------------------------------------------------------
// General Programming Knowledge Allowlist
// ---------------------------------------------------------------------------
// Claims matching these categories are common programming knowledge and
// should never be flagged as external-knowledge hallucinations.
// ---------------------------------------------------------------------------

export const GENERAL_PROGRAMMING_ALLOWLIST = {
  nullSafety: [
    "null pointer",
    "null reference",
    "null dereference",
    "undefined reference",
    "nullable",
    "null check",
    "null guard",
    "optional chaining",
    "nullish coalescing",
  ],
  injection: [
    "sql injection",
    "xss",
    "cross-site scripting",
    "command injection",
    "code injection",
    "injection attack",
    "injection vulnerability",
    "sanitize input",
    "escape input",
    "parameterized query",
  ],
  concurrency: [
    "race condition",
    "deadlock",
    "thread safety",
    "thread-safe",
    "mutex",
    "semaphore",
    "concurrent access",
    "atomic operation",
    "synchronization",
    "data race",
  ],
  resources: [
    "memory leak",
    "resource leak",
    "file descriptor",
    "connection leak",
    "connection pool",
    "garbage collection",
    "close resource",
    "dispose",
    "cleanup",
  ],
  bounds: [
    "buffer overflow",
    "out of bounds",
    "array index",
    "bounds check",
    "off-by-one",
    "integer overflow",
    "stack overflow",
    "heap overflow",
  ],
  errorHandling: [
    "error handling",
    "exception handling",
    "uncaught exception",
    "unhandled error",
    "try-catch",
    "error boundary",
    "fallback",
    "graceful degradation",
    "error recovery",
  ],
  typing: [
    "type safety",
    "type mismatch",
    "type cast",
    "type assertion",
    "type narrowing",
    "type guard",
    "implicit conversion",
    "coercion",
  ],
  codeSmells: [
    "code duplication",
    "dead code",
    "unreachable code",
    "unused variable",
    "unused import",
    "magic number",
    "hardcoded",
    "hard-coded",
    "god class",
    "long method",
    "cyclomatic complexity",
  ],
} as const;

/**
 * Check if a claim matches any general programming knowledge allowlist phrase.
 * Case-insensitive substring matching.
 */
export function isAllowlistedClaim(claim: string): boolean {
  if (!claim) return false;
  const lower = claim.toLowerCase();
  for (const phrases of Object.values(GENERAL_PROGRAMMING_ALLOWLIST)) {
    for (const phrase of phrases) {
      if (lower.includes(phrase)) return true;
    }
  }
  return false;
}
