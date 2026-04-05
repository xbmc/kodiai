# M041: Canonical Repo-Code Corpus

## Vision
Build a canonical default-branch code corpus for current unchanged code — separate from historical diff hunks — with truthful provenance, selective upkeep, and semantic retrieval that downstream review systems can trust.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Canonical Schema, Chunking, and Storage | high | — | ✅ | After this slice, Kodiai can ingest a fixture repo snapshot into dedicated canonical-corpus tables and show current-code chunks with explicit repo/ref/commit provenance. |
| S02 | Default-Branch Backfill and Semantic Retrieval | medium | S01 | ⬜ | After this slice, Kodiai can backfill a repo's default branch once and answer review-style semantic queries from the canonical current-code corpus with provenance-preserving results. |
| S03 | Incremental Refresh and Audit/Repair | medium | S01, S02 | ⬜ | After this slice, Kodiai keeps the canonical corpus fresh via changed-file updates and can prove drift detection and selective repair without full-repo rebuilds. |
