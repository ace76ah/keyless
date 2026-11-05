# Keyless

**Give your AI the keys. Never give it the secrets.**

I got tired of copying API keys into projects and then wondering where they would end up. Keyless is my attempt at making that part of building software less messy.

The idea is to keep credentials in a local encrypted vault and let tools use approved credentials through a small local service. The service, not the agent, attaches the real credential when a request is sent to a provider.

There is an important limit to that promise: a process running as the same operating-system user may still be able to use the local service, inspect files it can access, or read process memory. Keyless is meant to reduce accidental exposure and limit the blast radius. It is not a sandbox for a fully compromised machine or a malicious process running as you.

## Where this repo is right now

This repository starts with **Gate -1: a compatibility spike** from the v2 build plan. It is deliberately not the real vault or production proxy yet.

The mock server:

- accepts a fake `openai` or `anthropic` credential alias;
- lets us compare an alias in the URL path with an alias in a header;
- returns canned provider-shaped responses, including a small SSE demo;
- binds to `127.0.0.1` by default;
- does not store, decrypt, attach, or forward credentials;
- does not make requests to OpenAI, Anthropic, or any other upstream service.

**Do not put a real API key in this spike.** The sample SDK scripts use an obviously fake placeholder. The mock ignores it.

## Run it

Node.js 22.14 or newer is required.

```bash
npm run spike
```

The mock listens on `http://127.0.0.1:8787` by default. Change the port with `KEYLESS_SPIKE_PORT`.

In another terminal:

```bash
curl http://127.0.0.1:8787/health
```

Try the path alias:

```bash
curl -i http://127.0.0.1:8787/c/openai/v1/responses \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer not-a-real-key' \
  -d '{"model":"gpt-4.1-mini","input":"hello from the local spike"}'
```

Try the header alias:

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

## Gate -1: what we need to learn

The spike is testing two different workflows. They should not be confused:

1. **App/tool mode:** Cursor or Claude Code helps build an application, and code running locally in that project calls the Keyless endpoint. This is the first workflow to validate.
2. **Agent-inference mode:** a local coding agent that supports a custom API base URL sends its own model requests through the endpoint. This is a separate experiment; it is not how every IDE routes its own AI backend.

Follow [`docs/spike-runbook.md`](docs/spike-runbook.md), then record what actually happened in [`docs/spike-notes.md`](docs/spike-notes.md). The Gate -1 result is still pending until the two real agent workflows have been tried on a developer machine.

## What is not built yet

No encrypted vault, credential storage, grant system, human approval, daemon, production network client, or real upstream forwarding is included in this spike. Those come after the workflow is validated and the protocol is written from what we learn.


## Website and support

- Website: [keyless.aahmedhussa.in](https://keyless.aahmedhussa.in)
- Support: [keyless@aahmedhussa.in](mailto:keyless@aahmedhussa.in)

## Project notes

- [Gate -1 runbook](docs/spike-runbook.md)
- [Gate -1 notes](docs/spike-notes.md)
- [Current decisions](DECISIONS.md)

This is an early experiment. I would rather find out that the workflow needs changing now than build a lot of infrastructure around the wrong interface.
