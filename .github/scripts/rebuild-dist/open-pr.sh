#!/usr/bin/env bash
set -euo pipefail

branch='automation/rebuild-dist'
title='chore: rebuild dist'
body="Rebuilds \`dist/\` so it matches a fresh build of \`main\` at ${GITHUB_SHA}.

No QA Required"

gh auth setup-git
login="$(gh api user --jq '.login')"
user_id="$(gh api user --jq '.id')"
git config user.name "${login}"
git config user.email "${user_id}+${login}@users.noreply.github.com"

git switch --create "${branch}"
git add --all -- dist
git commit --message "${title}"
git push --force origin "HEAD:refs/heads/${branch}"

pr_number="$(gh pr list --head "${branch}" --base main --state open --json number --jq '.[0].number // empty')"

if [[ -n "${pr_number}" ]]; then
  gh pr edit "${pr_number}" --body "${body}"
else
  gh pr create --base main --head "${branch}" --title "${title}" --body "${body}"
fi
