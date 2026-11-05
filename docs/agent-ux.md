# Agent UX: `keyless use <alias>`

**Status: Gate 0 specification.** The command and token handoff are designed here; the CLI has not been implemented yet.

## Purpose

`keyless use <alias>` prepares a developer or coding agent to use one already-approved credential through the local Keyless proxy. It prints the base URL, the project-token file location and safe setup instructions. It does not reveal a provider credential or print the project token.

The command must refuse if the alias has no vault-held grant for the current project. A project request file is not a grant.

## Project-token delivery decision

1. `keyless grant <alias>` creates or updates the vault-held grant after the human approves the exact permission diff.
2. On successful approval, the daemon creates a 256-bit CSPRNG project capability token. Its format is `klp_v1_<base64url>`; the encoded random component is 43 characters.
3. The daemon writes the plaintext token to the user's private Keyless state directory, not the repository:
   - macOS/Linux: `~/.keyless/projects/<project-id>/project.token`
   - Windows: `%LOCALAPPDATA%\Keyless\projects\<project-id>\project.token`
4. The directory is created with owner-only access (0700 on POSIX); the file is created atomically with owner read/write only (0600 on POSIX). Windows uses an owner-only DACL. The CLI must refuse to use a file whose effective permissions are broader than the policy.
5. The encrypted vault stores only the token ID, SHA-256 digest, project ID, issue time, optional expiry and revocation state. The daemon compares a presented token using a constant-time digest comparison.
6. The default token lifetime is 30 days. `keyless use` does not silently rotate a still-valid token. The user explicitly rotates or revokes it; a fresh grant/use flow may issue a replacement.
7. `keyless use` prints the token file path, never its contents. Application code reads the file at runtime and sends the token to the proxy as `Authorization: Bearer <project-token>`.
8. The token is a scoped local capability, not a provider credential. A process running as the same OS user can read it and call the proxy; this residual risk is explicit in `docs/threat-model.md`.

The token file lives outside the project tree so it is not accidentally committed or copied with project configuration. Do not put its contents in shell arguments, shell history, source code, `.env` files, agent instructions, logs or chat.

## Exact stdout contract

The following is the exact output shape for `keyless use openai`. The CLI substitutes the actual port and absolute token-file path:

```text
Keyless is ready for alias "openai".

Local base URL:
  http://127.0.0.1:<port>/c/openai/v1

Project token file:
  <absolute-path-to-project.token>

Set this path in the application environment:
  KEYLESS_PROJECT_TOKEN_FILE=<absolute-path-to-project.token>

The application must read the token file at runtime and send:
  Authorization: Bearer <project-token>

The token is a local project capability, not an OpenAI API key.
Do not paste provider keys or project-token contents into agent chat.
Do not print the token or commit the token file.

If the proxy returns HTTP 423 (vault_locked), stop and ask the user to run:
  keyless unlock

Do not retry a locked-vault request in a loop.
```

For `keyless use anthropic`, the base URL is:

```text
http://127.0.0.1:<port>/c/anthropic
```

The SDK appends `/v1/messages`. The rest of the output is identical except the alias and base URL.

## Optional instruction file

Default behavior is stdout only. With `--write`, the command writes the same safe instructions to `.keyless/agent-instructions.md` and reports the path. The existing `.gitignore` already ignores `.keyless/`; CI must retain a test for that rule. The file may contain the local base URL, alias, token-file path and setup instructions. It must never contain the token value or a provider credential.

The file is a convenience, not an authority. The daemon always checks the vault-held grant. Editing the file or `keyless.config.json` cannot expand permissions.

## SDK and CLI setup examples

These examples describe the intended adapter behavior. They are not yet integration-tested with a Keyless project token. The Gate -1 SDK tests used dummy provider keys only.

### OpenAI Node SDK

```js
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';

const projectToken = (await readFile(process.env.KEYLESS_PROJECT_TOKEN_FILE, 'utf8')).trim();
const client = new OpenAI({
  apiKey: projectToken,
  baseURL: process.env.KEYLESS_BASE_URL
});
```

OpenAI's `apiKey` option must produce the Keyless `Authorization: Bearer` header. The proxy removes it before adding the vault-held OpenAI credential upstream.

### Anthropic Node SDK

```js
import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';

const projectToken = (await readFile(process.env.KEYLESS_PROJECT_TOKEN_FILE, 'utf8')).trim();
const client = new Anthropic({
  apiKey: 'keyless-placeholder-not-a-secret',
  baseURL: process.env.KEYLESS_BASE_URL,
  defaultHeaders: {
    Authorization: `Bearer ${projectToken}`
  }
});
```

The placeholder `apiKey` is not a provider credential. The proxy removes the inbound `x-api-key` placeholder and the Keyless `Authorization` header, then inserts the vault-held Anthropic `x-api-key` upstream. Confirm header precedence against the exact SDK version before release.

### Aider CLI

The tested Gate -1 workflow used Aider's OpenAI-compatible base-URL option. The intended handoff is to read the project token into the process environment (not a command-line argument):

```bash
export KEYLESS_BASE_URL="http://127.0.0.1:<port>/c/openai/v1"
export OPENAI_API_KEY="$(cat "$KEYLESS_PROJECT_TOKEN_FILE")"
aider --openai-api-base "$KEYLESS_BASE_URL" --model openai/<approved-model>
```

This project-token header mapping is a Gate 0 acceptance test. Do not treat the dummy-key Aider spike as proof that Aider sends the Keyless token in the required `Authorization` header.

## Instructions given to an agent

When `--write` is used, append this agent-facing instruction block after the resolved local values:

> Use the configured Keyless base URL for this alias. Read the project capability token only at application runtime from `KEYLESS_PROJECT_TOKEN_FILE`; do not print it, copy it into source, place it in chat, inspect the token file contents, or add it to a committed configuration file. Never ask the user to paste a provider API key. Do not change the configured Keyless base URL to a provider URL. If Keyless returns HTTP 423 with code `vault_locked`, stop and ask the user to run `keyless unlock`; do not retry automatically or loop. For HTTP 401, stop and ask the user to re-authorize the project. For HTTP 403, explain which grant was denied and ask the user to review it. Do not edit a project request file to grant yourself additional access.

## Error handling

- Missing grant: exit non-zero and tell the user to run `keyless grant <alias>`.
- Locked vault: HTTP proxy requests fail fast with 423; `keyless use` explains `keyless unlock`.
- Missing/revoked/expired project token: do not print a replacement token; tell the user to run the grant/use flow.
- Unsafe token-file permissions: refuse and explain how to repair them; never silently chmod a shared file.
- Unknown alias: list configured alias names only, never credential values.

