# M039: Review Output Hardening — Intent Parsing + Claude Usage Visibility

## Vision
Harden two already-shipped review output surfaces so they reflect real signals truthfully: fix PR body template stripping so boilerplate cannot trigger false breaking-change intent, and change the Claude usage display to show percent-left with a truthful fallback when the SDK does not emit rate-limit data.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | PR Template Stripping Hardening + xbmc Fixture | medium | — | ✅ | After this: a PR body containing a `## Types of change` section with Breaking change checkbox text no longer triggers `breaking change in body`; a plain-prose `This is a breaking change` body still does. |
| S02 | Claude Usage Display — Percent-Left + Truthful Fallback | low | S01 | ✅ | After this: Review Details shows `25% of seven_day limit remaining | resets ...` when utilization=0.75; the usage line is absent when usageLimit is undefined. |
