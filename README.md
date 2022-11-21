# axe-linter-action

A GitHub Action to lint for any accessibility issues in your pull requests.

## Input

### `api_key`

**Required** Your API key for axe-linter.


## Example Usage

Create a file in your repository called `.github/workflows/axe-linter.yml` with the following contents:

```yaml
name: Lint for accessibility issues

on: [pull_request]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2
      - uses: dequelabs/axe-linter-action@v1
        with:
          api_key: ${{ secrets.AXE_LINTER_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```
