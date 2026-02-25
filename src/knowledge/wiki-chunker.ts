import type { WikiPageInput, WikiPageChunk } from "./wiki-types.ts";

/** Simple whitespace-based token count approximation. */
export function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/**
 * Convert HTML table to text rows.
 * Extracts cell content, joins with " | ", rows with newlines.
 */
function convertTableToText(tableHtml: string): string {
  const rows: string[] = [];
  // Match each <tr> block
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(tableHtml)) !== null) {
    const rowContent = trMatch[1]!;
    const cells: string[] = [];
    // Match <td> or <th> content
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      // Strip inner tags from cell content
      const cellText = cellMatch[1]!.replace(/<[^>]*>/g, "").trim();
      if (cellText) cells.push(cellText);
    }

    if (cells.length > 0) {
      rows.push(cells.join(" | "));
    }
  }

  return rows.join("\n");
}

/**
 * Strip HTML to clean markdown-like text.
 *
 * - Converts headings to markdown headings
 * - Converts code blocks to fenced code blocks
 * - Converts tables to text rows
 * - Strips remaining HTML tags
 * - Decodes HTML entities
 * - Collapses whitespace
 */
export function stripHtmlToMarkdown(html: string): string {
  let text = html;

  // Remove MediaWiki template/infobox markup remnants ({{...}} patterns in HTML)
  text = text.replace(/\{\{[^}]*\}\}/g, "");

  // Convert <pre><code> blocks to fenced code blocks (preserve content)
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_match, code) => {
    return `\n\`\`\`\n${decodeHtmlEntities(code.trim())}\n\`\`\`\n`;
  });

  // Convert standalone <pre> blocks to fenced code blocks
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, code) => {
    return `\n\`\`\`\n${decodeHtmlEntities(code.replace(/<[^>]*>/g, "").trim())}\n\`\`\`\n`;
  });

  // Convert <code> (inline) to backtick code
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_match, code) => {
    return `\`${code.replace(/<[^>]*>/g, "").trim()}\``;
  });

  // Convert headings to markdown
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_match, content) => {
    return `\n## ${content.replace(/<[^>]*>/g, "").trim()}\n`;
  });
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_match, content) => {
    return `\n### ${content.replace(/<[^>]*>/g, "").trim()}\n`;
  });
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_match, content) => {
    return `\n#### ${content.replace(/<[^>]*>/g, "").trim()}\n`;
  });

  // Convert tables to text rows
  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, tableContent) => {
    return `\n${convertTableToText(tableContent)}\n`;
  });

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, content) => {
    return `- ${content.replace(/<[^>]*>/g, "").trim()}\n`;
  });

  // Convert paragraphs to double newlines
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Collapse multiple blank lines to single
  text = text.replace(/\n{3,}/g, "\n\n");

  // Trim leading/trailing whitespace
  text = text.trim();

  return text;
}

/** Parsed section from a wiki page. */
type WikiSection = {
  heading: string | null;
  anchor: string | null;
  level: number | null;
  text: string;
};

/**
 * Generate a URL-safe anchor from a heading.
 * Follows MediaWiki convention: spaces to underscores, special chars removed.
 */
function headingToAnchor(heading: string): string {
  return heading
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-_.]/g, "");
}

/**
 * Split cleaned markdown into sections at heading boundaries.
 */
function splitIntoSections(markdown: string): WikiSection[] {
  const lines = markdown.split("\n");
  const sections: WikiSection[] = [];
  let currentHeading: string | null = null;
  let currentAnchor: string | null = null;
  let currentLevel: number | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,4})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      const sectionText = currentLines.join("\n").trim();
      if (sectionText.length > 0 || sections.length === 0) {
        sections.push({
          heading: currentHeading,
          anchor: currentAnchor,
          level: currentLevel,
          text: sectionText,
        });
      }

      // Start new section
      currentLevel = headingMatch[1]!.length;
      currentHeading = headingMatch[2]!.trim();
      currentAnchor = headingToAnchor(currentHeading);
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Don't forget the last section
  const lastText = currentLines.join("\n").trim();
  if (lastText.length > 0) {
    sections.push({
      heading: currentHeading,
      anchor: currentAnchor,
      level: currentLevel,
      text: lastText,
    });
  }

  return sections;
}

/**
 * Check if a page should be skipped.
 * Skips redirects, stubs (<500 chars), and disambiguation pages.
 */
function shouldSkipPage(cleanText: string): boolean {
  // Redirect detection
  if (cleanText.trimStart().toUpperCase().startsWith("#REDIRECT")) {
    return true;
  }

  // Stub detection: less than 500 characters after stripping
  if (cleanText.length < 500) {
    return true;
  }

  // Disambiguation detection
  const lowerText = cleanText.toLowerCase();
  if (
    lowerText.includes("may refer to:") ||
    lowerText.includes("disambiguation") ||
    lowerText.includes("this is a disambiguation page")
  ) {
    return true;
  }

  return false;
}

export type WikiChunkOptions = {
  windowSize?: number;
  overlapSize?: number;
};

/**
 * Chunk a wiki page into embeddable units.
 *
 * - Converts HTML to markdown
 * - Skips redirects, stubs, and disambiguation pages
 * - Splits at section headings
 * - Applies sliding window within large sections (1024 tokens, 256 overlap)
 * - Prepends page title + section heading as context prefix
 *
 * @param page - Wiki page input with HTML content
 * @param opts - Configuration options
 * @returns Array of WikiPageChunk ready for storage
 */
export function chunkWikiPage(
  page: WikiPageInput,
  opts: WikiChunkOptions = {},
): WikiPageChunk[] {
  const windowSize = opts.windowSize ?? 1024;
  const overlapSize = opts.overlapSize ?? 256;

  // Step 1: Convert HTML to clean markdown
  const cleanText = stripHtmlToMarkdown(page.htmlContent);

  // Step 2: Skip filtering
  if (shouldSkipPage(cleanText)) {
    return [];
  }

  // Step 3: Split into sections
  const sections = splitIntoSections(cleanText);

  // Step 4: Chunk each section
  const chunks: WikiPageChunk[] = [];

  for (const section of sections) {
    if (section.text.length === 0) continue;

    // Build prefix for embedding context
    const prefix = section.heading
      ? `${page.pageTitle} > ${section.heading}`
      : page.pageTitle;

    const baseMeta = {
      pageId: page.pageId,
      pageTitle: page.pageTitle,
      namespace: page.namespace,
      pageUrl: page.pageUrl,
      sectionHeading: section.heading,
      sectionAnchor: section.anchor,
      sectionLevel: section.level,
      lastModified: page.lastModified ?? null,
      revisionId: page.revisionId ?? null,
    };

    const sectionTokens = countTokens(section.text);

    if (sectionTokens <= windowSize) {
      // Single chunk for this section
      chunks.push({
        ...baseMeta,
        chunkIndex: 0,
        chunkText: `${prefix}: ${section.text}`,
        rawText: section.text,
        tokenCount: countTokens(`${prefix}: ${section.text}`),
      });
    } else {
      // Sliding window within section
      const words = section.text.split(/\s+/).filter(Boolean);
      let start = 0;
      let chunkIndex = 0;

      while (start < words.length) {
        const end = Math.min(start + windowSize, words.length);
        const chunkWords = words.slice(start, end);
        const rawText = chunkWords.join(" ");
        const chunkText = `${prefix}: ${rawText}`;

        chunks.push({
          ...baseMeta,
          chunkIndex,
          chunkText,
          rawText,
          tokenCount: countTokens(chunkText),
        });

        chunkIndex++;
        const step = windowSize - overlapSize;
        start += step;

        if (end >= words.length) break;
      }
    }
  }

  return chunks;
}
