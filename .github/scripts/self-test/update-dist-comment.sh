#!/usr/bin/env bash
set -euo pipefail

marker='<!-- axe-linter-action:stale-dist -->'
body="${marker}
\`dist/\` does not match a fresh build of this branch. Run \`pnpm install --frozen-lockfile && pnpm build\`, then commit the updated \`dist/\`."

comment_id="$(gh api --paginate "repos/${GH_REPO}/issues/${PR_NUMBER}/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"${marker}\"))) | .id" |
  head -n 1)"

if [[ "${DIST_STALE}" == "true" ]]; then
  if [[ -n "${comment_id}" ]]; then
    gh api --method PATCH "repos/${GH_REPO}/issues/comments/${comment_id}" -f body="${body}" > /dev/null
  else
    gh api --method POST "repos/${GH_REPO}/issues/${PR_NUMBER}/comments" -f body="${body}" > /dev/null
  fi
elif [[ -n "${comment_id}" ]]; then
  gh api --method DELETE "repos/${GH_REPO}/issues/comments/${comment_id}"
fi
