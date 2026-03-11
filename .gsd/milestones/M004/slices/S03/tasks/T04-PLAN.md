# T04: 28-knowledge-store-explicit-learning 04

**Slice:** S03 — **Milestone:** M004

## Description

Create CLI query scripts for operators to inspect knowledge store data on demand. These mirror the existing `scripts/usage-report.ts` pattern.

Purpose: Users need to query review statistics and trends for their repos (LEARN-04 and locked decision about CLI query commands). The scripts are self-contained -- they open the SQLite database directly without importing from src/.

Output: Two standalone CLI scripts: `kodiai-stats.ts` and `kodiai-trends.ts`.

## Must-Haves

- [ ] "Operator can run kodiai-stats to see review statistics for a repo"
- [ ] "Operator can run kodiai-trends to see daily trend data over time"
- [ ] "Both scripts output human-readable tables by default and JSON with --json flag"
- [ ] "Both scripts open the database in read-only mode"
- [ ] "Both scripts work without importing from src/ (self-contained)"

## Files

- `scripts/kodiai-stats.ts`
- `scripts/kodiai-trends.ts`
