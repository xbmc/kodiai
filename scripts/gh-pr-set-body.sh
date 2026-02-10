#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/gh-pr-set-body.sh --repo owner/repo <pr-number> < body.md

Purpose:
  Update a PR body using the GitHub API while preserving real newlines.

Example:
  bash scripts/gh-pr-set-body.sh --repo xbmc/kodiai 123 <<'EOF'
  ## Issues
  - ...

  ## Fix
  - ...

  ## Tests
  - bun test
  EOF
EOF
}

repo=""
if [[ ${1:-} == "--repo" ]]; then
  repo="${2:-}"
  shift 2
fi

pr_number="${1:-}"
if [[ -z "$repo" || -z "$pr_number" ]]; then
  usage >&2
  exit 2
fi

if [[ -t 0 ]]; then
  echo "Error: expected PR body on stdin." >&2
  usage >&2
  exit 2
fi

body="$(cat)"
gh api -X PATCH "repos/${repo}/pulls/${pr_number}" -f body="$body" >/dev/null
