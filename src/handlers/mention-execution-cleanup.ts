type CleanupWorkspace = {
  cleanup: () => Promise<void>;
};

export async function cleanupMentionExecutionResources(params: {
  acquiredWriteKey?: string;
  releaseWriteKey: (key: string) => void;
  workspace?: CleanupWorkspace;
}): Promise<void> {
  if (params.acquiredWriteKey) {
    params.releaseWriteKey(params.acquiredWriteKey);
  }
  if (params.workspace) {
    await params.workspace.cleanup();
  }
}
