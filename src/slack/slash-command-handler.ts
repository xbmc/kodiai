import type { Logger } from "pino";
import type {
  ContributorProfileStore,
  ContributorExpertise,
} from "../contributor/types.ts";

export type SlashCommandResult = {
  responseType: "ephemeral" | "in_channel";
  text: string;
  asyncWork?: () => Promise<void>;
};

const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

function formatProfileCard(profile: {
  githubUsername: string;
  overallTier: string;
  overallScore: number;
  optedOut: boolean;
}, expertise: ContributorExpertise[]): string {
  const lines: string[] = [
    `*Contributor Profile*`,
    `GitHub: \`${profile.githubUsername}\``,
    `Tier: ${profile.overallTier}`,
    `Score: ${profile.overallScore.toFixed(2)}`,
  ];

  if (profile.optedOut) {
    lines.push(`Status: Opted out (generic reviews)`);
  }

  if (expertise.length > 0) {
    lines.push(``, `*Top Expertise:*`);
    const top = expertise.slice(0, 5);
    for (const entry of top) {
      lines.push(`  ${entry.dimension}/${entry.topic}: ${entry.score.toFixed(2)}`);
    }
  }

  return lines.join("\n");
}

export async function handleKodiaiCommand(params: {
  text: string;
  slackUserId: string;
  slackUserName: string;
  profileStore: ContributorProfileStore;
  logger: Logger;
}): Promise<SlashCommandResult> {
  const { text, slackUserId, slackUserName, profileStore, logger } = params;
  const parts = text.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";
  const args = parts.slice(1);

  if (subcommand === "link") {
    const githubUsername = args[0];
    if (!githubUsername || !GITHUB_USERNAME_RE.test(githubUsername)) {
      return {
        responseType: "ephemeral",
        text: "Usage: `/kodiai link <github-username>` — GitHub usernames can only contain alphanumeric characters and hyphens.",
      };
    }

    await profileStore.linkIdentity({
      slackUserId,
      githubUsername,
      displayName: slackUserName,
    });

    return {
      responseType: "ephemeral",
      text: `Linked your Slack account to GitHub user \`${githubUsername}\`. Your contributor profile is now active.`,
      asyncWork: async () => {
        logger.info(
          { githubUsername, slackUserId },
          "Expertise seeding deferred to background job",
        );
      },
    };
  }

  if (subcommand === "unlink") {
    const profile = await profileStore.getBySlackUserId(slackUserId);
    if (!profile) {
      return {
        responseType: "ephemeral",
        text: "No linked GitHub account found.",
      };
    }

    await profileStore.unlinkSlack(profile.githubUsername);
    return {
      responseType: "ephemeral",
      text: `Unlinked your Slack account from GitHub user \`${profile.githubUsername}\`. Your expertise data is preserved.`,
    };
  }

  if (subcommand === "profile") {
    const subAction = args[0]?.toLowerCase();

    if (subAction === "opt-out") {
      const profile = await profileStore.getBySlackUserId(slackUserId);
      if (!profile) {
        return {
          responseType: "ephemeral",
          text: "No profile found. Link with `/kodiai link <github-username>` first.",
        };
      }
      await profileStore.setOptedOut(profile.githubUsername, true);
      return {
        responseType: "ephemeral",
        text: "Opted out of contributor profiling. You will receive generic (non-adapted) reviews.",
      };
    }

    if (subAction === "opt-in") {
      const profile = await profileStore.getBySlackUserId(slackUserId);
      if (!profile) {
        return {
          responseType: "ephemeral",
          text: "No profile found. Link with `/kodiai link <github-username>` first.",
        };
      }
      await profileStore.setOptedOut(profile.githubUsername, false);
      return {
        responseType: "ephemeral",
        text: "Opted back in to contributor profiling.",
      };
    }

    // Show profile
    const profile = await profileStore.getBySlackUserId(slackUserId);
    if (!profile) {
      return {
        responseType: "ephemeral",
        text: "No profile found. Link with `/kodiai link <github-username>`",
      };
    }

    const expertise = await profileStore.getExpertise(profile.id);
    return {
      responseType: "ephemeral",
      text: formatProfileCard(profile, expertise),
    };
  }

  return {
    responseType: "ephemeral",
    text: "Unknown command. Available: `link <github-username>`, `unlink`, `profile`, `profile opt-out`",
  };
}
