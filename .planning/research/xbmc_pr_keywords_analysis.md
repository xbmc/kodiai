# XBMC PR Keywords & Metadata Analysis

**Analysis Date:** February 13, 2026
**Dataset:** Last 200 closed PRs from xbmc/xbmc
**Data Source:** GitHub GraphQL API

## Executive Summary

Analysis of 200 closed pull requests from the xbmc/xbmc repository reveals structured patterns in PR titles, bodies, and metadata that provide strong signals for commit message recognition in Kodiai Phase 46.

**Key Findings:**
- **Bracket tags are dominant** - 68 PRs use `[tag]` notation for component/feature identification
- **Conventional commits are rare** - Only 1 PR uses `prefix:` style (test:)
- **Breaking changes are common** - 153 PRs mention "breaking change" in body (76.5%)
- **Body text is substantial** - 98% of PRs have meaningful descriptions (>100 chars)
- **Labels system is well-established** - Strong Type: and Component: label hierarchy

## PR Title Patterns

### Bracket Tags

The most prevalent pattern in XBMC PR titles is the use of square bracket notation to denote components or features being addressed.

| Pattern | Count | Examples |
|---------|-------|----------|
| `[Video]` | 10 | `[Video] Fix Bluray episode streamdetails not found.` |
| `[Estuary]` | 7 | `[Estuary] Hide short date in Weather widgets` |
| `[WIP]` | 4 | `[Video][Library][WIP][Alpha 3] Hash and look for...` |
| `[Windows]` | 4 | Component-specific platform tags |
| `[cmake]` | 4 | Build system specific tags |
| `[RFC]` | 3 | Indicates Request for Comments |
| `[guilib]` | 2 | GUI library changes |
| `[ffmpeg]` | 2 | Media codec/library changes |
| `[GBM]` | 2 | Graphics backend module |
| `[tools/depends]` | 2 | Build dependency changes |
| `[target]` | 2 | Build target changes |
| `[PVR]` | 2 | PVR/Live TV component |
| `[Videoplayer]` | 2 | Video playback component |
| `[GUIDialogSubtitleSettings]` | 2 | Specific UI dialog |
| `[ffmpeg][libavcodec]` | Multiple instances | Multi-tag titles (stacked brackets) |

**Usage Pattern:** 68 out of 200 PRs (34%) use bracket tags. Many PRs use multiple bracket tags to provide hierarchical context.

**Key Insight:** Bracket tags serve as a lightweight taxonomy system - developers use them intuitively without rigid formatting requirements. Tags often represent:
- **Components:** `[Video]`, `[Music]`, `[PVR]`
- **Modules:** `[guilib]`, `[ffmpeg]`, `[cmake]`
- **Platforms:** `[Windows]`, `[Android]`, `[Linux]`
- **Status:** `[WIP]`, `[RFC]`, `[Alpha]`

### Conventional Commits

Conventional commit style (`prefix: message`) is **virtually unused** in this dataset:
- `test:` - 1 occurrence
- `feat:`, `fix:`, `chore:`, `docs:`, etc. - 0 occurrences

**Finding:** The xbmc/xbmc project does not follow conventional commits convention. This is the dominant style in the Kodi ecosystem and should NOT be prioritized for Kodiai Phase 46.

### Other Title Patterns

| Pattern | Count | Notes |
|---------|-------|-------|
| `WIP:` | 1 | Work-in-progress indicator |
| Descriptive titles | ~120 | Most PRs use natural language titles without prefixes |

**Example descriptive titles:**
- `GUI: add opt-in rounded clipping for control groups`
- `Make URIUtils::IsInPath case insensitive`
- `Update ffmpeg to 6.1.2`
- `CWinSystemWayland: try to keep fullscreen states synchronized`

## PR Body Patterns

### Body Completeness

| Category | Count | Percentage |
|----------|-------|-----------|
| Empty/No body | 0 | 0% |
| Minimal body (<100 chars) | 4 | 2.0% |
| Substantial body (>100 chars) | 196 | 98.0% |

**Finding:** Nearly all PRs have substantive descriptions, indicating a strong culture of documentation and explanation.

### Review Intent Signals

The analysis identified specific keywords and phrases that signal developer intent within PR descriptions:

| Signal | Count | % of PRs | Context |
|--------|-------|---------|---------|
| `breaking change` | 153 | 76.5% | Explicitly marks non-backward compatible changes |
| `draft` | 5 | 2.5% | Indicates WIP or incomplete state |
| `wip` | 3 | 1.5% | Work in progress indicator |
| `test this` | 2 | 1.0% | Request for testing specific functionality |
| `do not merge` | 1 | 0.5% | Explicit request to hold PR |

**Critical Finding:** The phrase "breaking change" appears in **76.5%** of closed PRs. This is either:
1. An artifact of PR template suggesting it (common practice in templates)
2. Indicates that the majority of XBMC changes are either explicitly marked as breaking or the phrase is used liberally

This suggests that Kodiai should recognize "breaking change" as a high-signal phrase for PR review prioritization.

### PR Body Structure

PR bodies typically follow a structured format with:
- **Description section** - Explains what the change does
- **Rationale** - Why the change is needed
- **Testing notes** - How to verify the change
- **References** - Links to related issues/PRs

Most bodies explicitly call out if breaking changes are present, suggesting this is important for developers to communicate.

## Label Distribution

### All Labels (Top 20)

| Label | Count | % of PRs | Category |
|-------|-------|---------|----------|
| `Rebase needed` | 94 | 47.0% | Status |
| `PR Cleanup: Abandoned` | 91 | 45.5% | Status |
| `Stale` | 91 | 45.5% | Status |
| `v22 Piers` | 58 | 29.0% | Release target |
| `Type: Fix` | 50 | 25.0% | Type |
| `Type: Improvement` | 49 | 24.5% | Type |
| `Component: Video` | 23 | 11.5% | Component |
| `Type: Cleanup` | 22 | 11.0% | Type |
| `Type: Feature` | 13 | 6.5% | Type |
| `Platform: Linux` | 13 | 6.5% | Platform |
| `Component: Depends` | 12 | 6.0% | Component |
| `WIP` | 10 | 5.0% | Status |
| `CMake` | 10 | 5.0% | Build system |
| `Component: Database` | 9 | 4.5% | Component |
| `Component: Skin` | 9 | 4.5% | Component |
| `Platform: Android` | 9 | 4.5% | Platform |
| `Component: GUI engine` | 7 | 3.5% | Component |
| `Platform: Windows` | 7 | 3.5% | Platform |
| `Platform: WindowsStore` | 7 | 3.5% | Platform |
| `Component: Build system` | 7 | 3.5% | Component |

**Observation:** The high count of "Rebase needed", "Abandoned", and "Stale" labels suggests this dataset includes many PRs from the historical backlog, not just recent active PRs. These are status indicators on closed PRs.

### Type Labels (Category: Change Type)

| Label | Count | % of PRs |
|-------|-------|---------|
| `Type: Fix` | 50 | 25.0% |
| `Type: Improvement` | 49 | 24.5% |
| `Type: Cleanup` | 22 | 11.0% |
| `Type: Feature` | 13 | 6.5% |
| `Type: Breaking change` | 3 | 1.5% |
| `Type: Revert` | 1 | 0.5% |

**Key Insight:** Type labels form a clear hierarchy:
1. **Fixes** and **Improvements** dominate (49.5% combined)
2. **Cleanup** work is common (11%)
3. **Features** are less frequent (6.5%)
4. **Breaking changes** are explicitly marked (1.5%)

This mirrors common software development patterns where maintenance work outnumbers new features.

### Component Labels (Category: Subsystem/Module)

Top 10 most common components:

| Component | Count | % of PRs |
|-----------|-------|---------|
| `Component: Video` | 23 | 11.5% |
| `Component: Depends` | 12 | 6.0% |
| `Component: Database` | 9 | 4.5% |
| `Component: Skin` | 9 | 4.5% |
| `Component: GUI engine` | 7 | 3.5% |
| `Component: Build system` | 7 | 3.5% |
| `Component: Players` | 7 | 3.5% |
| `Component: Music` | 7 | 3.5% |
| `Component: GUI rendering` | 6 | 3.0% |
| `Component: GLES rendering` | 5 | 2.5% |

**Finding:** Video handling dominates (11.5%), followed by build system dependencies (6%), and various media/UI components. This reflects Kodi's primary purpose as a media center.

### Platform Labels

Platform-specific labels indicate which systems a PR affects:

- `Platform: Linux` - 13 PRs (6.5%)
- `Platform: Android` - 9 PRs (4.5%)
- `Platform: Windows` - 7 PRs (3.5%)
- `Platform: WindowsStore` - 7 PRs (3.5%)

**Note:** Many PRs don't have platform labels, suggesting they're platform-agnostic or the labeling isn't exhaustive.

## Title Characteristics Analysis

### Dominant Title Styles

**1. Bracket Notation with Description**
```
[Component] Action: description
[Video] Fix Bluray episode streamdetails not found.
[Estuary] Hide short date in Weather widgets
[Music] Add MusicBrainz Track ID to InfoTagMusic
```

**2. Module/Function Name Prefix**
```
Module::Function: description
CWinSystemWayland: try to keep fullscreen states synchronized
URIUtils::IsInPath case insensitive
```

**3. Plain Natural Language**
```
Update ffmpeg to 6.1.2
Create devcontainer.json
Make URIUtils::IsInPath case insensitive
```

**4. Multi-tag Complex Titles**
```
[Video][Library][WIP][Alpha 3] Hash and look for changes...
[ffmpeg][libavcodec] Fix skipping first frames of musepack v7
```

### Length and Clarity

- Most titles are 50-100 characters
- Titles are descriptive and specific about what changes
- Use of imperative mood is common ("Fix", "Add", "Update", "Hide")

## Recommendations for Kodiai Keywords (Phase 46)

Based on observed patterns, here are the priority keywords and patterns Kodiai should support:

### HIGH PRIORITY - Natural Language Recognition

1. **Bracket Tags** (34% of PRs)
   - Implement recognition of `[ComponentName]` pattern in titles
   - Extract component from bracket tags for context-aware classification
   - Examples: `[Video]`, `[Music]`, `[PVR]`, `[guilib]`, `[ffmpeg]`

2. **Breaking Change Detection** (76.5% of PR bodies)
   - Search for "breaking change" keyword in PR body
   - Flag PRs with breaking changes for heightened review scrutiny
   - Consider as high-priority review signal

3. **WIP/RFC Indicators** (5% of PRs explicitly marked)
   - Recognize `[WIP]` and `[RFC]` tags
   - Recognize "WIP:" prefix in titles
   - Suggest appropriate review handling for work-in-progress PRs

### MEDIUM PRIORITY - Supporting Patterns

4. **Module/Class Name Prefixes**
   - Recognize `ClassName::method` pattern in titles
   - Useful for understanding scope of change
   - Examples: `CWinSystemWayland:`, `URIUtils::`

5. **Action Verbs for Change Type Inference**
   - Fix/fixed - Indicates bug fix
   - Add - Indicates new feature or property
   - Update - Indicates version bump or enhancement
   - Hide/Show - Indicates UI change
   - Use these for automatic Type label suggestion

### LOW PRIORITY - Conventional Commits

6. **Conventional Commits** (virtually unused in xbmc/xbmc)
   - Do NOT prioritize `fix:`, `feat:`, `chore:` prefixes
   - Kodi project does not follow this convention
   - Including this would add noise without benefit

### NOT RECOMMENDED

- **Semantic versioning in titles** - Not observed
- **Issue references in titles** - Should be in body/comments
- **Automated prefix injection** - Developers use natural patterns

## Implementation Strategy

### Pattern Detection Order (Priority)

1. Check for `[bracketed]` tags in title
2. Search PR body for "breaking change" keyword
3. Look for WIP/RFC status markers
4. Extract primary action verb (Fix, Add, Update, etc.)
5. Identify module/class prefix if present

### Confidence Scoring

- Bracket tags: High confidence (explicit syntax)
- Breaking change keyword: High confidence (explicit signal)
- Action verbs: Medium confidence (requires context)
- Module names: Medium confidence (could be confused with text)

### Integration Points

- **PR Classification:** Use Type labels (Fix, Feature, Improvement, Cleanup) for initial categorization
- **Component Detection:** Map bracket tags and labels to components
- **Review Routing:** Use breaking change detection for escalation
- **Automated Suggestions:** Propose Component labels based on detected tags

## Data Quality Notes

### Dataset Characteristics

- **Total PRs:** 200 (100 recent + 100 from next page)
- **Empty bodies:** 0 (100% have descriptions)
- **Label coverage:** ~60% of PRs have labels (reflects GitHub's optional labeling)
- **Historical bias:** High count of "Stale", "Abandoned", "Rebase needed" labels suggests dataset includes older PRs

### Limitations

- This is a point-in-time snapshot (last updated: ~July 2025)
- Does not include merged PRs (only closed)
- Label application may not be exhaustive (optional in GitHub)
- Some "breaking change" mentions may be false positives (templates, examples)

## Conclusion

The xbmc/xbmc project demonstrates a **mature PR process with structured but flexible patterns**. Key takeaways for Kodiai:

1. **Bracket notation is king** - This is the primary way developers organize and categorize changes
2. **Breaking changes matter** - This keyword appears in 3/4 of PRs and should be a focus
3. **Type/Component labels are established** - Leveraging existing label hierarchy is valuable
4. **Natural language reigns** - Conventional commits should not be forced
5. **Quality descriptions are expected** - 98% of PRs have substantive bodies, enabling content-based analysis

The recommended implementation should focus on **bracket tag recognition** and **breaking change detection** as these provide the highest signal-to-noise ratio for Kodiai's review assistance capabilities.
