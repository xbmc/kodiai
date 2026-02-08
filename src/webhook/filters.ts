import type { Logger } from "pino";
import type { BotFilter } from "./types.ts";

/**
 * Creates a bot filter that drops events from bot accounts (except those on the allow-list)
 * and always drops events from the app itself (regardless of allow-list).
 *
 * @param appSlug - The GitHub App's slug (used to identify self-events)
 * @param allowList - Bot logins that should be allowed through (already lowercased by config)
 * @param logger - Logger for debug-level filter decisions
 */
export function createBotFilter(
  appSlug: string,
  allowList: string[],
  logger: Logger,
): BotFilter {
  const normalizedAppSlug = appSlug.toLowerCase();
  const normalizedAllowList = new Set(allowList.map((b) => b.toLowerCase()));

  return {
    shouldProcess(sender: { type: string; login: string }): boolean {
      // Normalize sender login: lowercase and strip "[bot]" suffix
      const normalizedLogin = sender.login
        .toLowerCase()
        .replace(/\[bot\]$/, "");

      // Always filter app's own events -- not configurable
      if (normalizedLogin === normalizedAppSlug) {
        logger.debug(
          { sender: sender.login },
          "Filtered: event from app itself",
        );
        return false;
      }

      // Non-bot senders always pass through
      if (sender.type === "User") {
        return true;
      }

      // Bot sender: check allow-list
      if (normalizedAllowList.has(normalizedLogin)) {
        logger.debug(
          { sender: sender.login },
          "Bot on allow-list, passing through",
        );
        return true;
      }

      logger.debug(
        { sender: sender.login, type: sender.type },
        "Filtered: bot account not on allow-list",
      );
      return false;
    },
  };
}
