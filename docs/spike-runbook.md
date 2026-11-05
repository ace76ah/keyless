# Gate -1 spike runbook

This is a workflow experiment, not a security test and not the production proxy. It uses fake credentials, canned responses and no upstream network calls.

## 1. Start the mock

From the repository root:

```bash
npm run spike -- --verbose
```

The mock binds to `127.0.0.1:8787`. Keep it running in this terminal.

In another terminal, check it:

```bash
curl http://127.0.0.1:8787/health
```

The result should say `mock-only`, `credentialsStored: false` and `upstreamCalls: false`.

## 2. Compare the alias carriers

Try both examples from the repository root:

```bash
node examples/fetch/path-alias.mjs
node examples/fetch/header-alias.mjs
```

The path form is `/c/<alias>/<provider-path>`. The header form is `X-Keyless-Credential: <alias>`. Both should return a canned response. The response header `x-keyless-alias-mode` tells you which form was used.

## 3. Test SDK compatibility (optional but important)

Install the SDKs only for this local spike:

```bash
npm install --no-save openai @anthropic-ai/sdk
```

In another terminal, run:

```bash
node examples/sdk/openai.mjs
node examples/sdk/anthropic.mjs
```

These examples use fake local placeholder values. Do not put real API keys into the examples or the mock. The SDKs should receive a provider-shaped response from localhost; Keyless does not contact a provider.

If an SDK version changes its constructor options or response validation, record the exact version and error in `spike-notes.md` rather than silently changing the protocol around it.

## 4. Test App/Tool Mode with Cursor and Claude Code

This is the primary workflow. Open this repository (or a separate throwaway app) in Cursor and Claude Code. Give each agent the task below:

> The local Keyless mock is running at `http://127.0.0.1:8787`. Run `node examples/fetch/path-alias.mjs` and `node examples/fetch/header-alias.mjs`. Do not add a real API key, do not edit the mock to contact a provider, and do not try to use an external API. Explain which alias format you found in each example and report the response status and mock header.

The agent should run local code that calls localhost. This is not a test of Cursor's own cloud-hosted inference backend connecting to localhost.

Record whether the agent understood the instructions, found the examples, ran the commands and recovered from any errors.

## 5. Test Agent-Inference Mode separately

This mode is only for local coding agents that support a custom API base URL. It is not the same as App/Tool Mode.

For Claude Code, the v2 plan proposes testing a custom Anthropic base URL. Use a fake placeholder only and confirm the exact environment-variable behavior for the installed Claude Code version before running it. Do not use this mock with real credentials or assume the mock response is sufficient for a full agent session.

If the CLI refuses the mock response, record the error. Do not interpret that as failure of App/Tool Mode.

## 6. What to record

For each tool and mode, record:

- tool name and version;
- operating system and Node version;
- exact command or configuration used;
- alias carrier (path or header);
- whether the SDK accepted the response;
- whether streaming was needed and whether it worked;
- whether the agent retried after an error;
- files the agent tried to create or modify;
- anything confusing about the instructions.

Do not include API keys, access tokens, private project data or full sensitive prompts in the notes.

## 7. Stop conditions

Stop the test if anything tries to send a real credential, if the mock unexpectedly makes an outbound request, or if an agent tries to use a real provider endpoint. This mock should never need a real key.
