import type { Logger } from "pino";
import type {
  ContributorProfileStore,
  ContributorExpertise,
} from "../contributor/types.ts";
import { resolveContributorExperienceSlackProfileProjection } from "../contributor/experience-contract.ts";

export type SlashCommandResult = {
  responseType: "ephemeral" | "in_channel";
  text: string;
  asyncWork?: () => Promise<void>;
};

const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

function formatProfileCard(
  profile: {
    githubUsername: string;
    overallTier: string;
    optedOut: boolean;
  },
  expertise: ContributorExpertise[],
): string {
  const projection = resolveContributorExperienceSlackProfileProjection({
    source: "contributor-profile",
    tier: profile.overallTier,
    optedOut: profile.optedOut,
  });

  const lines: string[] = [
    `*Contributor Profile*`,
    `GitHub: \`${profile.githubUsername}\``,
    projection.statusLine,
    projection.summaryLine,
  ];

  if (projection.showExpertise && expertise.length > 0) {
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
        text: "Contributor-specific guidance is now off. Kodiai will keep your reviews generic until you run `/kodiai profile opt-in`. Check `/kodiai profile` any time to review your current status.",
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
        text: "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
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
    text: "Unknown command. Available: `link <github-username>`, `unlink`, `profile`, `profile opt-in`, `profile opt-out`",
  };
}
