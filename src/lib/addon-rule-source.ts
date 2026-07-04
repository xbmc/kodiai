export const ADDON_RULES_URL = "https://kodi.wiki/view/Add-on_rules";

export const EMBEDDED_ADDON_RULES = [
  "Kodi add-on submission rules fallback:",
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(ADDON_RULES_URL, { signal: controller.signal });
      if (!response.ok) return fallbackSource();
      const text = stripHtml(await response.text()).slice(0, maxChars).trim();
      return text.length > 0 ? { kind: "wiki", url: ADDON_RULES_URL, text } : fallbackSource();
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return fallbackSource();
  }
}

function fallbackSource(): AddonRuleSource {
  return { kind: "fallback", url: ADDON_RULES_URL, text: EMBEDDED_ADDON_RULES };
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
