#!/bin/bash

# only run the npm build script for each workspace directory that has changed files
function run_build {
  # convert multiline string into array
  # @see https://stackoverflow.com/questions/24628076/convert-multiline-string-to-array
  local IFS=$'\n'
  local lines=($1)
  local i

  # get only the unique values from an array
  # `lines[$i]%%/*` gets the substring up to the first '/'. so `semantic-pr-footer-v1/src/run.ts` becomes `semantic-pr-footer-v1`
  # @see https://www.baeldung.com/linux/bash-unique-values-arrays
  unique_dirs=($(for ((i = 0; i < ${#lines[@]}; i++)); do echo "${lines[$i]%%/*}"; done | sort -u))

  for dir in "${unique_dirs[@]}"; do
    yarn build -w "$dir"
  done
}

cd "$(dirname -- "$0")/../."
files=$(git diff HEAD~1 --name-only --relative)
if [ "$files" != "" ]; then
  run_build "$files"
fi

git add .
