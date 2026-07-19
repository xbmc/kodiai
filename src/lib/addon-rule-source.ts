import { runWithAbortSignalTimeout } from "./with-timeout.ts";

export const ADDON_RULES_URL = "https://kodi.wiki/view/Add-on_rules";

export const EMBEDDED_ADDON_RULES = [
  "Kodi add-on submission rules fallback:",
  "- Review only changed paths and diff patches; do not assess Python or JavaScript code quality, correctness, style, or architecture.",
  "- Submission target branches must be Kodi symbolic version names from matrix onward; master and main are not allowed.",
  "- Addons must not include development-only files such as CI, linter, test runner, or test files.",
  "- Addons must not include obfuscated scripts. Minified JavaScript is allowed only for web-interface addons and still needs security review.",
  "- Binary files are not allowed except images and fonts.",
  "- Addons must include an open source license file and addon.xml license metadata.",
  "- strings.po translations must live under resources/language/resource.language.<lc_cc> directories.",
  "- addon.xml must include English summary and description metadata.",
  "- addon.xml metadata language codes should use lc_CC format.",
  "- Addons may write to their profile directory and Kodi temp. Writing to install paths, other addons, or Kodi files is not allowed.",
  "- Downloads require user consent. Running executable files is not allowed.",
  "- Addons must not install or modify other addons, directly access Kodi databases, force skin view/sort modes, or include usage analytics.",
].join("\n");

export type AddonRuleSource = {
  kind: "wiki" | "fallback";
  url: string;
  text: string;
};

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export async function loadAddonRuleSource(opts: {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxChars?: number;
} = {}): Promise<AddonRuleSource> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const maxChars = opts.maxChars ?? 12_000;

  try {
    return await runWithAbortSignalTimeout(
      "addon rule source fetch",
      timeoutMs,
      async (signal) => {
        const response = await fetchImpl(ADDON_RULES_URL, { signal });
        if (!response.ok) return fallbackSource();
        const text = stripHtml(await readBoundedResponseText(response, maxChars * 4)).slice(0, maxChars).trim();
        return text.length > 0 ? { kind: "wiki", url: ADDON_RULES_URL, text } : fallbackSource();
      },
    );
  } catch {
    return fallbackSource();
  }
}

function fallbackSource(): AddonRuleSource {
  return { kind: "fallback", url: ADDON_RULES_URL, text: EMBEDDED_ADDON_RULES };
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return await response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remainingBytes = maxBytes - totalBytes;
      const chunk = value.length > remainingBytes ? value.slice(0, remainingBytes) : value;
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (value.length > remainingBytes) break;
    }
  } finally {
    reader.releaseLock();
    if (totalBytes >= maxBytes) {
      await response.body.cancel().catch(() => undefined);
    }
  }

  return new TextDecoder().decode(concatChunks(chunks, totalBytes));
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
