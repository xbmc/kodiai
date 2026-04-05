# M040: Graph-Backed Extensive Review Context

## Vision
Build a persistent structural graph for C++ and Python first — with TS/JS secondary — so Kodiai can compute blast radius, likely affected tests, and bounded graph-aware review context for extensive PRs without regressing normal review cost.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Graph Schema and C++/Python Structural Extraction | high | — | ✅ | After this, Kodiai can index a fixture C++ or Python repo into dedicated graph tables and inspect persisted nodes/edges for files, symbols, imports/includes, calls, and probable test relationships. |
| S02 | Blast-Radius Queries and Graph-Aware Review Selection | medium | S01 | ⬜ | After this, Kodiai can take a large fixture PR and show graph-ranked impacted files, probable dependents, and likely tests that today's file-risk scorer alone would miss. |
| S03 | Bounded Prompt Integration, Bypass, and Validation Gate | medium | S01, S02 | ⬜ | After this, a large C++ or Python PR gets a bounded graph context section and optional second-pass validation for graph-amplified findings, while a trivial PR bypasses graph overhead cleanly. |
