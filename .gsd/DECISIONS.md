# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? |
|---|------|-------|----------|--------|-----------|------------|
| D001 | M028/S03/T01 | M028/S03 | --issue-number flag scoping in publish-wiki-updates.ts | Parse --issue-number outside the retrofitPreview gate into liveIssueNumber; pass to publisher.publish() unconditionally for all run modes | Previously --issue-number was only parsed inside if (retrofitPreview), silently erroring for live runs. Moving it outside makes the flag's documented behavior match its actual behavior and enables live publish to existing issues without creating new ones. | Yes |
| D002 | M028/S03/T01 | M028/S03 | How wiki-publisher.ts selects between creating and using an existing tracking issue | In publish() step 5, branch on runOptions.issueNumber: supplied → issues.get (fetch existing), missing → issues.create (new issue titled 'Wiki Modification Artifacts') | Operators need to post modification-only comments to an existing tracking issue (e.g., issue #5 that previously held suggestion-style comments) rather than always creating a new issue. The branch is at step 5 just before the issue URL is needed, so issueNumber and issueUrl can be declared as let and assigned by either path. | Yes |
| D003 | M028/S03/T02 | M028/S03 | Live publish scope for S03 operational proof | Scope S03 live publish to 3 pages (page_id 213, 259, 287) rather than all 83+ grounded pages | A 3-page scoped run is sufficient to prove the S03 contract (real GitHub comment IDs in DB, publisher uses supplied issue number, no issues.create called). Flooding xbmc/wiki issue #5 with 83 comments is unnecessary for S03 proof and leaves a cleaner starting state for S04. | Yes |
