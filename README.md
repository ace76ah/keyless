# Keyless

**Give your AI the keys. Never give it the secrets.**

I got tired of copying API keys into projects and then wondering where they would end up. Keyless is my attempt at making that part of building software less messy.

The idea is to keep credentials in a local encrypted vault and let tools use approved credentials through a small local service. The service, not the agent, attaches the real credential when a request is sent to a provider.

There is an important limit to that promise: a process running as the same operating-system user may still be able to use the local service, inspect files it can access, or read process memory. Keyless is meant to reduce accidental exposure and limit the blast radius. It is not a sandbox for a fully compromised machine or a malicious process running as you.

## Where this repo is right now

**Status: Gate 0 — protocol contract.**

Gate -1 validated the mock's path-based base-URL routing with the OpenAI Node SDK v4 and Aider CLI in owner-run tests. Both reached the local mock and accepted its canned response. The preferred alias carrier is now the URL path prefix:

```
http://127.0.0.1:8787/c/<alias>/v1/...
```

The Cursor IDE Free-tier test in the owner's setup blocked custom OpenAI base URLs. Claude Code and Anthropic SDK compatibility have not yet been tested. See [the spike notes](docs/spike-notes.md) for the evidence and limitations.

The mock server remains deliberately small. It:

- accepts a fake `openai` or `anthropic` credential alias;
- supports both path and header aliases so the two carriers can be compared;
- returns canned provider-shaped responses, including a small SSE demo;
- binds to `127.0.0.1` by default;
- does not store, decrypt, attach, or forward credentials;
- does not make requests to OpenAI, Anthropic, or any other upstream service.

**Do not put a real API key in this spike.** The sample SDK scripts use an obviously fake placeholder. The mock ignores it.

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

## Gate 0: protocol contract

The next step is to define the stable contract used by the CLI, local service, SDKs and agents. The protocol must be based on the Gate -1 observations, not assumptions. The remaining questions include project authentication, exact error responses, streaming expectations, agent instructions and retry behavior.

The two workflows remain distinct:

1. **App/tool mode:** Cursor or Claude Code helps build an application, and code running locally in that project calls the Keyless endpoint.
2. **Agent-inference mode:** a local coding agent that supports a custom API base URL sends its own model requests through the endpoint. Aider has passed this path in the owner-run test. Other agents must be tested individually.

See the [Gate -1 runbook](docs/spike-runbook.md), [spike notes](docs/spike-notes.md) and [current decisions](DECISIONS.md).

## What is not built yet

No encrypted vault, credential storage, grant system, human approval, daemon, production network client, or real upstream forwarding is included in this spike. Those are Gate 0/implementation work, not features of the current mock.

## Support

For project support, email [contact@aahmedhussa.in](mailto:contact@aahmedhussa.in).

This is an early experiment. I would rather find out that the workflow needs changing now than build a lot of infrastructure around the wrong interface.
