# Keyless v1 scope

**Status: Gate 0 decision.** This defines what v1 is intended to ship. It does not claim the implementation exists.

## Product

Keyless is a local-first credential broker. A daemon owns the encrypted vault, unlock session, project capability tokens and authoritative grants. A loopback HTTP proxy accepts approved requests from local applications, SDKs and CLI coding agents, then attaches the provider credential from the vault and forwards only to a built-in provider origin.

## Supported v1 integration surface

- Direct SDK/application integrations that can set a custom base URL and the Keyless project-token header.
- Local CLI coding agents that can be configured with a custom OpenAI-compatible or provider-specific API base URL.
- Initial built-in providers: OpenAI and Anthropic, subject to the provider-specific implementation and acceptance tests.
- Tested compatibility evidence: OpenAI Node SDK v4, Anthropic Node SDK (exact version not recorded), and Aider CLI against the mock using path-based routing.

Untested clients are not advertised as supported. Claude Code, other CLI agents, other language SDKs and production project-token header injection require explicit tests.

## Explicitly out of scope for v1

- Intercepting traffic from IDE-hosted AI features that do not expose a supported custom endpoint.
- System-level packet interception, transparent TLS interception, VPNs or local root certificates.
- Cursor built-in models that route through Cursor's cloud service. In the owner's test, built-in models bypassed the custom base URL; the free-tier custom endpoint path returned a subscription paywall.
- GitHub Copilot IDE traffic. It was not tested and is not a v1 target.
- Hosted coding agents or remote development environments that cannot reach the developer machine's loopback service.
- Docker/dev-container access to a host loopback proxy; v1 requires the client process to run on the same host.
- Team synchronization, cloud vaults, hosted accounts, web dashboard, custom user-defined provider hosts and arbitrary proxy destinations.
- Automatic discovery/import of API credentials from shell profiles, environment files or other applications.
- Multi-language Keyless SDK packages. Samples may be provided, but the wire protocol is language-neutral.
- Prompt/body inspection, model-token accounting and exact cross-provider cost accounting. V1 limits are transport-level.
- Defending against a compromised OS, root/administrator or arbitrary code running as the same OS user.

## CLI command surface

| Command | V1 behavior |
|---|---|
| `keyless init` | Create the user state directory, project identity and encrypted vault. |
| `keyless add <alias> --provider <provider>` | Add a provider credential through a hidden interactive prompt. |
| `keyless list` | List aliases, provider labels and grants; never values. |
| `keyless remove <alias>` | Remove a credential after confirmation and revoke grants that depend on it. |
| `keyless unlock` | Unlock the daemon for a time-boxed session (default eight hours). |
| `keyless lock` | Lock immediately, clear active session state and abort in-flight work after the documented grace period. |
| `keyless grant <alias>` | Show the normalized permission diff and request human approval before updating the vault-held grant. |
| `keyless revoke <alias|--all>` | Revoke a project's grant for one alias or all aliases immediately. |
| `keyless token revoke` | Revoke the current project's capability token; the project must run the grant/use flow again. |
| `keyless proxy start` | Start the singleton local daemon and proxy. |
| `keyless proxy stop` | Stop the daemon cleanly and lock the vault. |
| `keyless proxy status` | Show daemon state, socket, loopback URL, lock state and configured aliases. |
| `keyless use <alias> [--write]` | Print exact agent setup instructions and token-file path; optionally write the safe instructions to ignored `.keyless/agent-instructions.md`. |
| `keyless generate [--bits 32\|64\|128\|256] [--format hex\|base64] [--store <alias>\|--stdout]` | Generate an application secret using the OS CSPRNG. Default 256 bits. Store by default; stdout requires explicit flag and verified interactive TTY. |
| `keyless reveal <alias>` | Reveal a stored application secret only with interactive approval, on the calling TTY, and record a REVEAL audit event. |
| `keyless passwd` | Change the vault passphrase by re-encrypting the current vault with a new KDF salt and nonce. |
| `keyless doctor` | Check vault, directory/socket permissions, daemon, token file, config/grant divergence, loopback binding and audit integrity without printing secrets. |

The command list is deliberately explicit rather than forcing an inconsistent count across earlier drafts. `rotate`, `log`, `import` and export/restore UX remain out of v1 until separately specified. Credential rotation can be done by add/remove; vault passphrase change uses `passwd`.

## Permissions

- `keyless.config.json` is an untrusted project request.
- The authoritative grant is stored inside the encrypted vault and tied to a project identity.
- The request cannot expand a grant without `keyless grant` and an interactive approval.
- Grant permissions cover provider alias, fixed host, methods, normalized path patterns, allowed query parameter names, model allowlist and transport-level caps.
- The proxy checks the vault-held grant on every request.

## Sessions and tokens

- The daemon owns the unlocked vault; default unlock session is eight hours.
- Locked means fail fast with HTTP 423; the proxy never waits for unlock.
- Project token is 256-bit random, scoped to a project, stored as a 0600/owner-only file outside the repository; vault stores only its hash and lifecycle metadata.
- Token lifetime defaults to 30 days. Tokens are revocable. A same-user process can read the token file; it is an isolation guard, not protection from same-user arbitrary code.

## V1.1 candidates

- More providers (Google, OpenRouter) after their network and SDK tests.
- Docker/dev-container bridge with a separate reviewed network and authentication design.
- IDE integrations only where official custom endpoints or extension APIs exist and the vendor terms permit them.
- Credential import, portable encrypted export/restore, audit log viewer, quota usage viewer and additional language examples.
- MCP server integration after the HTTP proxy contract is stable.

## Credential import decision

There is no automatic `.env` import or migration from existing environment variables in v1. Add credentials interactively with `keyless add`. A future import command must preview the exact source and aliases, never print secret values, and require interactive confirmation.
