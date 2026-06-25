CREATE INDEX IF NOT EXISTS idx_review_graph_files_repo_workspace_path
  ON review_graph_files (repo, workspace_key, path);
