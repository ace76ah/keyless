# Gate -1 spike notes

**Status: PASS (SCOPED) — OPENAI NODE SDK + AIDER CLI ROUTING VALIDATED**

The owner tested the mock with the official OpenAI Node SDK and Aider CLI. Both successfully routed requests to the local mock through the path-based base URL. This validates the central proxy-with-base-URL-override hypothesis for the tested workflows. It does not validate credential storage, production security, or every coding agent.

## Environment and owner-run tests

- Date: 2026-11-05
- Owner environment: macOS (exact OS build not recorded)
- Node version: v22.9
- OpenAI Node SDK: v4 (exact patch version not recorded)
- Aider CLI: tested by the owner; exact version not recorded
- Cursor IDE: Free tier tested; custom OpenAI base URL was blocked in the tested setup
- Claude Code: not tested
- Anthropic SDK: not tested

## Results

| Test | Result | Notes |
|---|---|---|
| Mock starts and binds to loopback | Pass | Local mock listens on 127.0.0.1:8787. |
| OpenAI Node SDK v4 against mock | Pass | Custom `baseURL` set to `http://127.0.0.1:8787/c/openai/v1` with a dummy API key; SDK parsed the canned response without a schema error. Owner report records Node v22.9. |
| Aider CLI against mock | Pass | Owner configured Aider through CLI flags to use the mock as its OpenAI-compatible endpoint. Aider received and displayed the canned response. |
| Preferred alias carrier | Pass | Path prefix `/c/<alias>/...` worked with both the OpenAI SDK and Aider. |
| Header alias | Pass | Generic fetch test still verifies `X-Keyless-Credential`; it is not the selected carrier for the first integration. |
| Cursor IDE custom endpoint | Blocked in tested setup | Cursor Free tier blocked custom OpenAI base URLs. This is a tested account/tier limitation, not a claim about every Cursor plan or version. |
| Claude Code App/Tool Mode | Pending | Not tested. |
| Claude Code Agent-Inference Mode | Pending | Not tested. |
| OpenAI-compatible SSE | Pass at mock level | Automated test confirms the first frame arrives before the final frame. The owner’s Aider test used buffered JSON. |
| Anthropic SSE | Pass at mock level | Automated test confirms the first frame arrives before the final frame; no Anthropic SDK or agent compatibility is claimed. |
| Locked/error behavior and retry pattern | Unverified | Locked-vault behavior does not exist in the mock and must be specified and tested in Gate 0/implementation. |
| Agent attempts to edit local config/instructions | Not recorded | Observe during additional agent tests. |

## Automated mock checks

- `npm ci` completed successfully with no runtime dependencies.
- `npm audit --audit-level=high` reported zero vulnerabilities for the dependency-free spike.
- `npm run check` passed all 16 tests.
- The mock reports `credentialsStored: false` and `upstreamCalls: false` on its health endpoint.
- Tests cover path/header aliases, Host rejection, non-null Origin rejection, request/header timeouts, oversized-body socket closure, and incremental SSE frame delivery.
- The mock binds to IPv4 loopback (`127.0.0.1`) only. Production network design must explicitly support and test both `127.0.0.1` and `::1`.
- Browser-origin requests are unsupported. Non-`null` `Origin` values are rejected; no CORS support is claimed.
- Verbose successful-request logs include a monotonic per-process request ID and omit request bodies and credentials.

## Gate 0 inputs

- **Preferred alias carrier:** path prefix, `/c/<alias>/...`.
- **Required `keyless use` output:** not determined by the SDK/Aider test; define in the agent UX contract.
- **Is streaming required for the first useful demo?** Aider accepted buffered JSON in this test. Keep SSE in the protocol because streaming is likely needed for interactive production use, but verify provider/agent expectations explicitly.
- **Error response that prevents repeated retries:** not verified. Define stable locked, denied, quota and unavailable errors in the protocol and test retry behavior.
- **Agent configuration changes:** not recorded during the owner’s Aider test. Capture this in subsequent agent runs.
- **Workflows supported by evidence:** OpenAI Node SDK v4 via custom base URL and Aider CLI via its OpenAI-compatible endpoint. Do not infer Claude Code, Anthropic SDK, or all Cursor plans from these results.

## Gate -1 decision

- [x] Pass (scoped): the mock's path-based base-URL routing works with the OpenAI Node SDK v4 and Aider CLI in owner-run tests.
- [ ] Broader compatibility: test additional agents and Anthropic SDKs before claiming broad support.
- [ ] Production security: not evaluated by this mock.

The Gate -1 compatibility question is closed for the tested path. Gate 0 now owns the protocol contract and the remaining compatibility/error questions.

Owner test report: November 5, 2026.
