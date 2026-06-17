CREATE INDEX IF NOT EXISTS idx_wiki_pages_active_page_chunk
  ON wiki_pages (page_id, chunk_index)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_issue_comments_repo_issue_created
  ON issue_comments (repo, issue_number, github_created_at);

CREATE INDEX IF NOT EXISTS idx_review_clusters_active_centroid_hnsw
  ON review_clusters USING hnsw (centroid vector_cosine_ops)
  WHERE retired = false AND centroid IS NOT NULL;
