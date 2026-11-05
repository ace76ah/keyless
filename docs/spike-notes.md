# Gate -1 spike notes

**Status: PARTIAL — LOCAL MOCK CHECKS PASS; OWNER AGENT TESTS PENDING**

These notes record only what was actually tested in the build environment. Automated checks are not the same as completing Gate -1 with the owner's installed agents.

## Environment

- Date: 2026-11-05
- OS: Linux build container (owner's macOS/desktop environment not tested)
- Node version: v22.16.0
- Keyless commit tested: 1b29168 (initial Gate -1 commit)
- Cursor version: Not available in build environment
- Claude Code version: Not available in build environment
- OpenAI SDK version (if tested): Not tested; optional npm install timed out
- Anthropic SDK version (if tested): Not tested; optional npm install timed out

## Results

| Test | Result | Notes |
|---|---|---|
| Mock starts and binds to loopback | Pass | Started at 127.0.0.1:8787; health endpoint confirmed mock-only mode. |
| Path alias with OpenAI-shaped request | Pass | `node examples/fetch/path-alias.mjs` returned canned HTTP 200. |
| Header alias with Anthropic-shaped request | Pass | `node examples/fetch/header-alias.mjs` returned canned HTTP 200. |
| OpenAI SDK against mock | Pending | Optional SDK install timed out; no SDK result claimed. |
| Anthropic SDK against mock | Pending | Optional SDK install timed out; no SDK result claimed. |
| Cursor App/Tool Mode | Pending | Must be run with owner's local Cursor installation. |
| Claude Code App/Tool Mode | Pending | Must be run with owner's local Claude Code installation. |
| Claude Code Agent-Inference Mode | Pending | Separate workflow; not tested. |
| OpenAI-compatible SSE | Pass | Automated test confirms the first frame arrives before the final frame. |
| Anthropic SSE | Pass | Automated test confirms the first frame arrives before the final frame. |
| Locked/error behavior and retry pattern | Partial | Missing alias, unknown alias, malformed JSON and unsupported route return stable errors; locked-vault behavior is not part of the mock. |
| Agent attempts to edit local config/instructions | Pending | Must be observed with the owner's actual agents. |

## Observations

- `npm ci` completed successfully with no dependencies to install.
- `npm audit --audit-level=high` reported zero vulnerabilities for the current dependency-free spike.
- `npm run check` passed all 16 tests.
- Both fetch examples were run against the local mock and returned HTTP 200.
- The mock reported `credentialsStored: false` and `upstreamCalls: false` on its health endpoint.
- The optional install of `openai` and `@anthropic-ai/sdk` did not complete within the build environment's command timeout. SDK compatibility remains unverified.
- Cursor and Claude Code were not available inside this build environment. No owner-agent workflow has been claimed as passed.
- The mock binds to IPv4 loopback (`127.0.0.1`) only. Although the Host convenience allowlist includes `localhost`, the spike does not bind `::1`; production network design must explicitly support and test both loopback families.
- Browser-origin requests are unsupported. Non-`null` `Origin` values are rejected; no CORS support is claimed.
- The mock sets explicit five-second request and header timeouts, checked at one-second intervals. Stalled request bodies and incomplete headers are closed by Node's incomplete-request timeouts. Oversized bodies receive a 413 response and the request socket is then closed instead of draining the remaining body.
- Verbose successful-request logs include a monotonic per-process request ID and continue to omit request bodies and credentials.

Separate interpretation: the local mock is ready for the owner-run Gate -1 checks. This is not a production proxy and does not establish credential security.

## Protocol implications

- Preferred alias carrier:
- Required `keyless use` output:
- Is streaming required for the first useful demo?
- Error response that prevents repeated retries:
- Does the agent modify project configuration or instruction files?
- Which workflows are supported by evidence?

## Gate -1 decision

- [ ] Pass: two real agent workflows complete one local round-trip.
- [ ] Conditional pass: workflow works with documented limitations and revised scope.
- [ ] Fail: revise the product workflow before writing the protocol.

Reviewer / owner:
Date:
Commit:
