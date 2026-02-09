import { z } from "zod";
import yaml from "js-yaml";

const repoConfigSchema = z.object({
  model: z.string().default("claude-sonnet-4-5-20250929"),
  maxTurns: z.number().min(1).max(100).default(25),
  timeoutSeconds: z.number().min(30).max(1800).default(300),
  systemPromptAppend: z.string().optional(),
  review: z
    .object({
      enabled: z.boolean().default(true),
      triggers: z
        .object({
          onOpened: z.boolean().default(true),
          onReadyForReview: z.boolean().default(true),
          onReviewRequested: z.boolean().default(true),
        })
        .strict()
        .default({
          onOpened: true,
          onReadyForReview: true,
          onReviewRequested: true,
        }),
      autoApprove: z.boolean().default(true),
      prompt: z.string().optional(),
      skipAuthors: z.array(z.string()).default([]),
      skipPaths: z.array(z.string()).default([]),
    })
    .default({
      enabled: true,
      triggers: {
        onOpened: true,
        onReadyForReview: true,
        onReviewRequested: true,
      },
      autoApprove: true,
      skipAuthors: [],
      skipPaths: [],
    }),
  mention: z
    .object({
      enabled: z.boolean().default(true),
      acceptClaudeAlias: z.boolean().default(true),
      prompt: z.string().optional(),
    })
    .strict()
    .default({ enabled: true, acceptClaudeAlias: true }),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;

export async function loadRepoConfig(
  workspaceDir: string,
): Promise<RepoConfig> {
  const configPath = `${workspaceDir}/.kodiai.yml`;
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return repoConfigSchema.parse({});
  }

  const raw = await file.text();

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(
      `Invalid .kodiai.yml: YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    return repoConfigSchema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid .kodiai.yml: ${issues}`);
    }
    throw err;
  }
}
