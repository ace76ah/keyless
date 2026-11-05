# Gate -1 spike notes

**Status: PASS — ALL TESTED TARGETS VALIDATED**

The owner tested the local mock with the official OpenAI Node SDK, the official Anthropic Node SDK, and the Aider CLI. All three successfully routed requests to the mock through the path-based base URL. The spike validates the proxy-with-base-URL-override approach for these tested clients. It does not validate credential storage, project-token authentication, production security, or every coding agent.

## Environment and owner-run tests

- Date: 2026-11-05
- Owner environment: macOS (exact OS build not recorded)
- Node version: v22.9
- OpenAI Node SDK: v4 (exact patch version not recorded)
- Anthropic Node SDK: official SDK (exact package version not recorded)
- Aider CLI: tested by the owner; exact version not recorded
- Cursor IDE: Free tier tested; custom OpenAI base URL returned a "Cursor Subscription Required" paywall error in the tested setup
- Cursor built-in models: Grok and Composer bypassed the custom base URL and routed through Cursor's cloud service in the tested setup
- GitHub Copilot: not tested; IDE interception is out of v1 scope
- Claude Code: not tested

## Results

| Test | Result | Notes |
|---|---|---|
| Mock starts and binds to loopback | Pass | Local mock listens on 127.0.0.1:8787. |
| OpenAI Node SDK v4 against mock | Pass | Custom `baseURL` set to `http://127.0.0.1:8787/c/openai/v1` with a dummy API key; SDK parsed the canned response without a schema error. Owner report records Node v22.9. |
| Anthropic Node SDK against mock | Pass | Custom `baseURL` set to `http://127.0.0.1:8787/c/anthropic` with dummy API key `placeholder-not-a-secret`; SDK accepted the mock's response schema. Exact SDK version was not recorded. |
| Aider CLI against mock | Pass | Owner configured Aider through CLI flags to use the mock as its OpenAI-compatible endpoint. Aider received and displayed the canned response. |
| Preferred alias carrier | Pass | Path prefix `/c/<alias>/...` worked with OpenAI SDK, Anthropic SDK and Aider. |
| Header alias | Pass at mock level | Generic fetch test still verifies `X-Keyless-Credential`; path prefix is the selected carrier for the first integration. |
| Cursor IDE custom endpoint | Blocked in tested setup | Cursor IDE Free tier blocked custom OpenAI base URLs. The owner's report identifies Pro tier or a CLI agent such as Aider as the available workaround in this setup. This is not a claim about every Cursor plan or version. |
| Claude Code App/Tool Mode | Pending | Not tested. |
| Claude Code Agent-Inference Mode | Pending | Not tested. |
| OpenAI-compatible SSE | Pass at mock level | Automated test confirms the first frame arrives before the final frame. The owner’s Aider test used buffered JSON. |
| Anthropic SSE | Pass at mock level | Automated test confirms the first frame arrives before the final frame; the owner’s Anthropic SDK test validates the canned response, not streaming. |
| Project-token authentication | Not tested | The owner SDK tests used dummy API keys. The proposed Keyless project-token header is a Gate 0 contract and still needs dedicated SDK/Aider tests. |
| Locked/error behavior and retry pattern | Unverified | Locked-vault behavior does not exist in the mock and must be specified and tested in Gate 0/implementation. |
| Agent attempts to edit local config/instructions | Not recorded | Observe during additional agent tests. |

## Limitations and v1 scope

- IDE-hosted agent interception is out of scope for v1. The Cursor Free-tier custom-endpoint test returned the subscription paywall; built-in Cursor models bypassed the custom base URL. No system-level packet interception or TLS interception will be attempted.
- GitHub Copilot was not tested and is not a v1 target. Do not generalize the Cursor observation to every IDE or plan.
- V1 targets direct SDK integrations and local CLI agents with custom base-URL support. Current owner-run compatibility evidence is OpenAI Node SDK v4, Anthropic Node SDK (exact version not recorded) and Aider CLI (exact version not recorded).
- Claude Code is not tested. Project-token header delivery is not tested; the SDK spike used dummy provider keys only.

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
- **Required `keyless use` output:** print concise agent setup instructions and proxy endpoint details; never print or write a provider credential. Exact text and any optional instruction file are defined in `docs/agent-ux.md`.
- **Is streaming required for the first useful demo?** Aider accepted buffered JSON in the owner test. Keep SSE in the protocol because it is likely needed for interactive production use; validate it with real SDKs and agents.
- **Error response that prevents repeated retries:** not verified. Define stable locked, denied, quota and unavailable errors in the protocol. A locked vault must fail fast with HTTP 423 and tell the agent to ask the user to run `keyless unlock`, not retry in a loop.
- **Project-token header:** the existing build plan reserves `Authorization: Bearer <project-token>` for Keyless and replaces it before upstream forwarding. This header was not part of the dummy-key spike tests and must be validated with both official SDKs and Aider.
- **Agent configuration changes:** not recorded during the owner’s Aider test. Capture this in subsequent agent runs.
- **Workflows supported by evidence:** OpenAI Node SDK v4, Anthropic Node SDK (version not recorded), and Aider CLI, all using the local mock and path-based routing. Cursor Free-tier custom endpoint use was blocked in the tested setup. Do not infer Claude Code or all Cursor-plan compatibility from these results.

## Gate -1 decision

- [x] **PASS:** OpenAI Node SDK, Anthropic Node SDK and Aider CLI completed local mock requests using the path-based alias route.
- [x] Cursor Free-tier limitation documented.
- [ ] Production project-token authentication, vault behavior and security: not evaluated by this mock.

Gate -1 is complete for the tested targets: OpenAI Node SDK, Anthropic Node SDK and Aider CLI. IDE-hosted inference and system-level interception are out of v1 scope. Gate 0 owns the project-token delivery contract, error behavior, vault/grant model and implementation requirements.

Owner test reports: November 5, 2026.
