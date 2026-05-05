# M053 Discussion Log

## Exchange — 2026-05-04T20:39:34.299Z

### Formatter

How should Kodiai know what formatter command to run for this first version?

- **Repo config command (Recommended)** — Default-off config supplies a formatter adapter/command, with XBMC using git-clang-format first.
- **Built-in XBMC adapter** — Fastest and safest for XBMC, but less reusable until a later adapter refactor.
- **Auto-detect tooling** — Kodiai scans repo files and guesses the formatter, which is convenient but riskier for a default-off first release.

**Selected:** Repo config command (Recommended)

### Posting

For the first version, should formatter suggestions publish directly when requested, or have a preview-only mode first?

- **Direct on request (Recommended)** — A trusted explicit mention posts the batched same-PR review immediately, capped by config.
- **Preview then post** — Kodiai first comments with a summary/dry-run and requires a second command to publish suggestions.

**Selected:** Direct on request (Recommended)

---
## Exchange — 2026-05-04T20:40:19.789Z

### Failures

We can go deep on formatter failure modes, or I can apply conservative defaults. Which do you prefer?

- **Use defaults (Recommended)** — I’ll define conservative failure behavior now: skip unsafe hunks, cap output, and post a small failure/skip notice only when no suggestions could be posted.
- **Go deep** — We’ll spend another round on exact behavior for command failures, partial mapping, caps, and GitHub API rejection.

**Selected:** Use defaults (Recommended)

---
## Exchange — 2026-05-04T20:55:56.653Z

### Quality

What quality bar should this milestone require before formatter suggestions are considered ready?

- **Strict proof (Recommended)** — Require deterministic fixture tests for diff parsing/mapping plus one live same-PR smoke proof before completion.
- **No live proof** — Ship with unit and fixture tests only; do live proof later after merge/deploy.
- **Dry-run gate** — Add an operator dry-run report first, then require live proof only after dry-run looks good.

**Selected:** Strict proof (Recommended)

---
## Exchange — 2026-05-04T21:57:51.070Z

### Depth Check

Did I capture the depth right?

- **Yes, you got it (Recommended)** — Proceed to requirements and roadmap using this understanding.
- **Not quite — let me clarify** — Pause planning and let you correct the model before anything is written.

**Selected:** Yes, you got it (Recommended)

---
