# M020: Multi-Model & Active Intelligence

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Multi Llm Routing Cost Tracking** `risk:medium` `depends:[]`
  > After this: Install AI SDK packages and build the task routing foundation layer: task type taxonomy, provider registry, task router with wildcard resolution, pricing configuration, and .
- [x] **S02: Contributor Profiles Identity Linking** `risk:medium` `depends:[S01]`
  > After this: Create the contributor profiles schema, types, and data store -- the foundation for identity linking, expertise tracking, and privacy controls.
- [x] **S03: Wiki Staleness Detection** `risk:medium` `depends:[S02]`
  > After this: unit tests prove wiki-staleness-detection works
- [x] **S04: Review Pattern Clustering** `risk:medium` `depends:[S03]`
  > After this: Implement core HDBSCAN algorithm and define cluster type contracts for the entire phase.
- [x] **S05: Wire Executor Deps Cost Tracking** `risk:medium` `depends:[S04]`
  > After this: Wire taskRouter and costTracker into createExecutor and fix the missing repo field in wiki-staleness-detector's generateWithFallback call.
- [x] **S06: Documentation Verification Closure** `risk:medium` `depends:[S05]`
  > After this: Create Phase 100 VERIFICATION.
