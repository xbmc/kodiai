import { describe, it, expect } from "bun:test";
import { chunkWikiPage, stripHtmlToMarkdown, countTokens, detectLanguageTags } from "./wiki-chunker.ts";
import type { WikiPageInput } from "./wiki-types.ts";

function makePage(overrides: Partial<WikiPageInput> = {}): WikiPageInput {
  return {
    pageId: 1,
    pageTitle: "Test Page",
    namespace: "Main",
    pageUrl: "https://kodi.wiki/view/Test_Page",
    htmlContent: "<p>Some default content that is long enough to pass the 500 character minimum. ".repeat(10) + "</p>",
    lastModified: new Date("2024-06-15"),
    revisionId: 42,
    ...overrides,
  };
}

describe("countTokens", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countTokens("hello world")).toBe(2);
    expect(countTokens("one two three four")).toBe(4);
    expect(countTokens("")).toBe(0);
    expect(countTokens("  spaces  everywhere  ")).toBe(2);
  });
});

describe("stripHtmlToMarkdown", () => {
  it("converts headings to markdown", () => {
    const html = "<h2>Section Title</h2><p>Content here.</p>";
    const result = stripHtmlToMarkdown(html);
    expect(result).toContain("## Section Title");
    expect(result).toContain("Content here.");
  });

  it("converts h3 and h4 headings", () => {
    const html = "<h3>Sub Section</h3><h4>Deep Section</h4>";
    const result = stripHtmlToMarkdown(html);
    expect(result).toContain("### Sub Section");
    expect(result).toContain("#### Deep Section");
  });

  it("preserves code blocks", () => {
    const html = '<pre><code>function hello() {\n  return "world";\n}</code></pre>';
    const result = stripHtmlToMarkdown(html);
    expect(result).toContain("```");
    expect(result).toContain('function hello()');
    expect(result).toContain('return "world"');
  });

  it("converts inline code", () => {
    const html = "<p>Use <code>kodi-send</code> command.</p>";
    const result = stripHtmlToMarkdown(html);
    expect(result).toContain("`kodi-send`");
  });

  it("converts tables to text rows", () => {
    const html = "<table><tr><th>Name</th><th>Value</th></tr><tr><td>Port</td><td>8080</td></tr></table>";
    const result = stripHtmlToMarkdown(html);
    expect(result).toContain("Name | Value");
    expect(result).toContain("Port | 8080");
  });

  it("decodes HTML entities", () => {
    const html = "<p>A &amp; B &lt; C &gt; D &quot;E&quot; &#39;F&#39;</p>";
    const result = stripHtmlToMarkdown(html);
    expect(result).toContain('A & B < C > D "E" \'F\'');
  });

  it("strips remaining HTML tags", () => {
    const html = '<div class="mw-content"><span>Hello</span> <a href="/wiki">World</a></div>';
    const result = stripHtmlToMarkdown(html);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).not.toContain("<div");
    expect(result).not.toContain("<span");
    expect(result).not.toContain("<a ");
  });

  it("collapses multiple blank lines", () => {
    const html = "<p>Line 1</p><p></p><p></p><p>Line 2</p>";
    const result = stripHtmlToMarkdown(html);
    // Should not have more than two consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("removes MediaWiki template markup", () => {
    const html = "<p>Before {{Infobox|param=value}} After</p>";
    const result = stripHtmlToMarkdown(html);
    expect(result).toContain("Before");
    expect(result).toContain("After");
    expect(result).not.toContain("{{");
  });

  it("converts list items", () => {
    const html = "<ul><li>First item</li><li>Second item</li></ul>";
    const result = stripHtmlToMarkdown(html);
    expect(result).toContain("- First item");
    expect(result).toContain("- Second item");
  });
});

describe("detectLanguageTags", () => {
  it("returns ['python'] for content with python fenced code block", () => {
    const content = "Some description.\n\n```python\ndef hello():\n    print('hi')\n```\n\nMore text.";
    expect(detectLanguageTags(content)).toEqual(["python"]);
  });

  it("returns ['c', 'cpp'] for content with both c and cpp code blocks (sorted)", () => {
    const content = "C example:\n```c\nint main() {}\n```\n\nC++ example:\n```cpp\nclass Foo {};\n```";
    const tags = detectLanguageTags(content);
    expect(tags).toContain("c");
    expect(tags).toContain("cpp");
    expect(tags).toHaveLength(2);
    // Should be sorted
    expect(tags).toEqual([...tags].sort());
  });

  it("returns ['general'] for content with no code blocks or language references", () => {
    const content = "This is a general wiki page about Kodi settings and configuration. ".repeat(10);
    expect(detectLanguageTags(content)).toEqual(["general"]);
  });

  it("returns ['typescript'] for content mentioning 'TypeScript API'", () => {
    const content = "This page documents the TypeScript API for add-on development. Use the TypeScript implementation to build your add-on.";
    expect(detectLanguageTags(content)).toEqual(["typescript"]);
  });

  it("returns ['javascript', 'python'] for content with both python and javascript code blocks (sorted)", () => {
    const content = "Python example:\n```python\nprint('hello')\n```\nJavaScript example:\n```javascript\nconsole.log('hello');\n```";
    const tags = detectLanguageTags(content);
    expect(tags).toContain("python");
    expect(tags).toContain("javascript");
    expect(tags).toHaveLength(2);
    expect(tags).toEqual([...tags].sort());
  });

  it("normalizes fenced code block language aliases: py->python, js->javascript, ts->typescript", () => {
    const content = "```py\nprint('hi')\n```\n```js\nconsole.log('hi');\n```\n```ts\nconst x: number = 1;\n```";
    const tags = detectLanguageTags(content);
    expect(tags).toContain("python");
    expect(tags).toContain("javascript");
    expect(tags).toContain("typescript");
    expect(tags).not.toContain("py");
    expect(tags).not.toContain("js");
    expect(tags).not.toContain("ts");
  });

  it("chunkWikiPage output includes languageTags on each chunk", () => {
    const html = `<p>${"Python API documentation. ".repeat(30)}</p><pre><code class="python">def foo(): pass</code></pre>`;
    const page: WikiPageInput = {
      pageId: 999,
      pageTitle: "Python API",
      namespace: "Main",
      pageUrl: "https://kodi.wiki/view/Python_API",
      htmlContent: html,
    };
    const chunks = chunkWikiPage(page);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.languageTags).toBeDefined();
      expect(Array.isArray(chunk.languageTags)).toBe(true);
    }
    // All chunks from same page get same tags (page-level analysis)
    const allTags = chunks.map((c) => c.languageTags);
    const firstTags = JSON.stringify(allTags[0]);
    for (const tags of allTags) {
      expect(JSON.stringify(tags)).toBe(firstTags);
    }
  });
});

describe("chunkWikiPage", () => {
  it("produces chunks for a simple page with no headings", () => {
    const page = makePage({
      htmlContent: "<p>" + "This is a test paragraph with enough content. ".repeat(20) + "</p>",
    });
    const chunks = chunkWikiPage(page);
    expect(chunks.length).toBeGreaterThan(0);
    // Lead section should have no section heading
    expect(chunks[0]!.sectionHeading).toBeNull();
    expect(chunks[0]!.sectionAnchor).toBeNull();
  });

  it("splits at section headings", () => {
    const html = `
      <p>${"Introduction content. ".repeat(30)}</p>
      <h2>Section One</h2>
      <p>${"Section one content. ".repeat(30)}</p>
      <h2>Section Two</h2>
      <p>${"Section two content. ".repeat(30)}</p>
    `;
    const page = makePage({ htmlContent: html });
    const chunks = chunkWikiPage(page);

    const headings = [...new Set(chunks.map((c) => c.sectionHeading))];
    expect(headings).toContain(null); // lead section
    expect(headings).toContain("Section One");
    expect(headings).toContain("Section Two");
  });

  it("produces multiple chunks for large sections with correct overlap", () => {
    // Generate a section with >1024 tokens
    const longContent = "word ".repeat(2000);
    const html = `<p>${longContent}</p>`;
    const page = makePage({ htmlContent: html });
    const chunks = chunkWikiPage(page, { windowSize: 1024, overlapSize: 256 });

    expect(chunks.length).toBeGreaterThan(1);
    // Verify chunk indices are sequential
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
    }
  });

  it("skips redirect pages", () => {
    const page = makePage({
      htmlContent: "<p>#REDIRECT [[Other Page]]</p>",
    });
    const chunks = chunkWikiPage(page);
    expect(chunks.length).toBe(0);
  });

  it("skips stub pages with less than 500 characters", () => {
    const page = makePage({
      htmlContent: "<p>Short stub page.</p>",
    });
    const chunks = chunkWikiPage(page);
    expect(chunks.length).toBe(0);
  });

  it("skips disambiguation pages", () => {
    const page = makePage({
      htmlContent: "<p>Kodi may refer to:</p><ul><li>Kodi software</li><li>Kodi add-on</li></ul>" + "x".repeat(500),
    });
    const chunks = chunkWikiPage(page);
    expect(chunks.length).toBe(0);
  });

  it("prepends page title to lead section chunks", () => {
    const page = makePage({
      pageTitle: "Audio Settings",
      htmlContent: "<p>" + "Audio configuration content. ".repeat(25) + "</p>",
    });
    const chunks = chunkWikiPage(page);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.chunkText).toStartWith("Audio Settings: ");
  });

  it("prepends page title + section heading to section chunks", () => {
    const html = `
      <p>${"Lead content. ".repeat(30)}</p>
      <h2>Output Devices</h2>
      <p>${"Output devices info. ".repeat(30)}</p>
    `;
    const page = makePage({ pageTitle: "Audio Settings", htmlContent: html });
    const chunks = chunkWikiPage(page);

    const sectionChunks = chunks.filter((c) => c.sectionHeading === "Output Devices");
    expect(sectionChunks.length).toBeGreaterThan(0);
    expect(sectionChunks[0]!.chunkText).toStartWith("Audio Settings > Output Devices: ");
  });

  it("generates correct section anchors from headings", () => {
    const html = `
      <p>${"Lead text here. ".repeat(30)}</p>
      <h2>Audio Output Configuration</h2>
      <p>${"Config details. ".repeat(30)}</p>
    `;
    const page = makePage({ htmlContent: html });
    const chunks = chunkWikiPage(page);

    const sectionChunks = chunks.filter((c) => c.sectionHeading === "Audio Output Configuration");
    expect(sectionChunks.length).toBeGreaterThan(0);
    expect(sectionChunks[0]!.sectionAnchor).toBe("Audio_Output_Configuration");
  });

  it("stores rawText without prefix and chunkText with prefix", () => {
    const page = makePage({
      pageTitle: "Test",
      htmlContent: "<p>" + "Content for testing raw text storage. ".repeat(20) + "</p>",
    });
    const chunks = chunkWikiPage(page);
    expect(chunks.length).toBeGreaterThan(0);

    const chunk = chunks[0]!;
    expect(chunk.chunkText).toStartWith("Test: ");
    expect(chunk.rawText).not.toStartWith("Test: ");
    // rawText should be the content without the prefix
    expect(chunk.chunkText).toContain(chunk.rawText);
  });

  it("returns empty array for empty HTML", () => {
    const page = makePage({ htmlContent: "" });
    const chunks = chunkWikiPage(page);
    expect(chunks.length).toBe(0);
  });

  it("carries full page metadata on each chunk", () => {
    const page = makePage({
      pageId: 123,
      pageTitle: "My Page",
      namespace: "Main",
      pageUrl: "https://kodi.wiki/view/My_Page",
      lastModified: new Date("2024-03-15"),
      revisionId: 99,
    });
    const chunks = chunkWikiPage(page);
    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.pageId).toBe(123);
      expect(chunk.pageTitle).toBe("My Page");
      expect(chunk.namespace).toBe("Main");
      expect(chunk.pageUrl).toBe("https://kodi.wiki/view/My_Page");
      expect(chunk.revisionId).toBe(99);
    }
  });
});
