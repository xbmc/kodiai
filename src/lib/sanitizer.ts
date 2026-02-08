/**
 * Content sanitization pipeline and TOCTOU comment filter.
 *
 * Ported from the battle-tested reference implementation in
 * claude-code-action. Provides security primitives for stripping
 * prompt injection vectors from user-generated content before
 * it reaches the LLM.
 *
 * Pipeline order matters -- HTML comments must be stripped before
 * entity normalization, otherwise partially encoded comments survive.
 */

// --- Sanitization Functions ---

/**
 * Strip HTML comments from content.
 * Prevents hidden instructions embedded in <!-- ... --> blocks.
 */
export const stripHtmlComments = (content: string): string =>
  content.replace(/<!--[\s\S]*?-->/g, "");

/**
 * Strip invisible Unicode characters that can hide content from humans
 * but are visible to the LLM.
 *
 * Covers 4 categories:
 * 1. Zero-width chars: ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D), BOM (FEFF)
 * 2. Control chars: U+0000-U+0008, U+000B, U+000C, U+000E-U+001F, U+007F-U+009F
 *    (preserves tab U+0009, newline U+000A, carriage return U+000D)
 * 3. Soft hyphens: U+00AD
 * 4. Bidi overrides and isolates: U+202A-U+202E, U+2066-U+2069
 */
export function stripInvisibleCharacters(content: string): string {
  content = content.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
  content = content.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    "",
  );
  content = content.replace(/\u00AD/g, "");
  content = content.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
  return content;
}

/**
 * Strip hidden text from markdown image alt text.
 * Attackers can embed instructions in ![hidden text](url) that humans
 * may not see but the LLM reads.
 */
export function stripMarkdownImageAltText(content: string): string {
  return content.replace(/!\[[^\]]*\]\(/g, "![](");
}

/**
 * Strip title attributes from markdown links.
 * Both double-quoted and single-quoted title attributes are removed:
 *   [text](url "hidden title") -> [text](url)
 *   [text](url 'hidden title') -> [text](url)
 */
export function stripMarkdownLinkTitles(content: string): string {
  content = content.replace(/(\[[^\]]*\]\([^)]+)\s+"[^"]*"/g, "$1");
  content = content.replace(/(\[[^\]]*\]\([^)]+)\s+'[^']*'/g, "$1");
  return content;
}

/**
 * Strip hidden HTML attributes that can carry invisible instructions.
 * Targets: alt, title, aria-label, data-*, placeholder
 * Handles both quoted and unquoted attribute values.
 */
export function stripHiddenAttributes(content: string): string {
  content = content.replace(/\salt\s*=\s*["'][^"']*["']/gi, "");
  content = content.replace(/\salt\s*=\s*[^\s>]+/gi, "");
  content = content.replace(/\stitle\s*=\s*["'][^"']*["']/gi, "");
  content = content.replace(/\stitle\s*=\s*[^\s>]+/gi, "");
  content = content.replace(/\saria-label\s*=\s*["'][^"']*["']/gi, "");
  content = content.replace(/\saria-label\s*=\s*[^\s>]+/gi, "");
  content = content.replace(/\sdata-[a-zA-Z0-9-]+\s*=\s*["'][^"']*["']/gi, "");
  content = content.replace(/\sdata-[a-zA-Z0-9-]+\s*=\s*[^\s>]+/gi, "");
  content = content.replace(/\splaceholder\s*=\s*["'][^"']*["']/gi, "");
  content = content.replace(/\splaceholder\s*=\s*[^\s>]+/gi, "");
  return content;
}

/**
 * Normalize HTML entities.
 * - Decimal entities (&#NNN;): decode if printable ASCII (32-126), remove otherwise
 * - Hex entities (&#xHH;): decode if printable ASCII (32-126), remove otherwise
 */
export function normalizeHtmlEntities(content: string): string {
  content = content.replace(/&#(\d+);/g, (_, dec) => {
    const num = parseInt(dec, 10);
    if (num >= 32 && num <= 126) {
      return String.fromCharCode(num);
    }
    return "";
  });
  content = content.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const num = parseInt(hex, 16);
    if (num >= 32 && num <= 126) {
      return String.fromCharCode(num);
    }
    return "";
  });
  return content;
}

/**
 * Redact GitHub tokens to prevent credential leakage through the LLM.
 *
 * Patterns:
 * - ghp_: Personal Access Tokens (classic) - 36 alphanum chars
 * - gho_: OAuth tokens - 36 alphanum chars
 * - ghs_: Installation tokens - 36 alphanum chars
 * - ghr_: Refresh tokens - 36 alphanum chars
 * - github_pat_: Fine-grained PATs - 11-221 alphanum/underscore chars
 */
export function redactGitHubTokens(content: string): string {
  content = content.replace(
    /\bghp_[A-Za-z0-9]{36}\b/g,
    "[REDACTED_GITHUB_TOKEN]",
  );
  content = content.replace(
    /\bgho_[A-Za-z0-9]{36}\b/g,
    "[REDACTED_GITHUB_TOKEN]",
  );
  content = content.replace(
    /\bghs_[A-Za-z0-9]{36}\b/g,
    "[REDACTED_GITHUB_TOKEN]",
  );
  content = content.replace(
    /\bghr_[A-Za-z0-9]{36}\b/g,
    "[REDACTED_GITHUB_TOKEN]",
  );
  content = content.replace(
    /\bgithub_pat_[A-Za-z0-9_]{11,221}\b/g,
    "[REDACTED_GITHUB_TOKEN]",
  );
  return content;
}

/**
 * Full sanitization pipeline. Chains all 7 sanitization steps in order.
 *
 * Order matters:
 * 1. HTML comments first (before entity decoding could reconstruct them)
 * 2. Invisible chars (before they can hide in decoded entities)
 * 3. Markdown image alt text
 * 4. Markdown link titles
 * 5. Hidden HTML attributes
 * 6. HTML entities near last (decodes printable, strips non-printable)
 * 7. Token redaction last (operates on final cleaned text)
 */
export function sanitizeContent(content: string): string {
  content = stripHtmlComments(content);
  content = stripInvisibleCharacters(content);
  content = stripMarkdownImageAltText(content);
  content = stripMarkdownLinkTitles(content);
  content = stripHiddenAttributes(content);
  content = normalizeHtmlEntities(content);
  content = redactGitHubTokens(content);
  return content;
}

// --- TOCTOU Filter ---

/**
 * Filter comments to only include those that existed before the trigger time.
 *
 * Uses strict >= comparison -- comments created at or after the trigger
 * timestamp are excluded. This intentionally excludes the trigger comment
 * itself (which has the same created_at as triggerTime) per Pitfall 4.
 *
 * Also excludes comments whose updated_at is at or after the trigger time,
 * preventing TOCTOU attacks where an attacker edits an existing comment
 * between the trigger event and context fetch.
 *
 * REST API note: We use `created_at` / `updated_at` (snake_case), not
 * GraphQL's camelCase fields. `updated_at` is more conservative than
 * GraphQL's `lastEditedAt` -- it changes on any update (edits, reactions,
 * labels), not just body edits. This is acceptable as it errs on the
 * side of security.
 *
 * @param comments Array of comments with created_at and optional updated_at
 * @param triggerTime ISO 8601 timestamp of the trigger event, or undefined
 * @returns Filtered comments that existed before trigger time
 */
export function filterCommentsToTriggerTime<
  T extends { created_at: string; updated_at?: string },
>(comments: T[], triggerTime: string | undefined): T[] {
  if (!triggerTime) return comments;

  const triggerTs = new Date(triggerTime).getTime();

  return comments.filter((comment) => {
    const createdTs = new Date(comment.created_at).getTime();
    if (createdTs >= triggerTs) return false;

    if (comment.updated_at) {
      const updatedTs = new Date(comment.updated_at).getTime();
      if (updatedTs >= triggerTs) return false;
    }

    return true;
  });
}
