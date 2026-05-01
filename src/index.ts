import * as core from '@actions/core'
import { EnvHttpProxyAgent, RetryAgent, setGlobalDispatcher } from 'undici'
import run from './run.ts'

// Set a retrying, proxy-aware global dispatcher for all fetch() calls.
//
// EnvHttpProxyAgent reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY from the env so
// runners behind a corporate proxy work without code changes.
//
// RetryAgent makes up to 5 total attempts on network errors and 408/429/5xx
// responses, with 2x exponential backoff starting at 300ms (capped at 4s):
//
//   ├─ attempt 1   (immediate)
//   │    wait 300ms
//   ├─ attempt 2
//   │    wait 600ms
//   ├─ attempt 3
//   │    wait 1.2s
//   ├─ attempt 4
//   │    wait 2.4s
//   └─ attempt 5   → throw if still failing
//
//   ~4.5s of total backoff before giving up. 429 responses honor Retry-After.
//
// POST is added to the retried methods because undici excludes it by default;
// it's safe here since the lint API is idempotent (same source → same result).
setGlobalDispatcher(
  new RetryAgent(new EnvHttpProxyAgent(), {
    maxRetries: 4,
    minTimeout: 300,
    maxTimeout: 4000,
    timeoutFactor: 2,
    methods: ['POST', 'GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE'],
    statusCodes: [408, 429, 500, 502, 503, 504]
  })
)

run(core)
