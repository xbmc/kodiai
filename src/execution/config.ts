import { z } from "zod";
import yaml from "js-yaml";

const repoConfigSchema = z.object({
  model: z.string().default("claude-sonnet-4-5-20250929"),
  maxTurns: z.number().min(1).max(100).default(25),
  timeoutSeconds: z.number().min(30).max(1800).default(600),
  systemPromptAppend: z.string().optional(),
  /**
   * Write-mode gates mention-driven code modifications (branch/commit/push).
   * This is deny-by-default. Enabling this does not affect review-only behavior.
   */
  write: z
    .object({
      enabled: z.boolean().default(false),
      /** If set, every changed path must match at least one allowPaths pattern. */
      allowPaths: z.array(z.string()).default([]),
      /** Changed paths matching any denyPaths pattern are blocked. Deny wins over allow. */
      denyPaths: z
        .array(z.string())
        .default([
          ".github/",
          ".git/",
          ".planning/",
          ".kodiai.yml",
          ".env",
          ".env.*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/*credentials*",
          "**/*secret*",
        ]),
      /** Basic rate limit for write-mode requests. 0 = no limit. */
      minIntervalSeconds: z.number().min(0).max(86400).default(0),
      secretScan: z
        .object({
          enabled: z.boolean().default(true),
        })
        .strict()
        .default({ enabled: true }),
    })
    .strict()
    .default({
      enabled: false,
      allowPaths: [],
      denyPaths: [
        ".github/",
        ".git/",
        ".planning/",
        ".kodiai.yml",
        ".env",
        ".env.*",
        "**/*.pem",
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/*credentials*",
        "**/*secret*",
      ],
      minIntervalSeconds: 0,
      secretScan: { enabled: true },
    }),
  review: z
    .object({
      enabled: z.boolean().default(true),
      /**
       * Optional team slug/name to use for UI-based re-review.
       * When configured, Kodiai can ensure the team is requested on PR open so it appears
       * under Reviewers. Humans can then remove/re-request to retrigger a review.
       */
      uiRereviewTeam: z.string().optional(),
      /** If true, request uiRereviewTeam on opened/ready_for_review events (best-effort). */
      requestUiRereviewTeamOnOpen: z.boolean().default(false),
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
      requestUiRereviewTeamOnOpen: false,
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
