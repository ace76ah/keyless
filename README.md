<p align="center">
  <img src="assets/keyless-banner.jpg" alt="Keyless — Give your AI the keys. Never give it the secrets." width="100%">
</p>

# Keyless

**Give your AI the keys. Never give it the secrets.**

<p align="center">
  <img src="assets/keyless-logo.jpg" alt="Keyless infinity-key emblem" width="112">
</p>

I got tired of copying API keys into projects and then wondering where they would end up. Keyless is my attempt at making that part of building software less messy.

The idea is to keep credentials in a local encrypted vault and let tools use approved credentials through a small local service. The service, not the agent, attaches the real credential when a request is sent to a provider.

There is an important limit to that promise: a process running as the same operating-system user may still be able to use the local service, inspect files it can access, or read process memory. Keyless is meant to reduce accidental exposure and limit the blast radius. It is not a sandbox for a fully compromised machine or a malicious process running as you.

## Where this repo is right now

**Status: Gate 0 — protocol contract.**

Gate -1 is complete. The local mock's path-based base-URL routing was validated by the owner with:

- **OpenAI Node SDK v4** — custom `baseURL` worked and the SDK accepted the canned response.
- **Anthropic Node SDK** — custom `baseURL` worked and the SDK accepted the canned response.
- **Aider CLI** — routed an OpenAI-compatible request to the mock and displayed the response.

The selected alias format is the URL path prefix:

```
http://127.0.0.1:<port>/c/<alias>/...
```

See [the spike notes](docs/spike-notes.md) for the tested versions, the Cursor findings and the remaining limitations.

## V1 integration scope

Keyless v1 targets **direct SDK integrations** and **CLI coding agents** that can be configured to use a custom API base URL. OpenAI Node SDK, Anthropic Node SDK and Aider have passed the mock compatibility test. Claude Code and other CLI agents remain untested.

IDE-hosted agent interception is out of scope for v1. In the owner's Cursor Free-tier test, the custom OpenAI API toggle could be enabled, but requests returned a **Cursor Subscription Required** paywall error. When a built-in Cursor model such as Grok or Composer was selected, the request bypassed the custom base URL and went through Cursor's own cloud service instead. This is the observed behavior in the tested setup, not a claim about every plan or IDE.

GitHub Copilot is also outside the v1 integration scope; it was not tested in this spike. System-level packet interception is a non-goal. Keyless will not attempt to capture or reroute traffic from IDEs that do not expose a supported custom endpoint.

These tests validate base-URL routing and mock response compatibility. They do **not** validate the production Keyless project-token header, credential injection, vault behavior, or production security.

## The mock

The mock server remains deliberately small. It:

- accepts a fake `openai` or `anthropic` credential alias;
- supports both path and header aliases so the two carriers can be compared;
- returns canned provider-shaped responses, including a small SSE demo;
- binds to `127.0.0.1` by default;
- does not store, decrypt, attach, or forward credentials;
- does not make requests to OpenAI, Anthropic, or any other upstream service.

**Do not put a real API key in this spike.** The sample SDK scripts use obviously fake placeholders. The mock ignores them.

## Run it

Node.js 22.9 or newer is required.

```bash
npm run spike
```

The mock listens on `http://127.0.0.1:8787` by default. Change the port with `KEYLESS_SPIKE_PORT`.

In another terminal:

```bash
curl http://127.0.0.1:8787/health
```

Try the preferred path alias:

```bash
curl -i http://127.0.0.1:8787/c/openai/v1/responses \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer not-a-real-key' \
  -d '{"model":"gpt-4.1-mini","input":"hello from the local spike"}'
```

The header alias is still available for comparison:

```bash
curl -i http://127.0.0.1:8787/v1/messages \
  -H 'content-type: application/json' \
  -H 'x-keyless-credential: anthropic' \
  -H 'x-api-key: not-a-real-key' \
  -d '{"model":"claude-test","max_tokens":20,"messages":[{"role":"user","content":"hello"}]}'
```

Both examples return mock data. They do not call a provider.

## Run the checks

```bash
npm test
npm run check
```

## Gate 0: design specifications

The first Gate 0 specifications are now in the repository:

- [HTTP protocol](docs/protocol.md) — routes, project token, errors, streaming and cancellation.
- [Agent UX](docs/agent-ux.md) — exact `keyless use` output, token-file handling and SDK/CLI setup.
- [V1 scope](docs/scope.md) — supported integrations, commands and non-goals.
- [Threat model](docs/threat-model.md) — security objectives, trust boundaries and limitations.
- [Vault format](docs/vault-format.md) — encrypted container, Argon2id bounds, AEAD and atomic writes.
- [Approval flow](docs/approval.md) — per-OS approval, grant diff binding and reveal.
- [Network rules](docs/network.md) — path normalization, pinned DNS/TLS, headers and redirects.
- [JSON schemas](schemas/) — project request, vault-held grant and built-in provider definitions.

See the [Gate 0 project-token validation plan](docs/gate0-test-plan.md) and executable reference contract harness in `test/project-token-contract.test.mjs`. The harness is a protocol fixture, not production authentication or proof of SDK compatibility.

These are Gate 0 design drafts, not implemented features. Project-token delivery, SDK header precedence, token revocation, OS approval and pinned-IP TLS still require implementation tests and an external human security review.

## What is not built yet

No encrypted vault, credential storage, grant system, human approval, daemon, production network client, or real upstream forwarding is included in this spike. IDE-agent interception and system-level packet interception are also out of scope for v1.

See the [Gate -1 runbook](docs/spike-runbook.md), [spike notes](docs/spike-notes.md) and [current decisions](DECISIONS.md).

## Support

For project support, email [contact@aahmedhussa.in](mailto:contact@aahmedhussa.in).

This is an early experiment. I would rather find out that the workflow needs changing now than build a lot of infrastructure around the wrong interface.
