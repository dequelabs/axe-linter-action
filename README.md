# axe-linter-action

A GitHub Action to lint for any accessibility issues in your pull requests.

## Input

### `api_key`

**Required** Your API key for axe-linter.

### `axe_linter_url`

**Optional** The URL for the axe-linter API. Defaults to `https://axe-linter.deque.com`.

\* To request an API key for axe-linter, please visit [accessibility.deque.com/linter-contact-us](accessibility.deque.com/linter-contact-us). Once provisioned please visit [https://docs.deque.com/linter/1.0.0/en/axe-linter-api-key](https://docs.deque.com/linter/1.0.0/en/axe-linter-api-key) to get your API key.

## Example Usage

Create a file in your repository called `.github/workflows/axe-linter.yml` with the following contents:

```yaml
name: Lint for accessibility issues

on: [pull_request]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3
      - uses: dequelabs/axe-linter-action@v1
        with:
          api_key: ${{ secrets.AXE_LINTER_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```
