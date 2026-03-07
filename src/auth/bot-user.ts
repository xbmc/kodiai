import { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";

export interface BotUserClient {
  /** PAT-authenticated Octokit for fork/gist operations. */
  readonly octokit: Octokit;
  /** Bot user's GitHub login (e.g. "kodiai-bot"). */
  readonly login: string;
  /** Whether the bot user client is configured (PAT + login provided). */
  readonly enabled: boolean;
}

export function createBotUserClient(config: AppConfig, logger: Logger): BotUserClient {
  const pat = config.botUserPat;
  const login = config.botUserLogin;

  if (pat && login) {
    logger.info({ login }, "Bot user client enabled for fork/gist operations");
    const octokit = new Octokit({ auth: pat });
    return { octokit, login, enabled: true };
  }

  logger.warn("BOT_USER_PAT or BOT_USER_LOGIN not set -- fork/gist features disabled");

  return {
    get octokit(): Octokit {
      throw new Error("Bot user client is not configured. Set BOT_USER_PAT and BOT_USER_LOGIN env vars.");
    },
    login: "",
    enabled: false,
  };
}
