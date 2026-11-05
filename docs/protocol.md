# Keyless HTTP protocol (draft)

**Status: Gate 0 working draft — not frozen and not implemented.**

This document turns the Gate -1 observations and the v2 build-plan decisions into a proposed wire contract. The owner validated path-based routing and response compatibility with the OpenAI Node SDK, Anthropic Node SDK and Aider CLI against the mock. Those tests used dummy API keys; they did not validate the project-token header proposed below. Treat the authentication examples as the contract to implement and test, not as behavior the spike has already proved.

## 1. Base URL and route

The production daemon binds to loopback only. Its selected port is recorded in the daemon state file and displayed by `keyless proxy status`. Do not assume the production port is always 8787; that is the mock's default.

```
http://127.0.0.1:<port>
```

The alias is carried in the path:

```
/c/<alias>/<provider-api-path>
```

Examples:

| Provider | SDK base URL | Example request path |
|---|---|---|
| OpenAI | `http://127.0.0.1:<port>/c/openai/v1` | `/c/openai/v1/responses` |
| Anthropic | `http://127.0.0.1:<port>/c/anthropic` | `/c/anthropic/v1/messages` |

The proxy removes only the leading `/c/<alias>` segment before constructing the provider request. The provider hostname comes from the built-in provider definition, never from the incoming `Host` header or an absolute URL supplied by the caller.

Path-based alias routing is the selected v1 contract. `X-Keyless-Credential` remains in the mock for comparison but is not part of the production v1 route contract.

## 2. Request headers and project token

### Required Keyless authentication

The proposed Keyless project token is sent in:

```
Authorization: Bearer <project-token>
```

The token is issued by `keyless grant <alias>` only after interactive approval. It contains 32 bytes of CSPRNG entropy and is encoded as `klp_v1_<base64url>`. The plaintext token is stored outside the project at `~/.keyless/projects/<project-id>/project.token` (macOS/Linux) or `%LOCALAPPDATA%\\Keyless\\projects\\<project-id>\\project.token` (Windows). POSIX directory/file modes are 0700/0600; Windows uses an owner-only DACL. The encrypted vault stores the token ID and SHA-256 digest, not the plaintext. The default expiry is 30 days. The token is revoked by `keyless token revoke`.

`keyless use <alias>` prints the base URL and token-file path; it never prints the token value. Application code reads the token file at runtime and sends the contents as `Authorization: Bearer <project-token>`. The exact stdout contract and SDK/CLI examples are in [agent-ux.md](agent-ux.md).

The project token is not a provider API key. It is a scoped local capability. It must never be forwarded to a provider, placed in a URL or request body, or written to logs. A same-OS-user process may still be able to read or use the token file; this is an explicit limitation, not a security boundary.

### Provider SDK key fields

SDKs commonly require an API-key value at construction time. In Keyless mode, this value must be the Keyless project token or a clearly fake placeholder accompanied by an explicit custom `Authorization` header. It must never be a real provider secret.

- **OpenAI Node SDK:** read the token file and pass its value as `apiKey`; the SDK should send it as `Authorization: Bearer`.
- **Anthropic Node SDK:** read the token file and set `defaultHeaders.Authorization` to the Keyless bearer token. A fake `apiKey` may be required for SDK construction; its `x-api-key` header is stripped locally.
- **Aider:** read the token file into the process environment and configure the custom OpenAI-compatible base URL. Do not put the token in a command-line argument.

These header mappings are the proposed v1 contract, not yet proven by Gate -1. Gate 0 acceptance tests must capture the actual local headers for the pinned OpenAI SDK, Anthropic SDK and Aider versions, prove the project token is not forwarded upstream, and cover SDK header precedence.

### Header handling

The proxy must:

- authenticate the Keyless project token before attempting upstream work;
- remove the inbound Keyless `Authorization` header before forwarding;
- remove caller-supplied credential headers, including provider-specific API-key headers;
- insert the vault-held provider credential using the provider's required authentication header;
- never forward `Cookie`, `Proxy-Authorization`, `Host`, `Forwarded`, `X-Forwarded-*`, or `Via`;
- validate header names and values and reject CR/LF injection;
- never place provider credentials in the URL or request body.

Provider-specific headers required for protocol compatibility (for example Anthropic's version header) may be forwarded only after validation against the provider definition. The proxy constructs the upstream host and TLS identity from the built-in provider definition.

## 3. Request and response behavior

- The proxy accepts only methods and paths granted to the project and supported by the provider definition.
- The path is normalized before policy matching. Reject absolute-form request targets, host overrides, encoded separators, NUL, backslashes and traversal segments.
- The caller's JSON body is forwarded within configured size limits. Keyless v1 does not inspect prompts, model token counts or message content for quota enforcement.
- Successful upstream status, response body and safe response headers are passed back to the SDK. Hop-by-hop headers and credential-bearing headers are not returned.
- Server-Sent Events are forwarded incrementally, not buffered. A client disconnect cancels the corresponding upstream request.
- Automatic redirects are disabled. A redirect must not cause a provider credential to be sent to another host.

## 4. Error response format

All Keyless-generated errors use JSON with this stable shape:

```json
{
  "error": "vault_locked",
  "code": "vault_locked",
  "message": "The Keyless vault is locked.",
  "action": "Ask the user to run: keyless unlock"
}
```

For this draft, `error` and `code` contain the same stable identifier. `message` is safe for an agent to display. `action` tells the agent what the human must do. Error responses must never include provider credentials, project-token values, request bodies or raw upstream secrets.

| HTTP status | Code | Meaning | Agent behavior |
|---:|---|---|---|
| 400 | `invalid_request` | Malformed request or invalid path encoding. | Report the error; do not retry unchanged input. |
| 401 | `token_invalid` | Project token is missing, invalid, revoked or expired. | Stop and ask the user to run `keyless use <alias>` or re-authorize the project. Do not loop. |
| 403 | `forbidden_host`, `forbidden_method`, `forbidden_path` | The request is outside the provider or project grant. | Stop and explain the denied operation. Ask the user to review the grant. |
| 404 | `unknown_alias` | The alias is not configured. | Stop and ask the user to check the alias and configure it with Keyless. |
| 405 | `method_not_allowed` | The HTTP method is not supported by the proxy endpoint at all. | Stop; do not retry with a different method automatically. |
| 413 | `body_too_large` | Request body exceeds the configured limit. | Reduce the request size; do not retry unchanged input. |
| 423 | `vault_locked` | The vault is locked or the unlock session is unavailable. | Fail fast. Tell the user to run `keyless unlock`; do not retry in a loop. The agent can retry the original request after the user unlocks. |
| 429 | `rate_limited` | A request or concurrency quota was reached. | Respect the `Retry-After` response header. Do not retry sooner. |
| 502 | `upstream_error` | The provider could not complete the request or returned an unusable response. | Show a sanitized message; retry only under the caller's normal bounded retry policy. |

A 429 response must include `Retry-After` with the wait in seconds. A 423 response must not ask the agent to poll or automatically retry. Re-unlocking must not require restarting the agent.

## 5. Worked request examples

These examples show the intended wire contract. `<project-token>` and `<vault-provider-secret>` are placeholders, not literal values.

### OpenAI

Incoming request:

```http
POST /c/openai/v1/responses HTTP/1.1
Host: 127.0.0.1:<port>
Authorization: Bearer <project-token>
Content-Type: application/json

{"model":"gpt-4.1-mini","input":"hello"}
```

Forwarded upstream request (conceptual; the actual secret is inserted only by the daemon):

```http
POST /v1/responses HTTP/1.1
Host: api.openai.com
Authorization: Bearer <vault-provider-secret>
Content-Type: application/json

{"model":"gpt-4.1-mini","input":"hello"}
```

The project token is removed. The provider credential comes from the vault-held OpenAI credential associated with the `openai` alias and approved project grant.

### Anthropic

Incoming request:

```http
POST /c/anthropic/v1/messages HTTP/1.1
Host: 127.0.0.1:<port>
Authorization: Bearer <project-token>
x-api-key: placeholder-not-a-secret
anthropic-version: 2023-06-01
Content-Type: application/json

{"model":"claude-test","max_tokens":20,"messages":[{"role":"user","content":"hello"}]}
```

Forwarded upstream request (conceptual):

```http
POST /v1/messages HTTP/1.1
Host: api.anthropic.com
x-api-key: <vault-provider-secret>
anthropic-version: 2023-06-01
Content-Type: application/json

{"model":"claude-test","max_tokens":20,"messages":[{"role":"user","content":"hello"}]}
```

The local `Authorization` project token and placeholder `x-api-key` are removed. The vault-held Anthropic credential is inserted as `x-api-key`.

## 6. `keyless use <alias>` output

The exact stdout format, token-file handling and SDK/CLI examples are specified in [agent-ux.md](agent-ux.md). In summary:

- `keyless grant <alias>` issues the project token only after an approved grant exists.
- Token file is stored in the user-owned Keyless state directory, outside the repository, with restrictive OS permissions.
- `keyless use <alias>` prints the resolved base URL and token-file path, not the token value.
- Application/SDK code reads the file at runtime and supplies the token in the reserved Keyless Authorization header.
- Default behavior is stdout only. `--write` writes safe instructions to the gitignored `.keyless/agent-instructions.md`; no token value or provider credential is written there.

## 7. Gate 0 implementation validations still required

The design choices below are now specified, but they must pass integration and adversarial tests before the protocol is frozen:

1. **Project-token delivery:** prove the `Authorization` header reaches Keyless for the exact OpenAI SDK, Anthropic SDK and Aider versions. Gate -1 used dummy keys and did not validate this mapping.
2. **Token lifecycle:** implement issuance after approved grant, token-file permissions, 30-day expiry, hash-only vault storage and immediate revocation. Verify file replacement and daemon restart behavior.
3. **SDK header precedence:** verify how each SDK combines API-key fields and custom/default headers. In particular, the Anthropic placeholder `x-api-key` must never override the Keyless bearer header locally or reach the provider.
4. **Error mapping:** test every status and code against a real SDK/agent, especially 401, 403, 423 and 429, and verify agents do not retry locked or denied requests in a loop.
5. **Streaming and cancellation:** validate first-frame latency, incremental delivery, SSE mid-stream error normalization and client-abort propagation with the official SDKs.
6. **Port discovery and lifecycle:** implement the daemon state file and `keyless proxy status`; handle stale state, singleton locking and process restarts.
7. **External review:** obtain a human security reviewer for the threat model, approval design, protocol and network contract before v1 release.

No production vault, daemon, credential injection or upstream proxy implementation is implied by this document. Freeze this contract only after these tests pass and the security review signs off.
