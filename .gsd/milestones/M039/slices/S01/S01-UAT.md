# S01: PR Template Stripping Hardening + xbmc Fixture — UAT

**Milestone:** M039
**Written:** 2026-04-04T21:01:34.826Z

# UAT — S01 PR Template Stripping Hardening\n\n## Steps\n1. Run `bun test ./src/lib/pr-intent-parser.test.ts`\n\n## Expected\n- 37 tests pass including `xbmc PR template body with Breaking change checkbox does not trigger detection` and `plain body prose breaking change is still detected after template stripping`
