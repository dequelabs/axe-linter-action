# axe-linter-action

A GitHub Action to lint for any accessibility issues in your pull requests.

## Input

### `api_key`

**Required** Your API key for axe-linter.

### `axe_linter_url`

**Optional** The URL for the axe-linter API. Defaults to `https://axe-linter.deque.com`.

\* To request an API key for axe-linter, please visit [accessibility.deque.com/linter-contact-us](https://accessibility.deque.com/linter-contact-us). Once provisioned please visit [https://docs.deque.com/linter/1.0.0/en/axe-linter-api-key](https://docs.deque.com/linter/1.0.0/en/axe-linter-api-key) to get your API key.

## Example Usage

Create a file in your repository called `.github/workflows/axe-linter.yml` with the following contents:

```yaml
name: Lint for accessibility issues

on:
  - pull_request

concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}
  cancel-in-progress: true # Cancel things if new events come in to conserve resources.

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read # Required to read the contents of the pull request
      pull-requests: read # Required to read the pull request
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6
      - name: Run Axe Linter
        uses: dequelabs/axe-linter-action@<commit-sha> # v2.x.y
        with:
          api_key: ${{ secrets.AXE_LINTER_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Pinning the action version

The examples above pin the action to a full-length commit SHA, with a trailing
comment noting the human-readable version it corresponds to. This is the
recommended approach for supply-chain safety — the action you run can never
change underneath you:

```yaml
- uses: dequelabs/axe-linter-action@<commit-sha> # v2.x.y
```

Replace `<commit-sha>` with the SHA for the release you want from the
[releases](https://github.com/dequelabs/axe-linter-action/releases) or
[tags](https://github.com/dequelabs/axe-linter-action/tags) page, and let
[Dependabot](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot)
keep the pin up to date for you.

## Limitation

There is a limitation on the amount of annotations that can be made per step.

- 10 warning annotations
- 10 error annotations

If there are more errors, they will not be reported. If you would like to view the errors please view the action logs.

Additional information can be found in [this GitHub discussion](https://github.com/orgs/community/discussions/26680).

Individual files larger than 900,000 bytes are skipped and logged as a warning. The axe-linter API has a 1 MB request size cap, so oversized files are filtered out pre-emptively to avoid 413 server request errors.
