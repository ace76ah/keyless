# Keyless decisions

This file separates decisions from assumptions. The Gate -1 routing hypothesis has been validated for the tested OpenAI SDK and Aider paths; Gate 0 now turns those observations into a stable protocol.

| Topic | Status | Current position | What closes it |
|---|---|---|---|
| Local-first v1 | DECIDED | No hosted account or cloud vault in v1. | No further action. |
| Production code layout | PROPOSED | One TypeScript package; no v1 monorepo. | Gate 0. |
| Gate -1 prototype | DECIDED | Throwaway Node mock only; no stored or forwarded credentials. Owner-run OpenAI Node SDK v4 and Aider CLI tests passed against the mock. | Compatibility spike closed for the tested path; broader agent coverage remains separate. |
| Primary workflow | PROPOSED | App/Tool Mode: code running locally calls the loopback service. | Validate with additional local development agents. |
| Agent-Inference Mode | VALIDATED (AIDER) | Aider CLI successfully used the mock through an OpenAI-compatible custom base URL in the owner's test. This does not imply compatibility with every agent. | Test additional agents individually, including Claude Code. |
| Alias carrier | DECIDED | Path prefix: `/c/<alias>/...`. Owner-run OpenAI Node SDK v4 and Aider tests both used this form successfully. Header alias remains in the mock for comparison. | No further action for the first integration; revisit only if a tested client requires another carrier. |
| Node.js version floor | DECIDED | Node.js `>=22.9.0`, matching the owner-reported OpenAI Node SDK v4/Aider validation environment. | Revisit only if a required runtime or dependency establishes a higher minimum. |
| Streaming in first useful demo | OPEN | Aider accepted buffered JSON in the owner test. The mock's SSE path is tested incrementally; production streaming requirements still need to be specified. | Gate 0 protocol and provider/agent compatibility tests. |
| Vault cryptography | PROPOSED | XChaCha20-Poly1305 and bounded Argon2id. | Vault-format specification and review. |
| Human approval | PROPOSED | OS-native approval where supported; weaker fallbacks must be disclosed. | Approval specification and security review. |
| Supported agents | OPEN | Aider CLI is tested. Claude Code is untested; Cursor Free tier blocked custom OpenAI base URLs in the owner's tested setup. Avoid broad support claims. | Evidence from specific tested versions and plans. |
| License | OPEN | No license chosen yet. | Owner decision before public release. |
| npm package name | OPEN | Package is private in this spike; no publishing. | Availability and name review. |

## Current boundary

The spike is not the production Keyless security boundary. It has no vault, no grant store, no credential handling and no provider network client. The owner-run compatibility checks demonstrate that the tested clients can talk to a local mock; they do not demonstrate credential isolation or production security.
