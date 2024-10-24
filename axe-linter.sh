#! /bin/bash

set -xe

throw() {
  echo "Error: $*">&2
  exit 1
}

[ -z "$API_KEY" ] && throw "API_KEY is required"

Files="$CHANGED_FILES"
ApiKey="$API_KEY"
AxeLinterUrl="$AXE_LINTER_URL"
FoundErrors="0"
LinterConfig={}

if [ -z "$AxeLinterUrl" ]; then
  AxeLinterUrl="https://axe-linter.deque.com"
fi

# Trim trailing slash
AxeLinterUrl="${AxeLinterUrl%/}"

if [ -f axe-linter.yml ]; then
  CheckLinterConfig="$(yq axe-linter.yml)"
  if [ -n "$CheckLinterConfig" ]; then
    LinterConfig="$(yq -o=json axe-linter.yml)"
  fi
fi

for File in $Files; do
  FileContents="$(cat "$File")"

  if [ -z "$FileContents" ] || [ "$(echo "$FileContents" | tr -d '[:space:]')" = "" ]; then
    echo "::debug::Skipping empty file $File"
    continue
  fi

  RequestBody=$(
    jq \
      --null-input \
      --arg Source "$FileContents" \
      --arg Filename "$File" \
      --argjson Config "$LinterConfig" \
      '{ "source": $Source, "filename": $Filename, "config": $Config }'
  )

  Response=$(
    curl \
      --silent \
      --request POST \
      --url "$AxeLinterUrl/lint-source" \
      --header "content-type: application/json" \
      --header "authorization: $ApiKey" \
      --data "${RequestBody}"
  )

  if [ $(echo "$Response" | jq 'has("error")') = "true" ]; then
    $(echo "$Response" | jq -r '.error')
    exit 1
  fi
  ErrorCount=$(echo "$Response" | jq '.report.errors | length')
  if [ "$ErrorCount" != "0" ]; then
    ((FoundErrors += ErrorCount))
  fi

  echo "$Response" |
    jq -r --compact-output '.report.errors[] | .ruleId + " " + (.lineNumber|tostring) + " " + (.column|tostring) + " " + (.endColumn|tostring) + " " + .description' |
    while read -r RuleId Line Column EndColumn Description; do
      echo "::error file=$File,line=$Line,col=$Column,endColumn=$EndColumn,title=Axe Linter::$RuleId - $Description"
    done
done

echo "::debug::Found $FoundErrors errors"

if [ "$FoundErrors" != "0" ]; then
  exit 1
fi
