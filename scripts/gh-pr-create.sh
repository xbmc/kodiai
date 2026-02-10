#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/gh-pr-create.sh [gh pr create args...] < body.md

Purpose:
  Create a PR with a body passed via --body-file to avoid literal "\\n" escaping bugs.

Examples:
  bash scripts/gh-pr-create.sh --repo xbmc/kodiai --base main --head my-branch --title "My PR" <<'EOF'
  ## Issues
  - ...

  ## Fix
  - ...
  EOF
EOF
}

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

for arg in "$@"; do
  case "$arg" in
    --body|--body=*)
      echo "Error: do not pass --body; provide body on stdin (this script uses --body-file)." >&2
      exit 2
      ;;
  esac
done

if [[ -t 0 ]]; then
  echo "Error: expected PR body on stdin." >&2
  usage >&2
  exit 2
fi

tmpfile="$(mktemp)"
trap 'rm -f "$tmpfile"' EXIT

cat >"$tmpfile"

exec gh pr create "$@" --body-file "$tmpfile"
