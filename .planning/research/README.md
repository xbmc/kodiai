# XBMC PR Keywords Research - Phase 46 Foundation

This directory contains comprehensive research into PR metadata patterns from the xbmc/xbmc repository, providing the foundation for Kodiai Phase 46 keyword recognition implementation.

## Documents

### 1. [xbmc_pr_keywords_analysis.md](xbmc_pr_keywords_analysis.md)
**Comprehensive Analysis Report** - 325 lines

The main research document containing:
- Executive summary of findings
- Detailed breakdown of PR title patterns
- Analysis of PR body patterns
- Complete label distribution
- Data quality notes and limitations
- Recommendations for Kodiai

**Use this for:** Understanding the full research methodology and findings

### 2. [PHASE_46_KEYWORD_RECOMMENDATIONS.md](PHASE_46_KEYWORD_RECOMMENDATIONS.md)
**Implementation Guide** - 400+ lines

Actionable recommendations for Phase 46 development including:
- Priority-ranked features (1-6)
- Detailed implementation rules for each feature
- Code examples and regex patterns
- Testing strategies
- Configuration examples
- Development roadmap

**Use this for:** Planning and implementing Phase 46 features

### 3. [xbmc_pr_keywords_analysis.json](xbmc_pr_keywords_analysis.json)
**Raw Data** - Machine-readable JSON

Structured analysis results including:
- Bracket tag distribution
- Conventional commit patterns
- Body completeness metrics
- Review signal keywords
- Type and Component label frequencies

**Use this for:** Programmatic access to analysis data

## Quick Summary

### Dataset
- **200 closed PRs** from xbmc/xbmc repository
- **Analysis date:** February 13, 2026
- **Data source:** GitHub GraphQL API

### Top Findings

| Finding | Value | Priority |
|---------|-------|----------|
| Bracket tags `[Component]` | 34% of PRs | **HIGH** |
| Breaking change keyword | 76.5% of PRs | **HIGHEST** |
| WIP/RFC markers | 7.5% of PRs | **MEDIUM-HIGH** |
| Conventional commits | 0.5% of PRs | **NOT RECOMMENDED** |

### Implementation Priority

1. **Phase 46.1:** Bracket tag recognition + Breaking change detection
2. **Phase 46.2:** WIP/RFC markers + Action verb detection
3. **Phase 46.3:** Module prefix detection + Polish

## Key Insights

### What Works
- **Bracket notation is king** - Natural, lightweight syntax developers already use
- **Breaking changes matter** - 3 out of 4 PRs mention this explicitly
- **Strong documentation culture** - 98% of PRs have substantive descriptions

### What Doesn't Work
- **Conventional commits** - Abandoned in xbmc/xbmc (only 1 example in 200)
- **Semantic versioning** - Not observed in PR titles
- **Automated prefix injection** - Would violate developer conventions

## Research Quality

### Strengths
- Large dataset (200 PRs)
- Real-world patterns from active project
- Clear, quantifiable metrics
- Multiple validation approaches

### Limitations
- Point-in-time snapshot (July 2025 data)
- Closed PRs only (not merged PRs)
- Optional labels not exhaustive
- Some PR templates inflate certain metrics

## Next Steps

### For Phase 46 Planning
1. Read PHASE_46_KEYWORD_RECOMMENDATIONS.md for implementation details
2. Use provided regex patterns and code examples
3. Reference xbmc_pr_keywords_analysis.json for test case data
4. Consult xbmc_pr_keywords_analysis.md for any clarification

### For Phase 46 Development
1. Implement Priority 1 features (bracket tags + breaking changes)
2. Add unit tests from Testing Strategy section
3. Verify against example PRs in analysis document
4. Validate with integration tests before deployment

### For Phase 46 Testing
- 36 sample PRs are cited in the analysis with numbers and titles
- Use these for regression testing and validation
- Verify false positive rates match expectations

## Files Organization

```
research/
├── README.md (this file)
├── xbmc_pr_keywords_analysis.md (detailed analysis)
├── xbmc_pr_keywords_analysis.json (machine-readable data)
├── PHASE_46_KEYWORD_RECOMMENDATIONS.md (implementation guide)
├── ARCHITECTURE.md (codebase architecture)
├── FEATURES.md (feature analysis)
├── PITFALLS.md (known issues)
├── STACK.md (technology stack)
└── SUMMARY.md (project summary)
```

## Questions?

Refer to the detailed analysis documents above. All findings are backed by data from real PRs with specific examples and citations.

---
**Generated:** February 13, 2026
**Analysis Tool:** GitHub GraphQL API + Python data analysis
**Format:** Markdown with embedded JSON data
