import type { Logger } from "pino";
import type { BotUserClient } from "../auth/bot-user.ts";

export interface GistPublisher {
  /** Create a secret gist with patch content. Returns gist URL and ID. */
  createPatchGist(options: {
    owner: string;
    repo: string;
    summary: string;
    patch: string;
  }): Promise<{ htmlUrl: string; id: string }>;
  /** Whether gist publishing is available. */
  readonly enabled: boolean;
}

export function createGistPublisher(botClient: BotUserClient, logger: Logger): GistPublisher {
  if (!botClient.enabled) {
    return {
      enabled: false,
      async createPatchGist(): Promise<never> {
        throw new Error("Gist publisher is not available. Bot user client is not configured.");
      },
    };
  }

  return {
    enabled: true,

    async createPatchGist(options: {
      owner: string;
      repo: string;
      summary: string;
      patch: string;
    }): Promise<{ htmlUrl: string; id: string }> {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${options.owner}-${options.repo}-${timestamp}.patch`;

      logger.info({ owner: options.owner, repo: options.repo, filename }, "Creating secret gist with patch");

      const response = await botClient.octokit.rest.gists.create({
        description: `[kodiai] Patch for ${options.owner}/${options.repo}: ${options.summary}`,
        public: false,
        files: {
          [filename]: { content: options.patch },
        },
      });

      const htmlUrl = response.data.html_url!;
      const id = response.data.id!;

      logger.info({ id, htmlUrl }, "Secret gist created");

      return { htmlUrl, id };
    },
  };
}
