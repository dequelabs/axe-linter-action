#!/usr/bin/env bash
set -euo pipefail

if [[ -n "$(git status --porcelain --untracked-files=all -- dist)" ]]; then
  echo "stale=true" >> "$GITHUB_OUTPUT"
  echo "::notice::dist/ differs from a fresh build."
else
  echo "stale=false" >> "$GITHUB_OUTPUT"
fi
