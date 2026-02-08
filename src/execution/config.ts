import { z } from "zod";
import yaml from "js-yaml";

const repoConfigSchema = z.object({
  model: z.string().default("claude-sonnet-4-5-20250929"),
  maxTurns: z.number().min(1).max(100).default(25),
  systemPromptAppend: z.string().optional(),
  review: z
    .object({
      enabled: z.boolean().default(true),
      autoApprove: z.boolean().default(false),
      prompt: z.string().optional(),
      skipAuthors: z.array(z.string()).default([]),
      skipPaths: z.array(z.string()).default([]),
    })
    .default({
      enabled: true,
      autoApprove: false,
      skipAuthors: [],
      skipPaths: [],
    }),
  mention: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
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
