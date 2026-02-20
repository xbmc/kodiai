import { z } from "zod";

const configSchema = z.object({
  githubAppId: z.string().min(1, "GITHUB_APP_ID is required"),
  githubPrivateKey: z.string().min(1, "Private key is required"),
  webhookSecret: z.string().min(1, "GITHUB_WEBHOOK_SECRET is required"),
  slackSigningSecret: z.string().min(1, "SLACK_SIGNING_SECRET is required"),
  slackBotToken: z.string().min(1, "SLACK_BOT_TOKEN is required"),
  slackBotUserId: z.string().min(1, "SLACK_BOT_USER_ID is required"),
  slackKodiaiChannelId: z.string().min(1, "SLACK_KODIAI_CHANNEL_ID is required"),
  slackDefaultRepo: z.string().default("xbmc/xbmc"),
  slackAssistantModel: z.string().default("claude-3-5-haiku-latest"),
  port: z.coerce.number().default(3000),
  logLevel: z.string().default("info"),
  botAllowList: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((b) => b.trim().toLowerCase())
        .filter(Boolean),
    ),
});

export type AppConfig = z.infer<typeof configSchema>;

async function loadPrivateKey(): Promise<string> {
  const keyEnv = process.env.GITHUB_PRIVATE_KEY;
  if (!keyEnv) {
    throw new Error("GITHUB_PRIVATE_KEY environment variable is required");
  }

  // Inline PEM string
  if (keyEnv.startsWith("-----BEGIN")) {
    return keyEnv;
  }

  // File path
  if (keyEnv.startsWith("/") || keyEnv.startsWith("./")) {
    try {
      return await Bun.file(keyEnv).text();
    } catch (err) {
      throw new Error(
        `Failed to read private key from file "${keyEnv}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Base64-encoded
  try {
    return atob(keyEnv);
  } catch {
    throw new Error(
      "GITHUB_PRIVATE_KEY is not a valid PEM string, file path, or base64-encoded value",
    );
  }
}

export async function loadConfig(): Promise<AppConfig> {
  let privateKey: string;
  try {
    privateKey = await loadPrivateKey();
  } catch (err) {
    console.error(
      `FATAL: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const result = configSchema.safeParse({
    githubAppId: process.env.GITHUB_APP_ID,
    githubPrivateKey: privateKey,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackBotUserId: process.env.SLACK_BOT_USER_ID,
    slackKodiaiChannelId: process.env.SLACK_KODIAI_CHANNEL_ID,
    slackDefaultRepo: process.env.SLACK_DEFAULT_REPO,
    slackAssistantModel: process.env.SLACK_ASSISTANT_MODEL,
    port: process.env.PORT,
    logLevel: process.env.LOG_LEVEL,
    botAllowList: process.env.BOT_ALLOW_LIST,
  });

  if (!result.success) {
    console.error("FATAL: Invalid configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
