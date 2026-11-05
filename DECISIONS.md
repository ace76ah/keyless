# Keyless decisions

This file separates decisions from assumptions. Gate -1 compatibility testing is complete for the tested SDKs and CLI agent. Gate 0 now specifies the project-token handoff, agent instructions, threat model, vault format and request/grant/provider schemas. Implementation and external security review are still ahead.

| Topic | Status | Current position | What closes it |
|---|---|---|---|
| Local-first v1 | DECIDED | No hosted account or cloud vault in v1. | No further action. |
| Production code layout | PROPOSED | One TypeScript package; no v1 monorepo. | Review during Gate 1. |
| Gate -1 prototype | DECIDED | Throwaway Node mock only; no stored or forwarded credentials. Owner-run OpenAI Node SDK, Anthropic Node SDK and Aider CLI tests passed against the mock. | Compatibility spike closed for the tested targets. |
| Target integrations | DECIDED | Direct SDKs and local CLI coding agents that support a custom base URL. Initial provider definitions: OpenAI and Anthropic. IDE-hosted inference interception, system packet interception, hosted agents and remote clients are out of scope for v1. | Do not broaden without a separate reviewed decision and tests. |
| Alias carrier | DECIDED | Path prefix: `/c/<alias>/...`. Owner-run OpenAI Node SDK v4, Anthropic Node SDK and Aider tests used this form successfully. Header alias remains in the mock for comparison only. | No further action for the first integration. |
| Node.js version floor | DECIDED | Node.js `>=22.9.0`, validated by the owner-run SDK/Aider tests on Node v22.9. | Revisit only if a required runtime or dependency establishes a higher minimum. |
| Project-token delivery | DECIDED (DESIGN) | Per-project 256-bit CSPRNG capability token. Plaintext in an owner-only file under the user's Keyless state directory (0700 directory / 0600 file on POSIX); vault stores SHA-256 digest and lifecycle metadata only. Default expiry 30 days. Sent to proxy as `Authorization: Bearer <project-token>`; removed before upstream forwarding. Same-user code can read/use it. | Implement and test token issuance, file ACLs, SDK/Aider header mapping, expiry and revocation before protocol freeze. |
| Project permissions | DECIDED | `keyless.config.json` is a request. The authoritative grant is encrypted inside the vault and tied to the project ID/path binding. A request-file edit cannot widen a grant without an interactive approved diff. | Implement grant comparison and test edit/tamper attempts. |
| Vault cryptography | DECIDED (DESIGN) | XChaCha20-Poly1305 only; Argon2id v=19, 64 MiB minimum, 1 GiB maximum, 3–10 iterations, parallelism 4, 16-byte salt; fixed header is AEAD AAD; HKDF-SHA-256 purpose separation. | External cryptographic review and Gate 2 benchmark/tests before format freeze. |
| Vault container | PROPOSED | Versioned 72-byte header and one encrypted snapshot containing the full logical record array; 24-byte random nonce per write; atomic replacement and OS-backed exclusive locking. Defined in `docs/vault-format.md`. | Review and implementation fault-injection tests. |
| Human approval | PROPOSED | macOS LocalAuthentication, Windows Hello, Linux polkit; fallback is caller-owned TTY challenge, never daemon-controlled TTY. Headless grant/reveal unsupported. | Gate 1 external security review and platform tests. |
| Streaming | DECIDED (REQUIREMENT) | Production proxy must forward SSE incrementally with backpressure and propagate client cancellation. The owner Aider spike used buffered JSON; mock tests establish incremental frame emission only. | SDK integration acceptance tests and network implementation. |
| Cursor and IDE support | DECIDED (OUT OF SCOPE) | In the owner's Cursor Free-tier test, the custom OpenAI endpoint produced a "Cursor Subscription Required" paywall error. Built-in models (Grok, Composer) bypassed the custom base URL and routed through Cursor's cloud service. IDE interception and system-level packet interception are not v1 features. GitHub Copilot was not tested. | Separate future integration only if supported by an official custom endpoint and reviewed terms/architecture. |
| Supported tools evidence | OPEN (VERSIONED) | Tested: OpenAI Node SDK v4, Anthropic Node SDK (exact version not recorded), Aider CLI (exact version not recorded). Claude Code and additional SDKs/agents are not yet verified. | Record exact versions and run token-header tests for every advertised integration. |
| Human security reviewer | OPEN | An external qualified reviewer has not yet signed the threat model, approval design, protocol and network contract. | Reviewer comments and explicit sign-off recorded here before release. |
| License | OPEN | No license chosen yet. | Owner decision before public release. |
| npm package name | OPEN | Package is private in this spike; no publishing. | Availability and name review. |

## Current boundary

The spike is not the production Keyless security boundary. It has no vault, no grant store, no credential handling and no provider network client. The owner-run compatibility checks demonstrate that tested clients can talk to a local mock; they do not demonstrate project-token authentication, credential isolation or production security. The project-token, grant, cryptographic and network specifications must pass implementation tests and independent review before v1 can ship.
