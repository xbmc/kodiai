export function buildReviewPostExecutionTelemetryPublicationContext<TOctokit>(params: {
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<TOctokit>;
  appSlug: string;
}): {
  getOctokit: () => Promise<TOctokit>;
  botHandles: string[];
} {
  return {
    getOctokit: () => params.getInstallationOctokit(params.installationId),
    botHandles: [params.appSlug, "claude"],
  };
}
