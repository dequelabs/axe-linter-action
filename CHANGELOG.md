# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [2.0.0](https://github.com/dequelabs/axe-linter-action/compare/v1.3.0...v2.0.0) (2026-06-16)

### ⚠ BREAKING CHANGES

- The action now runs on the Node 24 runtime. Self-hosted runners must provide Node 24 ([#88](https://github.com/dequelabs/axe-linter-action/issues/88)) ([3080ebc](https://github.com/dequelabs/axe-linter-action/commit/3080ebc280842907c35bad09cc24882a3a3ec6c5)).
- Pull request runs now lint every changed file. Earlier versions silently linted only the first page of results (~30 files); the action now pages through the full list, so existing pull requests may surface accessibility issues that previously went unreported. On push events — where GitHub caps the comparison at 300 files — it warns when that ceiling is reached so you know some files were skipped ([#118](https://github.com/dequelabs/axe-linter-action/issues/118)) ([034b780](https://github.com/dequelabs/axe-linter-action/commit/034b78036a4746b043c45b14f76e3ec7148c8a61)).

### Features

- Work behind corporate proxies and recover from transient failures. Requests to the axe-linter API now honor `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` and automatically retry on network errors and 408/429/500/502/503/504 responses with exponential backoff ([#115](https://github.com/dequelabs/axe-linter-action/issues/115)) ([5b075f3](https://github.com/dequelabs/axe-linter-action/commit/5b075f32ec91d58fd201b67bc4fb02010f3c4d2d)).
- Lint Liquid templates. `.liquid` files are now recognized and sent to the linter ([#95](https://github.com/dequelabs/axe-linter-action/issues/95)) ([fae620d](https://github.com/dequelabs/axe-linter-action/commit/fae620d841fb8e6fdb5029550bc475a62e53c30a)).

### Bug Fixes

- Skip oversized files instead of failing the run. Files too large for the axe-linter API's request cap are now filtered out and logged as a warning rather than triggering a 413 error; the threshold is 900,000 bytes, just under the API's 1 MB limit ([#111](https://github.com/dequelabs/axe-linter-action/issues/111), [#121](https://github.com/dequelabs/axe-linter-action/issues/121)) ([1d48977](https://github.com/dequelabs/axe-linter-action/commit/1d489774c493c8921b5838b8c74e46b5dd4409bd), [6618fd6](https://github.com/dequelabs/axe-linter-action/commit/6618fd6db4aa0e2f12354a8d5a7a4aa0fe98388e)).

## [1.3.0](https://github.com/dequelabs/axe-linter-action/compare/v1.2.0...v1.3.0) (2025-11-17)

### Features

- add links to GH annotations ([#82](https://github.com/dequelabs/axe-linter-action/issues/82)) ([e033b36](https://github.com/dequelabs/axe-linter-action/commit/e033b363144cdce2e28d4a4a9dd7f375c0ae4dd3))

## [1.2.0](https://github.com/dequelabs/axe-linter-action/compare/v1.1.0...v1.2.0) (2025-07-15)

**Note:** This release contains dependency updates.

## [1.1.0](https://github.com/dequelabs/axe-linter-action/compare/v1.0.0...v1.1.0) (2025-03-20)

### Features

- add filename and line number to error ([#60](https://github.com/dequelabs/axe-linter-action/issues/60)) ([943d86d](https://github.com/dequelabs/axe-linter-action/commit/943d86da9710318d858b418c86cd14c17bf9c0e5))

### Bug Fixes

- add debug flag when executing bash ([#35](https://github.com/dequelabs/axe-linter-action/issues/35)) ([467fcc5](https://github.com/dequelabs/axe-linter-action/commit/467fcc5c7b458fba3ad0dd81902719bad951bf8d))
- Skipping Empty Files ([#51](https://github.com/dequelabs/axe-linter-action/issues/51)) ([bd47f92](https://github.com/dequelabs/axe-linter-action/commit/bd47f92b8ae7cfbc3ce9a8e8df0836db1876b974))

## 1.0.0 (2024-08-05)

### Features

- feat: add ability to modify axe linter url (#16) (2022-12-07)

- feat: add axe linter GHA (#1) (2022-11-20)

- feat: update branding (2023-04-07)

### Bug Fixes

- fix: validate that axe-linter config exist and is not empty (#5) (2022-11-21)
